let path = require('path')
let fs = require('fs')
let assert = require('chai').assert
let chai = require('chai')
let SmartDB = require('../framework/helpers/smartdb.js')
let Orm = require('../framework/helpers/orm.js')

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
    db: new Orm('', '', '', { storage: DB_FILE }),
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
    assert.throws(() => sdb.get('User', { name: 'not_exist_name' }, Error, /Value not found/))
    assert.throws(() => sdb.get('User', { phone: USER1.phone }, Error, /Not index key/))

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
    assert.throws(() => sdb.get('User', { id: USER2.id }, Error, /Value not found/))
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
    assert.throws(() => sdb.get('User', { name: USER1.name }, Error, /Value not found/))
    sdb.rollbackTransaction()
    assert.deepEqual(sdb.get('User', { id: USER1.id }), USER1)
    assert.deepEqual(sdb.get('User', { name: USER1.name }), USER1)
    sdb.del('User', { id: USER1.id })
    sdb.commitTransaction()
    assert.throws(() => sdb.get('User', { name: USER1.name }, Error, /Value not found/))

    await sdb.commitBlock()

    let user1 = await app.model.User.findOne({ condition: { id: USER1.id } })
    // console.log('user1', user1)
    assert.equal(user1, null)

    let user2 = await app.model.User.findOne({ condition: { id: USER2.id } })
    assert.notEqual(user2, null)
    assert.equal(user2.age, 45)
  })

  it('benchmark', async () => {
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