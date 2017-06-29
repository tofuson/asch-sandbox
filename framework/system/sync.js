var bignum = require("bignumber");
var async = require("async");
var ip = require("ip");

var private = {}, self = null,
	library = null, modules = null;

function Sync(cb, _library) {
	self = this;
	library = _library;
	cb(null, self);
}

private.createSandbox = function (commonBlock, cb) {
	modules.blockchain.accounts.clone(function (err, accountDB) {
		var sb = {
			lastBlock: commonBlock,
			accounts: accountDB.data,
			accountsIndexById: accountDB.index,
			unconfirmedTransactions: [],
			unconfirmedTransactionsIdIndex: {},
			doubleSpendingTransactions: {}
		}

		cb(null, sb);
	});
}

private.findUpdate = function (lastBlock, peer, cb) {
	(async () => {
		try {
			let commonBlock = await modules.blockchain.blocks.getCommonBlock(lastBlock.height, peer)
			console.log('Get common block', commonBlock.height, commonBlock.id)
			if (commonBlock.height !== lastBlock.height) {
				return cb('Reject fork chain')
			}

			let blocks = await PIFY(modules.blockchain.blocks.loadBlocksPeer)(commonBlock.height, peer)
			console.log('Loading ' + blocks.length + ' blocks')
			for (let i in blocks) {
				let b = blocks[i]
				if (b.height > lastBlock.height) {
					await modules.blockchain.blocks.processBlock(b, {})
				}
			}
			console.log('Sync blocks completed')
			return cb()
		} catch (e) {
			return cb('Failed to sync blocks: ' + e)
		}
	})()
}

private.transactionsSync = function transactionsSync(cb) {
	modules.api.transport.getRandomPeer("get", "/transactions", null, function (err, res) {
		if (err || !res.body || !res.body.success) {
			return cb(err || res.body.error);
		}
		if (!res.body.transactions || !res.body.transactions.length) return cb()
		modules.blockchain.transactions.receiveTransactions(res.body.transactions, cb)
	});
}

private.blockSync = function blockSync(cb) {
	modules.api.blocks.getHeight(function (err, height) {
		if (err) return cb('Failed to get main block height: ' + err)
		console.log('get main block height', height)
		var lastBlock = modules.blockchain.blocks.getLastBlock();
		if (lastBlock.pointHeight == height) {
			return cb();
		}

		modules.api.transport.getRandomPeer("get", "/blocks/height", null, function (err, res) {
			if (err) return cb('Failed to get blocks height: ' + err)
			console.log('blockSync get block height', res)
			if (!res.body || !res.body.success) return cb('Failed to get blocks height: ' + res.body)
			if (bignum(lastBlock.height).gte(res.body.height)) return cb()
			private.findUpdate(lastBlock, res.peer, cb);
		});
	});
}

private.loadMultisignatures = function loadMultisignatures(cb) {
	modules.blockchain.accounts.getExecutor(function (err, executor) {
		if (err) {
			return cb(err);
		}
		modules.api.multisignatures.pending(executor.keypair.publicKey.toString("hex"), true, function (err, resp) {
			if (err) {
				return cb(err.toString());
			} else {
				var errs = [];
				var transactions = resp.transactions;

				async.eachSeries(transactions, function (item, cb) {
					modules.api.multisignatures.sign(
						executor.secret,
						null,
						item.transaction.id,
						function (err) {
							if (err) {
								errs.push(err);
							}

							setImmediate(cb);
						}
					)
				}, function () {
					if (errs.length > 0) {
						return cb(errs[0]);
					}

					cb();
				});
			}
		});
	});
}

Sync.prototype.onBind = function (_modules) {
	modules = _modules;
}

Sync.prototype.onBlockchainLoaded = function () {
	// setImmediate(function nextWithdrawalSync() {
	// 	library.sequence.add(private.withdrawalSync, function (err) {
	// 		err && library.logger("Sync#withdrawalSync timer", err);
	// 		setTimeout(nextWithdrawalSync, 30 * 1000)
	// 	});
	// });

	// setImmediate(function nextBalanceSync() {
	// 	library.sequence.add(private.balanceSync, function (err) {
	// 		err && library.logger("Sync#balanceSync timer", err);

	// 		setTimeout(nextBalanceSync, 30 * 1000)
	// 	});
	// });

	setImmediate(function nextBlockSync() {
		library.sequence.add(private.blockSync, function (err) {
			err && library.logger("Sync#blockSync timer", err);
			setTimeout(nextBlockSync, 10 * 1000)
		});
	});

	setImmediate(function nextU_TransactionsSync() {
		library.sequence.add(private.transactionsSync, function (err) {
			err && library.logger("Sync#transactionsSync timer", err);

			setTimeout(nextU_TransactionsSync, 10 * 1000)
		});
	});

	setImmediate(function nextMultisigSync() {
		library.sequence.add(private.loadMultisignatures, function (err) {
			err && library.logger("Sync#loadMultisignatures timer", err);

			setTimeout(nextMultisigSync, 10 * 1000);
		});
	});
}

module.exports = Sync;
