let jsonSql = require('json-sql')({ separatedValues: false })
let changeCase = require('change-case')

function deconstruct(obj) {
  let i = 0
  let result = null
  for (let k in obj) {
    result = [k, obj[k]]
    if (++i > 1) throw new Error('Multi k-v condition not supported')
  }
  if (!result) throw new Error('Empty condition no supported')
  return result
}

function fromModelToTable(model) {
  return changeCase.snakeCase(model) + 's'
}

class SmartDB {
  constructor(app) {
    this.app = app
    this.trsLogs = new Array
    this.blockLogs = new Array
    this.lockCache = new Set
    this.indexes = new Map
    this.indexSchema = new Map
  }

  undoLogs(logs) {
    while (logs.length > 0) {
      let [action, ...params] = logs.pop()
      this['undo' + action].apply(this, params)
    }
  }

  beginBlock() {

  }

  rollbackBlock() {
    this.lockCache.clear()
    this.undoLogs(this.blockLogs)
  }

  async commitBlock() {
    this.lockCache.clear()

    const BATCH_SIZE = 100
    let batchs = []
    let sqls = []
    let i = 0
    this.blockLogs.forEach((log) => {
      if (i % BATCH_SIZE === 0 && sqls.length !== 0) {
        batchs.push(sqls)
        sqls = []
      }
      let [action, ...params] = log
      if (action !== 'Lock') {
        sqls.push(this['build' + action].apply(this, params).query)
        i++
      }
    })
    if (sqls.length !== 0) {
      batchs.push(sqls)
    }

    this.blockLogs = new Array

    try {
      var t = await this.app.db.transaction()
      for (let i in batchs) {
        let sql = batchs[i].join('')
        // console.log('sql............', sql)
        await this.app.db.query(sql)
      }
      await t.commit()
      return true
    } catch (e) {
      console.log('Failed to commit block: ' + e)
      await t.rollback()
      return false
    }
  }

  beginTransaction() {

  }

  rollbackTransaction() {
    this.undoLogs(this.trsLogs)
  }

  commitTransaction() {
    this.blockLogs = this.blockLogs.concat(this.trsLogs)
    this.trsLogs = new Array
  }

  async load(model, attributes, indexes) {
    let app = this.app
    let results = await app.model[model].findAll({ attributes: attributes })
    let invertedList = new Map
    results.forEach((item) => {
      indexes.forEach((i) => {
        if (!item[i]) throw new Error('Empty index not supported: ' + i)
        let key = i + '@' + item[i]
        if (invertedList.get(key) != undefined) throw Error('Ununique index not supported: ' + i)
        let cacheItem = {}
        attributes.forEach((attr) => {
          cacheItem[attr] = item[attr]
        })
        invertedList.set(key, cacheItem)
      })
    })
    this.indexes.set(model, invertedList)
    this.indexSchema.set(model, {
      attributes: attributes,
      indexes: indexes
    })
  }

  get(model, cond) {
    if (!model || !cond) throw new Error('Invalid params')
    let invertedList = this.indexes.get(model)
    let schema = this.indexSchema.get(model)
    if (!invertedList || !schema) throw new Error('Model not found in cache: ' + model)
    let c = deconstruct(cond)
    if (schema.indexes.indexOf(c[0]) === -1) throw new Error('Not index key: ' + c[0])
    let value = invertedList.get(c[0] + '@' + c[1])
    if (!value) throw new Error('Value not found for: ' + cond)
    return value
  }

  lock(key) {
    if (this.lockCache.has(key)) throw new Error('Key is locked in this block: ' + key)
    this.trsLogs.push(['Lock', key])
    this.lockCache.add(key)
  }

  undoLock(key) {
    this.lockCache.delete(key)
  }

  create(model, values) {
    this.trsLogs.push(['Create', model, values])
    let invertedList = this.indexes.get(model)
    let schema = this.indexSchema.get(model)
    if (!invertedList || !schema) return

    let cacheValues = {}
    for (let k in values) {
      if (schema.attributes.indexOf(k) !== -1) {
        cacheValues[k] = values[k]
      }
    }

    schema.indexes.forEach(function (i) {
      let indexKey = i + '@' + values[i]
      if (!!invertedList.get(indexKey)) throw Error('Ununique index not supported: ' + indexKey)
      invertedList.set(indexKey, cacheValues)
    })
  }

  undoCreate(model, values) {
    let invertedList = this.indexes.get(model)
    let schema = this.indexSchema.get(model)
    if (!invertedList || !schema) return

    for (let k in values) {
      schema.indexes.forEach(function (i) {
        let indexKey = k + '@' + values[k]
        invertedList.delete(indexKey)
      })
    }
  }

  buildCreate(model, values) {
    let table = fromModelToTable(model)
    return jsonSql.build({
      type: 'insert',
      table: table,
      values: values
    })
  }

  update(model, modifier, cond) {
    if (!model || !modifier || !cond) throw new Error('Invalid params')
    let m = deconstruct(modifier)
    let c = deconstruct(cond)

    this.trsLogs.push(['Update', model, modifier, cond])
    let invertedList = this.indexes.get(model)
    if (!invertedList) return

    let indexKey = c.join('@')
    let item = invertedList.get(indexKey)
    if (!item) return
    this.trsLogs[this.trsLogs.length - 1].push(item[m[0]])
    item[m[0]] = m[1]
  }

  undoUpdate(model, modifier, cond, oldValue) {
    let invertedList = this.indexes.get(model)
    if (!invertedList) return

    let m = deconstruct(modifier)
    let c = deconstruct(cond)

    let indexKey = c.join('@')
    let item = invertedList.get(indexKey)
    if (!item) return

    if (!oldValue) throw new Error('Old value should exists')
    item[m[0]] = oldValue
  }

  buildUpdate(model, modifier, cond) {
    let table = fromModelToTable(model)
    return jsonSql.build({
      type: 'update',
      table: table,
      modifier: modifier,
      condition: cond
    })
  }

  del(model, cond) {
    if (!model || !cond) throw new Error('Invalid params')
    let c = deconstruct(cond)
    this.trsLogs.push(['Del', model, cond])

    let invertedList = this.indexes.get(model)
    if (!invertedList) return

    let indexKey = c.join('@')
    let item = invertedList.get(indexKey)
    if (!item) return
    this.trsLogs[this.trsLogs.length - 1].push(item)

    let schema = this.indexSchema.get(model)
    for (let k in item) {
      if (schema.indexes.indexOf(k) != -1) {
        indexKey = k + '@' + item[k]
        invertedList.delete(indexKey)
      }
    }
  }

  undoDel(model, cond, oldItem) {
    let c = deconstruct(cond)
    let invertedList = this.indexes.get(model)
    if (!invertedList) return

    let schema = this.indexSchema.get(model)
    schema.indexes.forEach(function (i) {
      let indexKey = i + '@' + oldItem[i]
      if (!!invertedList.get(indexKey)) throw Error('Index should have been deleted')
      invertedList.set(indexKey, oldItem)
    })
  }

  buildDel(model, cond) {
    let table = fromModelToTable(model)
    return jsonSql.build({
      type: 'remove',
      table: table,
      condition: cond
    })
  }
}

module.exports = SmartDB