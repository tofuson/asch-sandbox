var private = {}, self = null,
	library = null, modules = null;
private.historyIds = new Set;
private.unconfirmedContracts = new Map;

function Transactions(cb, _library) {
	self = this;
	library = _library;
	cb(null, self);
}

Transactions.prototype.getUnconfirmedTransaction = function (id) {
	return private.unconfirmedContracts[id].transaction
}

Transactions.prototype.processUnconfirmedTransactionAsync = async function (transaction, cb, scope) {
	var bytes = modules.logic.transaction.getBytes(transaction)
	var id = modules.api.crypto.getId(bytes)
	if (transaction.id) {
		if (transaction.id != id) {
			throw new Error('Incorrect trainsaction id')
		}
	} else {
		transaction.id = id
	}

	if (private.unconfirmedContracts.has(transaction.id)) {
		throw new Error('Transaction already processed')
	}

	var confirmedTrs = await modules.api.transactions.getTransactionAsync(transaction.id)
	if (confirmedTrs) {
		throw new Error('Transaction already confirmed')
	}

	var sender = await modules.blockchain.accounts.setAccountAndGetAsync({ publicKey: transaction.senderPublicKey })
	if (!modules.logic.transaction.verify(transaction, sender)) {
		throw new Error('Failed to verify transaction')
	}

	var Contract = modules.contracts[transaction.func]
	var contract = new Contract
	contract.transaction = transaction
	contract.sender = sender
	await contract.verify.apply(contract, transaction.args)
	this.addUnconfirmedContract(contract)
	return transaction
}

Transactions.prototype.addUnconfirmedContract = function (contract) {
	var id = contract.transaction.id
	private.unconfirmedContracts.set(id, contract)
}

Transactions.prototype.getUnconfirmedTransactionList = function (reverse) {
	var a = []
	private.unconfirmedContracts.forEach(function (v) {
		reverse ? a.unshift(v.transaction) : a.push(v.transaction)
	})
}

Transactions.prototype.removeUnconfirmedTransaction = function (id) {
	delete private.unconfirmedContracts[id]
}

Transactions.prototype.addTransaction = function (cb, query) {
	(async function () {
		try {
			var trs = await self.processUnconfirmedTransactionAsync(transaction)
			cb(null, { transaction: trs })
		} catch (e) {
			cb(e.toString())
		}
	})
}

Transactions.prototype.getTransactions = function (cb, query) {
	self.getUnconfirmedTransactionList(false, cb)
}

Transactions.prototype.onMessage = function (query) {
	switch (query.topic) {
		case "transaction":
			var transaction = query.message;
			(async function () {
				try {
					await self.processUnconfirmedTransactionAsync(transaction)
				} catch (e) {
					library.logger("Failed to process unconfirmed transaction", e)
				}
			})()
			break;
	}
}

Transactions.prototype.onBind = function (_modules) {
	modules = _modules;
}

module.exports = Transactions;
