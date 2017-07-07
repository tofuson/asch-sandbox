var async = require("async");
var crypto = require("crypto");
var AschJS = require("asch-js");
var slots = require("../helpers/slots.js");
var OutTransferManager = require("../helpers/outtransfer-manager.js");

var private = {}
var self = null
var library = null
var modules = null

private.loaded = false
private.delegates = []
private.cacheDelegates = {
	height: 0,
	delegates: []
}
private.keypairs = {}
private.outTransferManager = null

function Round(cb, _library) {
	self = this;
	library = _library;

	cb(null, self);
}

private.loop = function (point, cb) {
	if (!private.loaded) {
		library.logger("Loop", "exit: syncing");
		return setImmediate(cb);
	}

	var currentSlot = slots.getSlotNumber();
	var lastBlock = modules.blockchain.blocks.getLastBlock();

	if (currentSlot == slots.getSlotNumber(lastBlock.timestamp)) {
		// library.logger.log("Loop", "exit: lastBlock is in the same slot");
		return setImmediate(cb);
	}

	var currentBlockData = private.getState(point.height);
	if (currentBlockData === null) {
		library.logger("Loop", "exit: skipping slot");
		return setImmediate(cb);
	}

	library.sequence.add(function forgeNewBlock(cb) {
		(async function () {
			try {
				var slotNumber = slots.getSlotNumber(currentBlockData.slotTime)
				var currentSlotNumber = slots.getSlotNumber()
				if (slotNumber === currentSlotNumber) {
					await private.balanceSync(currentBlockData.keypair)
					await private.withdrawalSync(currentBlockData.secret)
					await modules.blockchain.blocks.createBlock(currentBlockData.keypair, currentBlockData.slotTime, point)
					var lastBlock = modules.blockchain.blocks.getLastBlock();
					app.events.emit('newBlock', lastBlock)
					library.logger("New dapp block id: " + lastBlock.id + " height: " + lastBlock.height + " via point: " + lastBlock.pointHeight);
				}
			} catch (e) {
				library.logger('Failed to create new block: ', e)
			}
			modules.blockchain.transactions.clearUnconfirmed()
			cb()
		})()
	}, cb)
}

private.balanceSync = async function balanceSync(keypair) {
	//console.log('enter balanceSync ------------------------')
	let transactions = await app.model.Transaction.findAll({
		condition: {
			type: 1 // core.deposit
		},
		fields: [
			'args'
		],
		sort: {
			height: -1
		},
		limit: 1
	})
	//console.log('balanceSync found deposit transactions:', transactions)
	let lastSourceId = null
	if (transactions && transactions.length) {
		lastSourceId = JSON.parse(transactions[0].args)[2]
	}
	let mainTransactions = await PIFY(modules.api.dapps.getBalanceTransactions)(lastSourceId)
	if (!mainTransactions || !mainTransactions.length) return

	//console.log('balanceSync mainTransactions:', mainTransactions)

	let localTransactions = mainTransactions.map((mt) => {
		return modules.logic.transaction.create({
			type: 1,// core.deposit
			args: [
				mt.currency,
				mt.currency === 'XAS' ? mt.amount : mt.amount2,
				mt.id,
				modules.blockchain.accounts.generateAddressByPublicKey(mt.senderPublicKey)
			]
		}, keypair)
	})
	await modules.blockchain.transactions.receiveTransactionsAsync(localTransactions)
}

private.withdrawalSync = async function withdrawalSync(secret) {
	let pendingOutTransfers = private.outTransferManager.getPending()
	for (let ot of pendingOutTransfers) {
		if (ot.signatures.length >= app.meta.unlockDelegates) {
			modules.api.dapps.submitOutTransfer(ot)
			private.outTransferManager.setReady(ot.id)
		}
	}
	let lastWithdrawal = await PIFY(modules.api.dapps.getWithdrawalLastTransaction)()
	console.log('get last withdrawal id', lastWithdrawal)
	let height = 0
	if (lastWithdrawal.id) {
		let lastInnerWithdrawal = await app.model.Transaction.findOne({
			condition: {
				id: lastWithdrawal.id
			},
			fields: ['height', 'type']
		})
		console.log('found last inner withdrawal', lastInnerWithdrawal)
		if (!lastInnerWithdrawal) {
			console.log('WARNING last inner withdrawal not found', lastWithdrawal.id)
		} else {
			height = lastInnerWithdrawal.height
		}
	}
	let innerTransactions = await app.model.Transaction.findAll({
		condition: {
			type: 2, // core.withdrawal
			height: { $gt: height }
		},
		fields: ['id', 'senderPublicKey', 'height', 'args'],
		sort: {
			height: 1
		}
	})
	console.log('found inner withdrawal transactions', innerTransactions)
	let outerTransactions = innerTransactions.filter((t) => {
		return !private.outTransferManager.has(t.id)
	}).map((t) => {
		let [currency, amount] = JSON.parse(t.args)
		let address = modules.blockchain.accounts.generateAddressByPublicKey(t.senderPublicKey)
		let ot = AschJS.transfer.createOutTransfer(address, app.meta.transactionId, t.id, currency, amount, secret)
		ot.signatures = []
		for (let s of app.config.secrets) {
			if (s !== secret) {
				ot.signatures.push(AschJS.transfer.signOutTransfer(ot, s))
			}
			if (ot.signatures.length >= app.meta.unlockDelegates) break
		}
		return { innerId: t.id, ot: ot }
	})
	for (let {ot, innerId} of outerTransactions) {
		if (ot.signatures.length >= app.meta.unlockDelegates) {
			modules.api.dapps.submitOutTransfer(ot)
			private.outTransferManager.addReady(ot, innerId)
		} else {
			modules.api.transport.message('pendingOutTransfer', ot)
			private.outTransferManager.addPending(ot, innerId)
		}
	}
	private.outTransferManager.clear()
}

private.getState = function (height) {
	var delegates = self.generateDelegateList(height);

	var currentSlot = slots.getSlotNumber();
	var lastSlot = slots.getLastSlot(currentSlot);

	for (; currentSlot < lastSlot; currentSlot += 1) {
		var pos = currentSlot % delegates.length;

		var delegateAddress = delegates[pos];
		if (delegateAddress && private.keypairs[delegateAddress]) {
			return {
				slotTime: slots.getSlotTime(currentSlot),
				keypair: private.keypairs[delegateAddress].keypair,
				secret: private.keypairs[delegateAddress].secret
			}
		}
	}

	return null;
}

Round.prototype.getCurrentDelegate = function (height) {
	var delegates = self.generateDelegateList(height);

	var currentSlot = slots.getSlotNumber();
	var delegate_pos = currentSlot % delegates.length;

	return delegates[delegate_pos];
}

Round.prototype.calc = function (height) {
	return Math.floor(height / private.delegates.length) + (height % private.delegates.length > 0 ? 1 : 0);
}

Round.prototype.generateDelegateList = function (height) {
	if (private.cacheDelegates.height === height) {
		return private.cacheDelegates.delegates;
	}
	var seedSource = self.calc(height).toString();

	var delegates = private.delegates.slice(0);

	var currentSeed = crypto.createHash("sha256").update(seedSource, "utf8").digest();
	for (var i = 0, delCount = delegates.length; i < delCount; i++) {
		for (var x = 0; x < 4 && i < delCount; i++ , x++) {
			var newIndex = currentSeed[x] % delCount;
			var b = delegates[newIndex];
			delegates[newIndex] = delegates[i];
			delegates[i] = b;
		}
		currentSeed = crypto.createHash("sha256").update(currentSeed).digest();
	}

	private.cacheDelegates = {
		height: height,
		delegates: delegates
	}

	return delegates;
}

Round.prototype.onBind = function (_modules) {
	modules = _modules;
	for (let i in app.config.secrets) {
		let keypair = modules.api.crypto.keypair(app.config.secrets[i])
		let address = modules.blockchain.accounts.generateAddressByPublicKey(keypair.publicKey)
		console.log('Forging enable on account: ' + address)
		private.keypairs[address] = {
			keypair,
			secret: app.config.secrets[i]
		}
	}
}

Round.prototype.onBlockchainLoaded = function () {
	private.loaded = true;

	private.delegates = [];
	for (var i = 0; i < app.meta.delegates.length; i++) {
		private.delegates.push(modules.blockchain.accounts.generateAddressByPublicKey(app.meta.delegates[i]));
		private.delegates.sort();
	}
	slots.setDelegatesNumber(app.meta.delegates.length)
	private.outTransferManager = new OutTransferManager(app.meta.unlockDelegates)
}

Round.prototype.onMessage = function (query) {
	if (!private.loaded) return
	if (query.topic == 'point') {
		var block = query.message;
		private.loop(block, function (err) {
			if (err) {
				library.logger("Loop error", err)
			}
		});
	} else if (query.topic == 'pendingOutTransfer') {
		let ot = query.message
		if (!private.outTransferManager.has(ot)) {
			let signature = AschJS.transfer.signOutTransfer(out)
			private.outTransferManager.addPending(ot)
			private.outTransferManager.addSignature(ot.id, signature)
			modules.api.transport.message('otSignature', {
				id: ot.id,
				signature: signature
			})
		}
	} else if (query.topic == 'otSignature') {
		let id = query.message.id
		let signature = query.message.signature
		private.outTransferManager.addSignature(id, signature)
	} else if (query.topic == 'withdrawalCompleted') {
		let id = query.message.transactionId
		private.outTransferManager.setReady(id)
	}
}

module.exports = Round;
