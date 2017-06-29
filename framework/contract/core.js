module.exports = {

  deposit: async function (currency, amount, srcId, recipientId) {
    if (!recipientId) return 'Invalid recipient'

    app.validate('amount', amount)

    if (app.meta.delegates.indexOf(this.trs.senderPublicKey) === -1) {
      return 'Sender is not a delegate'
    }

    // TODO validate src transaction and params

    let exists = await app.model.Deposit.exists({ srcId: srcId })
    if (exists) return 'Double deposit'

    app.sdb.lock('core.deposit@' + srcId)

    app.balances.increase(recipientId, currency, amount)
    app.sdb.create('Deposit', {
      tid: this.trs.id,
      currency: currency,
      amount: amount,
      srcId: srcId,
      recipientId: recipientId
    })
  },

  withdrawal: async function (currency, amount) {
    app.validate('amount', amount)

    var balance = app.balances.get(this.trs.senderId, currency)

    if (balance.lt(amount)) return 'Insufficient balance'
    app.balances.decrease(this.trs.senderId, currency, amount)
  },

  transfer: async function (currency, amount, recipientId) {
    if (!recipientId) return 'Invalid recipient'

    var balance = app.balances.get(this.trs.senderId, currency)

    if (this.block.height !== 1 && balance.lt(amount)) return 'Insufficient balance'
    app.balances.transfer(currency, amount, this.trs.senderId, recipientId)
    app.sdb.create('Transfer', {
      tid: this.trs.id,
      senderId: this.trs.senderId,
      recipientId: recipientId,
      currency: currency,
      amount: amount
    })
  }
}