let path = require('path')
let fs = require('fs')
let Sequelize = require('sequelize')
let assert = require('chai').assert
let chai = require('chai')
let SmartDB = require('../framework/helpers/smartdb.js')

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

describe('smartdb-equelize', () => {
  let sequelize = new Sequelize('', '', '', {
    dialect: 'sqlite',
    storage: DB_FILE,
    logging: false
  });

  let app = {
    db: sequelize,
    DB: Sequelize,
    model: {}
  }

  before(async () => {
    let userSchema = {
      id: {
        type: app.DB.STRING,
        allowNull: false,
        primaryKey: true
      },
      name: {
        type: app.DB.STRING,
        allowNull: false
      },
      age: {
        type: app.DB.INTEGER,
        allowNull: false
      },
      phone: {
        type: app.DB.STRING,
        allowNull: false
      }
    }
    let User = app.db.define('user', userSchema, { timestamps: false })
    app.model.User = User
    await User.sync()
    await User.create(USER1)
  })

  after(() => {
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

    // console.time('benchmark')
    // for (let i = 10000; i < 10100; ++i) {
    //   sdb.create('User', {
    //     id: i.toString(),
    //     name: i.toString(),
    //     age: 1,
    //     phone: 'fds'
    //   })
    // }
    // await sdb.commitTransaction()
    // await sdb.commitBlock()
    // console.timeEnd('benchmark')

    let user1 = await app.model.User.findOne({ where: { id: USER1.id } })
    assert.equal(user1, null)

    let user2 = await app.model.User.findOne({ where: { id: USER2.id } })
    assert.notEqual(user2, null)
    assert.equal(user2.age, 45)
  })
})