var private = {}, self = null,
	library = null, modules = null;

class TransactionPool {
	constructor() {
		this.index = new Map
		this.unConfirmed = new Array
	}

	add(trs) {
		this.unConfirmed.push(trs)
		this.index.set(trs.id, this.unConfirmed.length - 1)
	}

	remove(id) {
		let pos = this.index.get(id)
		delete this.index[id]
		this.unConfirmed[pos] = null
	}

	has(id) {
		let pos = this.index.get(id)
		return !!pos && !!this.unConfirmed[pos]
	}

	getUnconfirmed() {
		var a = [];

		for (var i = 0; i < this.unConfirmed.length; i++) {
			if (!!this.unConfirmed[i]) {
				a.push(this.unConfirmed[i]);
			}
		}
		return a
	}

	clear() {
		this.index = new Map
		this.unConfirmed = new Array
	}

	get(id) {
		let pos = this.index.get(id)
		return this.unConfirmed[pos]
	}
}

function Transactions(cb, _library) {
	self = this;
	library = _library;
	self.pool = new TransactionPool()
	cb(null, self);
}

Transactions.prototype.getUnconfirmedTransaction = function (id) {
	return self.pool.get(id)
}

Transactions.prototype.processUnconfirmedTransactionAsync = async function (transaction) {
	let bytes = modules.logic.transaction.getBytes(transaction)
	let id = modules.api.crypto.getId(bytes)
	if (transaction.id) {
		if (transaction.id != id) {
			throw new Error('Incorrect trainsaction id')
		}
	} else {
		transaction.id = id
	}
	// console.log('process unconfirmed trs', transaction.id, transaction.func)

	if (self.pool.has(transaction.id)) {
		throw new Error('Transaction already processed')
	}

	let valid = modules.logic.transaction.verify(transaction)
	if (!valid) {
		throw new Error('Invalid transaction signature')
	}

	let exists = await app.model.Transaction.exists({ id: transaction.id })
	if (exists) {
		throw new Error('Transaction already confirmed')
	}

	let [mod, func] = transaction.func.split('.')
	if (!mod || !func) {
		throw new Error('Invalid transaction function')
	}
	let fn = app.contract[mod][func]
	if (!fn) {
		throw new Error('Contract not found')
	}
	let height = modules.blockchain.blocks.getLastBlock().height
	let bind = {
		trs: transaction,
		block: {
			height: height,
			delegate: modules.blockchain.round.getCurrentDelegate(height)
		}
	}

	app.sdb.beginTransaction()
	try {
		let error = await fn.apply(bind, transaction.args)
		if (error) {
			throw new Error(error)
		}
	} catch (e) {
		app.sdb.rollbackTransaction()
		throw new Error('Apply transaction exception: ' + e)
	}

	app.sdb.commitTransaction()
	self.pool.add(transaction)
	return transaction
}

Transactions.prototype.getUnconfirmedTransactionList = function () {
	return self.pool.getUnconfirmed()
}

Transactions.prototype.removeUnconfirmedTransaction = function (id) {
	self.pool.remove(id)
}

Transactions.prototype.clearUnconfirmed = function () {
	self.pool.clear()
}

Transactions.prototype.addTransaction = function (query, cb) {
	library.sequence.add(function addTransaction(cb) {
		(async function () {
			try {
				var trs = await self.processUnconfirmedTransactionAsync(query.transaction)
				cb(null, { transactionId: trs.id })
			} catch (e) {
				cb(e.toString())
			}
		})()
	}, cb)
}

Transactions.prototype.addTransactionUnsigned = function (query, cb) {
	let valid = library.validator.validate(query, {
		type: 'object',
		properties: {
			secret: {
				type: 'string'
			},
			fee: {
				type: 'string'
			},
			func: {
				type: 'string'
			},
			args: {
				type: 'array'
			}
		},
		required: ['secret', 'fee', 'func']
	})
	if (!valid) {
		return setImmediate(cb, library.validator.getLastError().details[0].message)
	}
	library.sequence.add(function addTransactionUnsigned(cb) {
		(async function () {
			try {
				let keypair = modules.api.crypto.keypair(query.secret)
				let trs = modules.logic.transaction.create(query, keypair)
				await self.processUnconfirmedTransactionAsync(trs)
				cb(null, { transactionId: trs.id })
			} catch (e) {
				cb(e.toString())
			}
		})()
	}, cb)
}

Transactions.prototype.getTransactions = function (query, cb) {
	setImmediate(cb, null, { transactions: self.getUnconfirmedTransactionList() })
}

Transactions.prototype.receiveTransactions = function (transactions, cb) {
	(async function () {
		try {
			for (let i = 0; i < transactions.length; ++i) {
				await self.processUnconfirmedTransactionAsync(transaction)
			}
		} catch (e) {
			return cb(e)
		}
		cb()
	})()
}

Transactions.prototype.receiveTransactionsAsync = async function (transactions) {
	for (let i = 0; i < transactions.length; ++i) {
		await self.processUnconfirmedTransactionAsync(transaction)
	}
}

Transactions.prototype.onMessage = function (query) {
	switch (query.topic) {
		case "transaction":
			library.sequence.add(function receiveNewTransaction(cb) {
				var transaction = query.message;
				self.receiveTransactions([transaction], function (err) {
					if (err) {
						console.log('Failed to process transactions: ' + err)
					}
				})
			})
			break;
	}
}

Transactions.prototype.onBind = function (_modules) {
	modules = _modules;
}

module.exports = Transactions;
