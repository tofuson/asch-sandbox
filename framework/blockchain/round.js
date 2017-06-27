var async = require("async");
var crypto = require("crypto");
var slots = require("../helpers/slots.js");

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
		if (slots.getSlotNumber(currentBlockData.slotTime) == slots.getSlotNumber()) {
			(async function () {
				try {
					await modules.blockchain.blocks.createBlock(currentBlockData.keypair, currentBlockData.slotTime, point)
					var lastBlock = modules.blockchain.blocks.getLastBlock();
					library.logger("New dapp block id: " + lastBlock.id + " height: " + lastBlock.height + " via point: " + lastBlock.pointHeight);
				} catch (e) {
					library.logger('Failed to create new block: ', e)
				}
				modules.blockchain.transactions.clearUnconfirmed()
				cb()
			})()
		} else {
			setImmediate(cb)
		}
	}, cb)
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
				keypair: private.keypairs[delegateAddress]
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
	for (let i in app.secrets) {
		let keypair = modules.api.crypto.keypair(app.secrets[i])
		let address = modules.blockchain.accounts.generateAddressByPublicKey(keypair.publicKey)
		console.log('Forging enable on account: ' + address)
		private.keypairs[address] = keypair
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
}

Round.prototype.onMessage = function (query) {
	if (query.topic == "point" && private.loaded) {
		var block = query.message;
		private.loop(block, function (err) {
			if (err) {
				library.logger("Loop error", err)
			}
		});
	}
}

module.exports = Round;
