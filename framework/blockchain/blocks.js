var crypto = require("crypto");
var path = require("path");
var async = require("async");
var extend = require("extend");
var bignum = require("bignumber");
var slots = require("../helpers/slots.js");

var private = {}, self = null,
	library = null, modules = null;

private.lastBlock = null;
private.genesisBlock = null;
private.loaded = false;

function Blocks(cb, _library) {
	self = this;
	library = _library;

	try {
		private.genesisBlock = require(path.join(app.rootDir, "genesis.json"));
	} catch (e) {
		library.logger("Failed to load genesis.json");
		process.exit(3)
		return
	}

	private.lastBlock = private.genesisBlock;

	cb(null, self);
}

private.deleteBlock = function (blockId, cb) {
	modules.api.sql.remove({
		table: "blocks",
		condition: {
			id: blockId
		}
	}, cb);
}

private.popLastBlock = function (oldLastBlock, cb) {
	if (!oldLastBlock.prevBlockId) {
		return cb("Can't remove genesis block");
	}
	self.getBlock(function (err, previousBlock) {
		if (err || !previousBlock) {
			return cb(err || "Previous block is null");
		}

		previousBlock = self.readDbRows(previousBlock);

		var fee = 0;
		async.eachSeries(oldLastBlock.transactions.reverse(), function (transaction, cb) {
			async.series([
				function (cb) {
					fee += transaction.fee;
					modules.blockchain.transactions.undo(transaction, cb);
				}, function (cb) {
					modules.blockchain.transactions.undoUnconfirmed(transaction, cb);
				}
			], cb);
		}, function (err) {
			if (err) {
				library.logger(err);
				process.exit(0);
			}

			modules.blockchain.accounts.undoMerging({
				publicKey: oldLastBlock.delegate,
				balance: { "XAS": fee }
			}, function (err) {
				private.deleteBlock(oldLastBlock.id, function (err) {
					if (err) {
						return cb(err);
					}

					cb(null, previousBlock[0]);
				});
			});
		});
	}, { id: oldLastBlock.prevBlockId });
}

private.verify = async function (block) {
	// console.log('enter Blocks#verify')
	if (!block) {
		console.log('verify block undefined');
		return
	}

	try {
		if (!modules.logic.block.verifyId(block)) {
			throw new Error('Invalid block id')
		}
	} catch (e) {
		throw new Error('Failed to verify block id: ' + e)
	}

	try {
		if (!modules.logic.block.verifySignature(block)) {
			throw new Error('Invalid block signature')
		}
	} catch (e) {
		throw new Error('Failed to verify signature: ' + e)
	}

	if (block.delegates) {
		throw new Error("Invalid delegates in block");
	}

	if (block.id !== private.genesisBlock.id) {
		if (block.prevBlockId != private.lastBlock.id) {
			throw new Error("Invalid previous block");
		}

		if (block.pointHeight < private.lastBlock.pointHeight) {
			throw new Error("Invalid point height")
		}

		if (block.timestamp <= private.lastBlock.timestamp || block.timestamp > slots.getNow()) {
			throw new Error("Invalid timestamp");
		}

		let pointBlock = await PIFY(modules.api.blocks.getBlock)(block.pointId)
		if (!pointBlock) {
			throw new Error('Point block not found')
		}
		let pointExists = await app.model.Block.exists({ pointId: block.pointId })
		if (pointExists) {
			throw new Error('Parent block already pointed')
		}
	}

	if (block.payloadLength > 1024 * 1024) {
		throw new Error("Invalid payload length");
	}

	try {
		var hash = new Buffer(block.payloadHash, "hex");
		if (hash.length != 32) {
			throw new Error("Invalid payload hash");
		}
	} catch (e) {
		throw new Error("Invalid payload hash");
	}

	console.log('before verify transaction signature')
	let payloadHash = crypto.createHash('sha256')
	let payloadLength = 0
	try {
		for (let i in block.transactions) {
			let t = block.transactions[i]
			var bytes = modules.logic.transaction.getBytes(t, true)
			payloadHash.update(bytes)
			payloadLength += bytes.length

			let valid = modules.logic.transaction.verifyBytes(t.senderPublicKey, t.signature, bytes)
			if (!valid) {
				throw new Error('Invalid transaction signature')
			}
		}
	} catch (e) {
		throw new Error('Failed to verify transaction: ' + e)
	}
	console.log('after verify transaction signature')

	payloadHash = payloadHash.digest()

	if (payloadLength != block.payloadLength) {
		throw new Error('Payload length is incorrect')
	}

	if (payloadHash.toString("hex") != block.payloadHash) {
		throw new Error('Payload hash is incorrect')
	}
}

private.getIdSequence = function (height, cb) {
	(async () => {
		try {
			let blocks = await app.model.Block.findAll({
				fields: ['id', 'height'],
				condition: {
					height: { $lte: height }
				},
				sort: {
					height: -1
				},
				limit: 5
			})
			let ids = blocks.map((b) => {
				return b.id
			})
			return cb(null, { ids: ids, firstHeight: blocks[0].height })
		} catch (e) {
			cb(e)
		}
	})()
}

private.rollbackUntilBlock = function (block, cb) {
	modules.api.sql.select({
		table: "blocks",
		condition: {
			pointId: block.pointId,
			pointHeight: block.pointHeight
		},
		fields: ["id", "height"]
	}, { "id": String, "height": Number }, function (err, found) {
		if (!err && found.length) {
			console.log("Blocks#rollbackUntilBlock", found);
			self.deleteBlocksBefore(found[0], cb);
		} else {
			cb();
		}
	});
}

Blocks.prototype.processFee = function (block) {
	if (!block || !block.transactions) return
	for (let t of block.transactions) {
		let feeInfo = app.getFee(t.type) || app.defaultFee
		app.feePool.add(feeInfo.currency, t.fee)
	}
}

Blocks.prototype.processBlock = async function (block, options) {
	//library.logger('processBlock block', block)
	//library.logger('processBlock options', options)
	console.log('ProcessBlock', block.id, block.height)
	if (!options.local) {
		try {
			modules.logic.block.normalize(block)
			await private.verify(block)
			// TODO performance optimization 
			// for (let i in block.transactions) {
			// 	modules.logic.transaction.normalize(block.transactions[i])
			// }
		} catch (e) {
			library.logger('Failed to verify block: ' + e)
			throw e
		}
		console.log('before applyBlock')
		try {
			await self.applyBlock(block, options)
		} catch (e) {
			library.logger('Failed to apply block: ' + e)
			throw e
		}
	}
	try {
		self.processFee(block)
		self.saveBlock(block)
		await self.applyRound(block)
		await app.sdb.commitBlock()
	} catch (e) {
		console.log('save block error: ', e)
		app.sdb.rollbackBlock()
		throw new Error('Failed to save block: ' + e)
	}
	if (options.broadcast) {
		modules.api.transport.message('block', block)
	}
	console.log('Block applied correctly with ' + block.count + ' transactions')
	self.setLastBlock(block)
}

Blocks.prototype.applyRound = async function (block) {
	// TODO process delegate change
	let delegates = app.meta.delegates
	if (block.height % delegates.length !== 0) return
	console.log('----------------------on round end-----------------------')
	//console.log('app.delegate.length', delegates.length)

	let distributedFees = new Map
	let distributedFeeRemain = new Map
	let fees = app.feePool.getFees()
	console.log('fees', fees)
	fees.forEach((totalFee, currency) => {
		let average = bignum(totalFee).div(delegates.length).floor()
		distributedFees.set(currency, average.toString())
		let remain = bignum(totalFee).sub(average.mul(delegates.length))
		if (remain.gt(0)) {
			distributedFeeRemain.set(currency, remain.toString())
		}
	})
	console.log('distributes', distributedFees, distributedFeeRemain)
	for (let i = 0; i < delegates.length; ++i) {
		let address = modules.blockchain.accounts.generateAddressByPublicKey(delegates[i])
		distributedFees.forEach((amount, currency) => {
			console.log('apply round distributing fee', address, currency, amount)
			app.balances.increase(address, currency, amount)
		})
		if (i === delegates.length - 1) {
			distributedFeeRemain.forEach((amount, currency) => {
				// console.log('apply round distributing fee remain', address, currency, amount)
				app.balances.increase(address, currency, amount)
			})
		}
	}
}

Blocks.prototype.setLastBlock = function (block) {
	// console.log('Blocks#setLastBlock', block)
	private.lastBlock = block
		// TODO process delegates change
	app.feePool.setRound(Math.floor(block.height / app.meta.delegates.length))
}

Blocks.prototype.applyBatchBlock = function (blocks, cb) {
	async.eachSeries(blocks, function (block, cb) {
		modules.blockchain.blocks.applyBlock(block, cb);
	}, cb);
}

Blocks.prototype.saveBatchBlock = function (blocks, cb) {
	var blocks_row = [];
	var transactions_row = [];
	for (var i = 0; i < blocks.length; i++) {
		blocks_row.push([
			blocks[i].id,
			blocks[i].timestamp,
			blocks[i].height,
			blocks[i].payloadLength,
			blocks[i].payloadHash,
			blocks[i].prevBlockId,
			blocks[i].pointId,
			blocks[i].pointHeight,
			blocks[i].delegate,
			blocks[i].signature,
			blocks[i].count
		]);
		for (var n = 0; n < blocks[i].transactions.length; n++) {
			transactions_row.push([
				blocks[i].transactions[n].id,
				blocks[i].transactions[n].type,
				blocks[i].transactions[n].senderId,
				blocks[i].transactions[n].senderPublicKey,
				blocks[i].transactions[n].recipientId,
				blocks[i].transactions[n].amount,
				blocks[i].transactions[n].fee,
				blocks[i].transactions[n].timestamp,
				blocks[i].transactions[n].signature,
				blocks[i].transactions[n].blockId
			]);
		}
	}
	modules.api.sql.batch({
		table: "blocks",
		fields: ["id", "timestamp", "height", "payloadLength", "payloadHash", "prevBlockId", "pointId", "pointHeight", "delegate",
			"signature", "count"],
		values: blocks_row
	}, function (err) {
		if (err) {
			return cb(err);
		}
		modules.api.sql.batch({
			table: "transactions",
			fields: ["id", "type", "senderId", "senderPublicKey", "recipientId", "amount", "fee", "timestamp",
				"signature", "blockId"],
			values: transactions_row
		}, cb);
	});
}

Blocks.prototype.saveBlock = function (block) {
	console.log('Blocks#save height', block.height)
	for (let i in block.transactions) {
		let trs = block.transactions[i]
		trs.height = block.height

		if (trs.args) {
			trs.args = JSON.stringify(trs.args)
		}
		app.sdb.create('Transaction', trs)
	}
	let blockObj = {}
	for (let k in block) {
		if (k !== 'transactions') {
			blockObj[k] = block[k]
		}
	}
	app.sdb.create('Block', blockObj)
	console.log('Blocks#save end')
}

Blocks.prototype.readDbRows = function (rows) {
	var blocks = {};
	var order = [];
	for (var i = 0, length = rows.length; i < length; i++) {
		var __block = modules.logic.block.dbRead(rows[i]);
		if (__block) {
			if (!blocks[__block.id]) {
				order.push(__block.id);
				blocks[__block.id] = __block;
			}

			var __transaction = modules.logic.transaction.dbRead(rows[i]);
			blocks[__block.id].transactions = blocks[__block.id].transactions || {};
			if (__transaction) {
				if (!blocks[__block.id].transactions[__transaction.id]) {
					blocks[__block.id].transactions[__transaction.id] = __transaction;
				}
			}
		}
	}

	blocks = order.map(function (v) {
		blocks[v].transactions = Object.keys(blocks[v].transactions).map(function (t) {
			return blocks[v].transactions[t];
		});
		return blocks[v];
	});

	return blocks;
}

Blocks.prototype.deleteBlocksBefore = function (block, cb) {
	async.whilst(
		function () {
			return !(block.height >= private.lastBlock.height)
		},
		function (next) {
			console.log("Blocks#popLastBlock", private.lastBlock.height);
			private.popLastBlock(private.lastBlock, function (err, newLastBlock) {
				if (!err) {
					private.lastBlock = newLastBlock;
				}
				next(err);
			});
		},
		function (err) {
			setImmediate(cb, err);
		}
	);
}

Blocks.prototype.simpleDeleteAfterBlock = function (height, cb) {
	modules.api.sql.remove({
		table: "blocks",
		condition: {
			height: { $gte: height }
		}
	}, cb);
}

Blocks.prototype.genesisBlock = function () {
	return private.genesisBlock;
}

Blocks.prototype.createBlock = async function (keypair, timestamp, point, cb) {
	let unconfirmedList = modules.blockchain.transactions.getUnconfirmedTransactionList()
	let payloadHash = crypto.createHash('sha256')
	let payloadLength = 0
	for (let i in unconfirmedList) {
		let transaction = unconfirmedList[i]
		let bytes = modules.logic.transaction.getBytes(transaction, true)
		// TODO check payload length when process remote block
		if ((payloadLength + bytes.length) > 8 * 1024 * 1024) {
			throw new Error('Playload length outof range')
		}
		payloadHash.update(bytes)
		payloadLength += bytes.length
	}
	var block = {
		delegate: keypair.publicKey.toString("hex"),
		height: private.lastBlock.height + 1,
		prevBlockId: private.lastBlock.id,
		pointId: point.id,
		timestamp: timestamp,
		pointHeight: point.height,
		count: unconfirmedList.length,
		transactions: unconfirmedList,
		payloadHash: payloadHash.digest().toString("hex"),
		payloadLength: payloadLength
	}

	let blockBytes = modules.logic.block.getBytes(block)
	block.signature = modules.api.crypto.sign(keypair, blockBytes)
	blockBytes = modules.logic.block.getBytes(block)
	block.id = modules.api.crypto.getId(blockBytes)

	await self.processBlock(block, { local: true, broadcast: true })
}

Blocks.prototype.applyBlock = async function (block, options) {
	// console.log('enter applyblock')
	let appliedTransactions = {}

	try {
		app.sdb.beginBlock()
		for (let i in block.transactions) {
			let transaction = block.transactions[i]
			transaction.senderId = modules.blockchain.accounts.generateAddressByPublicKey(transaction.senderPublicKey)

			if (appliedTransactions[transaction.id]) {
				throw new Error("Duplicate transaction in block: " + transaction.id)
			}
			await modules.logic.transaction.apply(transaction, block)
			// TODO not just remove, should mark as applied
			// modules.blockchain.transactions.removeUnconfirmedTransaction(transaction.id)
			appliedTransactions[transaction.id] = transaction
		}
	} catch (e) {
		library.logger('apply block error: ' + e)
		app.sdb.rollbackBlock()
		throw new Error('Failed to apply block: ' + e)
	}
}

Blocks.prototype.loadBlocksPeer = function (height, peer, cb) {
	console.log("Load blocks after:", height)
	modules.api.transport.getPeer(peer, "get", "/blocks/after", { lastBlockHeight: height }, function (err, res) {
		if (err || !res.body || !res.body.success) {
			return cb('Failed to load blocks from peer: ' + (err || res.body.error));
		}
		cb(null, res.body.blocks)
	});
}

Blocks.prototype.loadBlocksOffset = function (limit, offset, cb) {
	console.log('loadBlocksOffset !!!!!!!!!!')
	// self.getBlocks(function (err, blocks) {
	// 	if (err) {
	// 		return cb(err);
	// 	}

	// 	blocks = self.readDbRows(blocks);

	// 	async.eachSeries(blocks, function (block, cb) {
	// 		// private.verify(block, function (err) {
	// 		// if (err) {
	// 		// 	return cb({message: err, block: block});
	// 		// }
	// 		self.applyBlock(block, function (err) {
	// 			if (err) {
	// 				return cb({ block: block, message: err })
	// 			}
	// 			cb();
	// 		});
	// 		// });
	// 	}, cb);
	// }, { limit: limit, offset: offset })
}

Blocks.prototype.findCommon = function (req, cb) {
	let query = req.query
		(async () => {
			try {
				let blocks = await app.model.Block.findAll({
					condition: {
						id: {
							$in: query.ids
						},
						height: { $between: [query.min, query.max] }
					},
					sort: {
						height: 1
					},
				})
				console.log('findCommon', query, blocks)
				if (!blocks || !blocks.length) {
					return cb('Common block not found')
				}
				return cb(null, blocks[blocks.length - 1])
			} catch (e) {
				return cb('Failed to find common block: ' + e)
			}
		})()
}

Blocks.prototype.getCommonBlock = async function (height, peer, cb) {
	let lastBlockHeight = height;

	let idSequence = await PIFY(private.getIdSequence)(lastBlockHeight)
	console.log('getIdSequence', idSequence)
	var max = lastBlockHeight;
	lastBlockHeight = idSequence.firstHeight;

	let params = {
		ids: idSequence.ids,
		max: max,
		min: lastBlockHeight
	}
	let res = await PIFY(modules.api.transport.getPeer)(peer, 'get', '/blocks/common', params)
	if (!res.body) {
		throw new Error('Failed to find common block')
	}
	if (!res.body.success) {
		throw new Error('Get common block error: ' + res.body.error)
	}
	var condition = {
		id: res.body.id,
		height: res.body.height
	}
	if (res.body.prevBlockId) {
		condition.prevBlockId = res.body.prevBlockId
	}
	let block = await app.model.Block.findOne({ condition: condition })
	if (!block) {
		throw new Error('Failed to find local common block')
	}
	return block
}

Blocks.prototype.count = function (_, cb) {
	modules.api.sql.select({
		table: "blocks",
		fields: [{
			expression: "count(*)",
			alias: "count"
		}]
	}, { count: Number }, function (err, rows) {
		if (err) {
			return cb(err);
		}
		cb(err, rows[0].count);
	});
}

Blocks.prototype.getHeight = function (_, cb) {
	cb(null, { height: private.lastBlock.height });
}

Blocks.prototype.getLastBlock = function () {
	return private.lastBlock;
}

Blocks.prototype.getBlock = function (req, cb) {
	let query = req.query
	modules.api.sql.select(extend({}, library.scheme.selector["blocks"], {
		condition: { "b.id": query.id },
		fields: library.scheme.aliasedFields
	}), library.scheme.types, cb);
}

Blocks.prototype.getBlocks = function (req, cb) {
	(async () => {
		try {
			let count = await app.model.Block.count()
			let blocks = await app.model.Block.findAll({
				limit: req.query.limit || 100,
				offset: req.query.offset || 0
			})
			return cb(null, { blocks: blocks, count: count })
		} catch (e) {
			return cb('System error')
		}
	})()
}

Blocks.prototype.getBlocksAfter = function (req, cb) {
	let query = req.query
		(async () => {
			let height = query.lastBlockHeight
			let blocks = await app.model.Block.findAll({
				condition: {
					height: { $gt: height }
				},
				limit: 200,
				sort: { height: 1 }
			})
			if (!blocks || !blocks.length) return cb('Failed to get blocks afet ' + height)
			// console.log('get blocks', blocks)
			let maxHeight = blocks[blocks.length - 1].height
			let transactions = await app.model.Transaction.findAll({
				condition: {
					height: { $gt: height, $lte: maxHeight }
				}
			})
			// console.log('get transactions', transactions)
			let firstHeight = blocks[0].height
			for (let i in transactions) {
				let t = transactions[i]
				t.args = t.args ? JSON.parse(t.args) : []
				let h = t.height
				let b = blocks[h - firstHeight]
				if (!!b) {
					if (!b.transactions) {
						b.transactions = []
					}
					b.transactions.push(t)
				}
			}
			cb(null, { blocks: blocks })
		})()
}

Blocks.prototype.onMessage = function (query) {
	if (query.topic == "block" && private.loaded) {
		// TODO reject this block if already processed
		library.sequence.add(function receiveNewBlock(cb) {
			var block = query.message
			// console.log("check", block.prevBlockId + " == " + private.lastBlock.id, block.id + " != " + private.lastBlock.id)
			if (block.prevBlockId == private.lastBlock.id &&
				block.id != private.lastBlock.id &&
				block.id != private.genesisBlock.id &&
				block.height == private.lastBlock.height + 1) {
				(async () => {
					let success = true
					try {
						app.sdb.rollbackBlock()
						await self.processBlock(block, { local: false, broadcast: true })
					} catch (e) {
						success = false
						library.logger("Blocks#processBlock error", e)
					}
					if (success) {
						for (let i in block.transactions) {
							modules.blockchain.transactions.removeUnconfirmedTransaction(block.transactions[i].id)
						}
					}
					try {
						let unconfirmedTrs = modules.blockchain.transaction.getUnconfirmedTransactionList()
						modules.blockchain.transactions.clearUnconfirmed()
						await modules.blockchain.transactions.receiveTransactionsAsync(unconfirmedTrs)
					} catch (e) {
						console.log('Failed to redo unconfirmed transactions: ' + e)
					}
				})()
			} else {
				cb()
			}
		});
	}

	if (query.topic == "rollback" && private.loaded) {
		library.sequence.add(function rollbackBlock(cb) {
			var block = query.message;
			console.log("rollback", block)
			if (block.pointHeight <= private.lastBlock.pointHeight) {
				private.rollbackUntilBlock(block, function (err) {
					if (err) {
						library.logger("Blocks#rollbackUntilBlock error", err);
					}
					cb(err);
				});
			} else {
				cb();
			}
		});
	}
}

Blocks.prototype.onBlockchainLoaded = function () {
	private.loaded = true;
}

Blocks.prototype.onBind = function (_modules) {
	modules = _modules;

	(async () => {
		try {
			app.meta = await PIFY(modules.api.dapps.getDApp)()
			// console.log('app.meta', app.meta)
			let count = await app.model.Block.count()
			console.log('Blocks found:', count)
			if (count === 0) {
				await self.processBlock(private.genesisBlock, {})
			} else {
				let block = await app.model.Block.findOne({
					condition: {
						height: count
					}
				})
				self.setLastBlock(block)
			}
			library.bus.message('blockchainLoaded')
		} catch (e) {
			library.logger('Failed to prepare local blockchain', e)
			process.exit(0)
		}
	})()
}

module.exports = Blocks;