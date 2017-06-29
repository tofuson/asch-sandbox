let bignum = require('bignumber')

class FeeStat {
  constructor() {
    this.fees = new Map
  }

  add(currency, amount) {
    this.fees.set(currency, (this.fees.get(currency) || bignum(0)).plus(amount))
  }

  getFees() {
    return this.fees
  }
}

module.exports = FeeStat