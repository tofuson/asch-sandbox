var async = require("async");
var crypto = require("crypto");
var slots = require("../helpers/slots.js");

var private = {}, self = null,
	library = null, modules = null;
private.loaded = false;
private.delegates = [];
private.cacheDelegates = {
	height: 0,
	delegates: []
}

function Round(cb, _library) {
	self = this;
	library = _library;

	cb(null, self);
}

private.loop = function (point, cb) {
	modules.blockchain.accounts.getExecutor(function (err, executor) {

		if (err) {
			return cb();
		}

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

		var currentBlockData = private.getState(executor, point.height);
		if (currentBlockData === null) {
			library.logger("Loop", "exit: skipping slot");
			return setImmediate(cb);
		}

		library.sequence.add(function forgeNewBlock(cb) {
			if (slots.getSlotNumber(currentBlockData) == slots.getSlotNumber()) {
				(async function () {
					try {
						await modules.blockchain.blocks.createBlock(executor, currentBlockData, point)
						var lastBlock = modules.blockchain.blocks.getLastBlock();
						library.logger("New dapp block id: " + lastBlock.id + " height: " + lastBlock.height + " via point: " + lastBlock.pointHeight);
					} catch (e) {
						library.logger('Failed to create new block: ', e)
					}
					modules.blockchain.transactions.clearUnconfirmed()
				})()
				cb()
			} else {
				setImmediate(cb)
			}
		}, cb)
	});
}

private.getState = function (executor, height) {
	var delegates = self.generateDelegateList(height);

	var currentSlot = slots.getSlotNumber();
	var lastSlot = slots.getLastSlot(currentSlot);

	for (; currentSlot < lastSlot; currentSlot += 1) {
		var delegate_pos = currentSlot % delegates.length;

		var delegate_id = delegates[delegate_pos];
		if (delegate_id && executor.address == delegate_id) {
			return slots.getSlotTime(currentSlot);
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
