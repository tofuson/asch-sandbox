let path = require('path')
let fs = require('fs')
let assert = require('chai').assert
let chai = require('chai')
let SmartDB = require('../framework/helpers/smartdb.js')
let ORM = require('../framework/helpers/orm.js')
let BalanceManager = require('../framework/helpers/balance-manager.js')
var AutoIncrement = require('../framework/helpers/auto-increment')

const DB_FILE = path.join('/tmp', 'blockchain.db')
const USER1 = {
  id: '1001',
  name: 'qingfeng',
  age: 30,
  phone: '15321205590'
}
const USER2 = {
  id: '1002',
  name: 'Satoshi',
  age: 40,
  phone: '00000000'
}

describe('smartdb-orm', () => {


  let app = {
    db: new ORM('', '', '', { storage: DB_FILE }),
    model: {}
  }

  before(async () => {
    let userSchema = {
      table: 'users',
      tableFields: [
        {
          name: 'id',
          type: 'String',
          length: 50,
          not_null: true
        },
        {
          name: 'name',
          type: 'String',
          length: 30,
          not_null: true
        },
        {
          name: 'age',
          type: 'BigInt',
          not_null: true
        },
        {
          name: 'phone',
          type: 'String',
          length: '11',
          not_null: true
        }
      ]
    }
    let User = app.db.define('user', userSchema, { timestamps: false })
    app.model.User = User
    await User.sync()
    await User.create(USER1)

    let Balance = app.db.define('balance', require('../framework/model/balance'), { timestamps: false })
    app.model.Balance = Balance
    await Balance.sync()

    let Variable = app.db.define('variable', require('../framework/model/variable'), { timestamps: false })
    app.model.Variable = Variable
    await Variable.sync()
  })

  after(async () => {
    app.db.close()
    fs.unlinkSync(DB_FILE)
  })

  it('should pass all normal tests', async () => {
    let sdb = new SmartDB(app)
    await sdb.load('User', ['id', 'name', 'age', 'phone'], ['id', 'name'])

    assert.deepEqual(sdb.get('User', { id: USER1.id }), USER1)
    assert.deepEqual(sdb.get('User', { name: USER1.name }), USER1)
    assert.throws(() => sdb.get(), Error, /Invalid params/)
    assert.equal(sdb.get('User', { phone: USER1.phone }), null)
    assert.equal(sdb.get('User', { name: 'not_exist_name' }), null)

    sdb.beginBlock()

    sdb.beginTransaction()
    let lockFunc = () => sdb.lock('test@key')
    assert.doesNotThrow(lockFunc, Error)
    assert.throws(lockFunc, Error, /Key is locked in this block/)
    sdb.rollbackTransaction()
    assert.doesNotThrow(lockFunc, Error)
    assert.throws(lockFunc, Error, /Key is locked in this block/)
    sdb.commitTransaction()

    assert.throws(lockFunc, Error, /Key is locked in this block/)

    sdb.beginTransaction()
    sdb.create('User', USER2)
    assert.deepEqual(sdb.get('User', { id: USER2.id }), USER2)
    sdb.rollbackTransaction()
    assert.equal(sdb.get('User', { id: USER2.id }), null)
    sdb.create('User', USER2)
    sdb.commitTransaction()
    assert.deepEqual(sdb.get('User', { id: USER2.id }), USER2)

    sdb.beginTransaction()
    sdb.update('User', { age: 45 }, { name: USER2.name })
    assert.equal(sdb.get('User', { id: USER2.id }).age, 45)
    sdb.rollbackTransaction()
    assert.equal(sdb.get('User', { id: USER2.id }).age, USER2.age)
    sdb.update('User', { age: 45 }, { name: USER2.name })
    sdb.commitTransaction()

    sdb.beginTransaction()
    sdb.del('User', { id: USER1.id })
    assert.equal(sdb.get('User', { name: USER1.name }), null)
    sdb.rollbackTransaction()
    assert.deepEqual(sdb.get('User', { id: USER1.id }), USER1)
    assert.deepEqual(sdb.get('User', { name: USER1.name }), USER1)
    sdb.del('User', { id: USER1.id })
    sdb.commitTransaction()
    assert.equal(sdb.get('User', { name: USER1.name }), null)

    let age = sdb.get('User', { name: USER2.name }).age
    sdb.beginTransaction()
    sdb.increment('User', { age: 1 }, { name: USER2.name })
    assert.equal(sdb.get('User', { name: USER2.name }).age, age + 1)
    sdb.rollbackTransaction()
    assert.equal(sdb.get('User', { name: USER2.name }).age, age)
    sdb.increment('User', { age: -1 }, { name: USER2.name })
    assert.equal(sdb.get('User', { name: USER2.name }).age, age - 1)
    sdb.commitTransaction()

    await sdb.commitBlock()

    let user1 = await app.model.User.findOne({ condition: { id: USER1.id } })
    // console.log('user1', user1)
    assert.equal(user1, null)

    let user2 = await app.model.User.findOne({ condition: { id: USER2.id } })
    assert.notEqual(user2, null)
    assert.equal(user2.age, age - 1)

    let count = await app.model.User.count({ id: USER2.id })
    assert.equal(count, 1)
    count = await app.model.User.count({ id: USER1.id })
    assert.equal(count, 0)
    let exists = await app.model.User.exists({ id: USER2.id })
    assert.equal(exists, true)
    exists = await app.model.User.exists({ id: USER1.id })
    assert.equal(exists, false)
  })

  it('test balance manager', async () => {
    let sdb = new SmartDB(app)
    let bm = new BalanceManager(sdb)
    await sdb.load('Balance', ['address', 'currency', 'balance'], [['address', 'currency']])

    const B1 = {
      address: 'AAA',
      currency: 'XAS'
    }
    sdb.beginBlock()
    sdb.beginTransaction()

    assert.equal(sdb.get('Balance', B1), null)
    assert.equal(bm.get(B1.address, B1.currency).toString(), '0')
    bm.decrease(B1.address, B1.currency, '1000')
    assert.equal(bm.get(B1.address, B1.currency).toString(), '-1000')
    bm.increase(B1.address, B1.currency, '1500')
    assert.equal(bm.get(B1.address, B1.currency).toString(), '500')

    sdb.rollbackTransaction()
    bm.increase(B1.address, B1.currency, '1000')
    bm.decrease(B1.address, B1.currency, '500')
    sdb.commitTransaction()
    await sdb.commitBlock()

    assert.equal(bm.get(B1.address, B1.currency).toString(), '500')

    let obj = await app.model.Balance.findOne({ condition: B1 })
    assert.notEqual(obj, null)
    assert.equal(obj.address, B1.address)
    assert.equal(obj.currency, B1.currency)
    assert.equal(obj.balance, '500')
  })

  it('test auto increment id', async () => {
    let sdb = new SmartDB(app)
    let autoID = new AutoIncrement(sdb)
    await sdb.load('Variable', ['value'], ['key'])

    sdb.beginBlock()
    sdb.beginTransaction()
    assert.equal(autoID.get('test_id'), '0')
    assert.equal(autoID.increment('test_id'), '1')
    assert.equal(autoID.increment('test_id'), '2')
    sdb.rollbackTransaction()
    assert.equal(autoID.get('test_id'), '0')

    sdb.beginTransaction()
    assert.equal(autoID.increment('test_id_2'), '1')
    assert.equal(autoID.increment('test_id_2'), '2')
    sdb.commitTransaction()
    await sdb.commitBlock()
    assert.equal(autoID.get('test_id_2'), '2')

    let dbItem = await app.model.Variable.findOne({ key: 'test_id_2' })
    assert.notEqual(dbItem, null)
    assert.equal(dbItem.value, '2')
  })

  it.skip('benchmark', async () => {
    let sdb = new SmartDB(app)
    sdb.beginBlock()
    sdb.beginTransaction()
    await sdb.load('User', ['id', 'name', 'age', 'phone'], ['id', 'name'])
    const COUNT = 50000
    let label = 'Smartdb benchmark for ' + COUNT + ' creates'
    console.time(label)
    for (let i = 0; i < COUNT; ++i) {
      sdb.create('User', {
        id: i.toString() + '_',
        name: i.toString(),
        age: 1,
        phone: 'fds'
      })
    }
    await sdb.commitTransaction()
    await sdb.commitBlock()
    console.timeEnd(label)
  })
})