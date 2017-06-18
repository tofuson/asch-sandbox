module.exports = {

  deposit: async function (currency, amount, srcId, recipientId) {
    var trs = this.trs
    var sender = this.sender

    if (!recipientId) return 'Invalid recipient'

    // if (amount <= 0) {
    //   return 'Invalid transaction amount'
    // }

    // if (this.trs.senderPublicKey != modules.blockchain.blocks.genesisBlock().delegate) {
    //   return 'Sender is not a delegate'
    // }

    let count = await app.model.Transaction.count({ where: { srcId: srcId } })
    if (count > 0) return 'Already processed'

    let key = 'core.deposit@' + srcId
    if (app.library.flash.has(key)) return 'Double submit'

    app.flash.set(key, true)

    app.library.sdb.updateBalance(currency, amount, recipientId)
    app.library.sdb.create('deposits')
  },

  withdrawal: async function (currency, amount) {
    // TODO validate arguments

    // if (amount < 0) return 'Invalid amount'

    let balance = app.library.sdb.getBalance(currency, this.trs.senderId)

    // if (balance < amount) return 'Insufficient balance'
    app.library.sdb.updateBalance(currency, '-' + amount, this.trs.senderId)
  },

  transfer: async function (currency, amount, recipientId) {
    if (!recipientId) return 'Invalid recipient'

    var balance = app.library.sdb.getBalance(currency, this.trs.senderId)

    // if (balance < amount) return 'Insufficient balance'
    app.library.sdb.updateBalance(currency, '-' + amount, this.trs.senderId)
    app.library.sdb.updateBalance(currency, amount, recipientId)
  }
}