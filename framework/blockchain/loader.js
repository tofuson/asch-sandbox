var async = require("async");

var private = {}, self = null,
	library = null, modules = null;

function Loader(cb, _library) {
	self = this;
	library = _library;
	cb(null, self);
}

private.loadBlockChain = async function () {
	// let count = modules.blockchain.blocks.count()

	// library.logger('total blocks ' + count)
	// modules.blockchain.blocks.getBlock()
	// library.bus.message("blockchainLoaded");
}

Loader.prototype.onBind = function (_modules) {
	modules = _modules;
}

Loader.prototype.onBlockchainReady = function () {
	(async () => {
		try {
			await private.loadBlockChain()
		} catch (e) {
			library.logger('Loader#loadBlockChain error: ' + e)
		}
	})()
}

Loader.prototype.onMessage = function (msg) {
}

module.exports = Loader;
