let bignum = require('bignumber')

class BalanceManager {
  constructor(sdb) {
    this.sdb = sdb
  }

  getBalance(address, currency) {
    let item = this.sdb.get('Balance', {
      address: address,
      currency: currency
    })
    let balance = item ? item.balance : '0'
    return bignum(balance)
  }

  increaseBalance(address, currency, amount) {
    let cond = {
      address: address,
      currency: currency
    }
    let item = this.sdb.get('Balance', cond)
    if (item !== null) {
      let balance = bignum(item.balance).plus(amount)
      this.sdb.update('Balance', { balance: balance.toString() }, cond)
    } else {
      cond.balance = amount
      this.sdb.create('Balance', cond)
    }
  }

  decreaseBalance(address, currency, amount) {
    this.increaseBalance(address, currency, '-' + amount)
  }
}

module.exports = BalanceManager