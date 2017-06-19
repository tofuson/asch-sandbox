var crypto = require("crypto");
var path = require("path");
var async = require("async");
var extend = require("extend");
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
	console.log('enter Blocks#verify')
	if (!block) {
		console.log('verify block undefined');
		return
	}
	try {
		var valid = modules.logic.block.verifySignature(block);
	} catch (e) {
		throw new Error('Failed to verify signature: ' + e)
	}
	if (!valid) {
		throw new Error('Invalid block signature')
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

	let payloadHash = crypto.createHash('sha256')
	let payloadLength = 0
	try {
		for (let i in block.transactions) {
			let transaction = block.transactions[i]
			var bytes = modules.logic.transaction.getBytes(transaction)
			payloadHash.update(bytes)
			payloadLength += bytes.length

			let valid = modules.logic.transaction.verify(transaction)
			if (!valid) {
				throw new Error('Invalid transaction signature')
			}
		}
	} catch (e) {
		throw new Error('Failed to verify transaction: ' + e)
	}
	
	payloadHash = payloadHash.digest()

	if (payloadLength != block.payloadLength) {
		throw new Error('Payload length is incorrect')
	}

	if (payloadHash.toString("hex") != block.payloadHash) {
		throw new Error('Payload hash is incorrect')
	}
}

private.getIdSequence = function (height, cb) {
	modules.api.sql.select({
		query: {
			type: "union",
			unionqueries: [{
				table: "blocks",
				fields: [{ id: "id" }, { expression: "max(height)", alias: "height" }],
				group: {
					expression: "(cast(height / 101 as integer) + (case when height % 101 > 0 then 1 else 0 end))",
					having: {
						height: { $lte: height }
					}
				}
			}, {
					table: "blocks",
					condition: {
						height: 1
					},
					fields: [{ id: "id" }, { expression: "1", alias: "height" }]
				}],
			sort: {
				height: 1
			},
			limit: 1000
		},
		alias: "s",
		fields: [{ height: "height" }, { expression: "group_concat(s.id)", alias: "ids" }]
	}, { height: Number, ids: Array }, function (err, rows) {
		if (err || !rows.length) {
			return cb(err || "Failed to get block id sequence")
		}
		cb(null, rows[0]);
	});
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

private.processBlock = async function (block, options) {
	//library.logger('processBlock block', block)
	//library.logger('processBlock options', options)
	console.log('--------enter processBlock')
	try {
		var blockBytes = modules.logic.block.getBytes(block);
		block.id = modules.api.crypto.getId(blockBytes);

		modules.logic.block.normalize(block)
		await private.verify(block)
		for (let i in block.transactions) {
			modules.logic.transaction.normalize(block.transactions[i])
		}
	} catch (e) {
		library.logger('Failed to verify block: ' + e)
		return
	}
	console.log('--------before applyBlock')
	try {
		if (options.local) {
			app.sdb.rollbackBlock()
		}
		await self.applyBlock(block, options)
		modules.api.transport.message('block', block)
		self.setLastBlock(block)
		console.log('Block applied ' + block.height + ' ' + block.id)
	} catch (e) {
		library.logger('Failed to apply block: ' + e)
		return
	}
}

Blocks.prototype.setLastBlock = function (block) {
	private.lasetBlock = block
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
	for (let i in block.transactions) {
		let trs = block.transactions[i]
		trs.height = block.height

		// TODO encode array
		if (trs.args) {
			trs.args = trs.args.join('|')
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

Blocks.prototype.createBlock = async function (executor, timestamp, point, cb) {
	let unconfirmedList = modules.blockchain.transactions.getUnconfirmedTransactionList()
	let payloadHash = crypto.createHash('sha256')
	let payloadLength = 0
	for (let i in unconfirmedList) {
		let transaction = unconfirmedList[i]
		let bytes = modules.logic.transaction.getBytes(transaction)
		if ((payloadLength + bytes.length) > 8 * 1024 * 1024) {
			throw new Error('Playload length outof range')
		}
		payloadHash.update(bytes)
		payloadLength += bytes.length
	}
	var block = {
		delegate: executor.keypair.publicKey.toString("hex"),
		height: private.lastBlock.height + 1,
		prevBlockId: private.lastBlock.id,
		pointId: point.id,
		timestamp: timestamp,
		pointHeight: point.height,
		count: ready.length,
		transactions: unconfirmedList,
		payloadHash: payloadHash.digest().toString("hex"),
		payloadLength: payloadLength
	}

	let blockBytes = modules.logic.block.getBytes(block)

	block.id = modules.api.crypto.getId(blockBytes)
	block.signature = modules.api.crypto.sign(executor.keypair, blockBytes)

	await private.processBlock(block, { save: true, local: true })
}

Blocks.prototype.applyBlock = async function (block, options) {
	console.log('enter applyblock')
	let appliedTransactions = {}
	let fee = 0

	try {
		app.sdb.beginBlock()
		for (let i in block.transactions) {
			let transaction = block.transactions[i]
			transaction.senderId = modules.blockchain.accounts.generateAddressByPublicKey(transaction.senderPublicKey)

			if (appliedTransactions[transaction.id]) {
				throw new Error("Duplicate transaction in block: " + transaction.id)
			}

			let [mod, func] = transaction.func.split('.')
			if (!mod || !func) {
				throw new Error('Invalid transaction function')
			}
			let fn = app.contract[mod][func]
			if (!fn) {
				throw new Error('Contract not found')
			}
			let bind = {
				trs: transaction,
				block: block
			}

			app.sdb.beginTransaction()
			let error = await fn.apply(bind, transaction.args)
			if (error) {
				throw new Error('Failed to apply transaction: ' + error)
			}

			app.sdb.commitTransaction()
			// TODO not just remove, should mark as applied
			modules.blockchain.transactions.removeUnconfirmedTransaction(transaction.id)
			appliedTransactions[transaction.id] = transaction;
			fee += transaction.fee;
		}

		// TODO process fee

		if (options.save) {
			self.saveBlock(block)
		}

		await app.sdb.commitBlock()
	} catch (e) {
		library.logger('apply block error: ' + e)
		app.sdb.rollbackBlock()
		throw new Error('Failed to apply block: ' + e)
	}
}

Blocks.prototype.loadBlocksPeer = function (peer, cb, scope) {
	console.log("Load blocks after:", scope.lastBlock.height)
	modules.api.transport.getPeer(peer, "get", "/blocks/after", { lastBlockHeight: scope.lastBlock.height }, function (err, res) {
		if (err || !res.body || !res.body.success) {
			return cb(err);
		}

		var blocks = self.readDbRows(res.body.body);

		async.eachSeries(blocks, function (block, cb) {
			private.processBlock(block, cb, scope);
		}, function (err) {
			cb(err, blocks)
		});
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

Blocks.prototype.findCommon = function (cb, query) {
	modules.api.sql.select({
		table: "blocks",
		condition: {
			id: {
				$in: query.ids
			},
			height: { $between: [query.min, query.max] }
		},
		sort: {
			height: 1
		},
		fields: [{ expression: "max(height)", alias: "height" }, "id", "prevBlockId"]
	}, { "height": Number, "id": String, "prevBlockId": String }, function (err, rows) {
		if (err) {
			return cb(err);
		}

		var commonBlock = rows.length && rows[0].height ? rows[0] : null;
		cb(commonBlock ? null : "No common block", commonBlock);
	});
}

Blocks.prototype.getCommonBlock = function (height, peer, cb) {
	var commonBlock = null;
	var lastBlockHeight = height;
	var count = 0;

	async.whilst(
		function () {
			return !commonBlock && count < 30;
		},
		function (next) {
			count++;
			private.getIdSequence(lastBlockHeight, function (err, data) {
				if (err) {
					return next(err);
				}
				var max = lastBlockHeight;
				lastBlockHeight = data.height;
				modules.api.transport.getPeer(peer, "get", "/blocks/common", {
					ids: data.ids,
					max: max,
					min: lastBlockHeight
				}, function (err, data) {
					if (err || !data.body || !data.body.success) {
						return next(err || "Failed to find common block");
					}

					if (!data.body) {
						return next("Failed to find common block");
					}

					var condition = {
						id: data.body.id,
						height: data.body.height
					};
					if (data.body.prevBlockId) {
						condition.prevBlockId = data.body.prevBlockId
					}
					modules.api.sql.select({
						table: "blocks",
						condition: condition,
						fields: [{ expression: "count(id)", alias: "count" }]
					}, { "count": Number }, function (err, rows) {
						if (err || !rows.length) {
							return next(err || "Block comparision failed");
						}

						if (rows[0].count) {
							commonBlock = data.body;
						}
						next();
					});
				});
			});
		},
		function (err) {
			setImmediate(cb, err, commonBlock);
		}
	)
}

Blocks.prototype.count = function (cb) {
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

Blocks.prototype.getHeight = function (cb) {
	cb(null, private.lastBlock.height);
}

Blocks.prototype.getLastBlock = function () {
	return private.lastBlock;
}

Blocks.prototype.getBlock = function (cb, query) {
	modules.api.sql.select(extend({}, library.scheme.selector["blocks"], {
		condition: { "b.id": query.id },
		fields: library.scheme.aliasedFields
	}), library.scheme.types, cb);
}

Blocks.prototype.getBlocks = function (cb, query) {
	modules.api.sql.select(extend({}, library.scheme.selector["blocks"], {
		limit: !query.limit || query.limit > 1000 ? 1000 : query.limit,
		offset: !query.offset || query.offset < 0 ? 0 : query.offset,
		fields: library.scheme.aliasedFields,
		sort: {
			height: 1
		}
	}), library.scheme.types, cb);
}

Blocks.prototype.getBlocksAfter = function (cb, query) {
	modules.api.sql.select(extend({}, library.scheme.selector["blocks"], {
		limit: 1000,
		condition: {
			"b.height": { $gt: query.lastBlockHeight }
		},
		fields: library.scheme.aliasedFields,
		sort: {
			height: 1
		}
	}), library.scheme.types, cb);
}

Blocks.prototype.onMessage = function (query) {
	if (query.topic == "block" && private.loaded) {
		library.sequence.add(function (cb) {
			var block = query.message
			// console.log("check", block.prevBlockId + " == " + private.lastBlock.id, block.id + " != " + private.lastBlock.id)
			if (block.prevBlockId == private.lastBlock.id && block.id != private.lastBlock.id && block.id != private.genesisBlock.id) {
				(async () => {
					try {
						await private.processBlock(block, { save: true, local: false })
					} catch (e) {
						library.logger("Blocks#processBlock error", e)
					}
				})()
			}
			cb()
		});
	}

	if (query.topic == "rollback" && private.loaded) {
		library.sequence.add(function (cb) {
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
			let count = await app.model.Block.count({ id: private.genesisBlock.id })
			if (count === 0) {
				await private.processBlock(private.genesisBlock, { save: true })
			}
			let block = await app.model.Block.findOne({
				condition: {
					height: count
				}
			})
			self.setLastBlock(block)
			library.bus.message('blockchainLoaded')
		} catch (e) {
			library.logger('Failed to prepare local blockchain', e)
			process.exit(0)
		}
	})()
}

module.exports = Blocks;
