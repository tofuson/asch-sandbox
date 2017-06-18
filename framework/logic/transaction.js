var assert = require('assert')
var extend = require("extend")
var bignum = require("bignumber")
var ByteBuffer = require("bytebuffer")
var slots = require("../helpers/slots.js")
var helpers = require('../helpers')

var private = {}, self = null,
	library = null, modules = null

//constructor
function Transaction(cb, _library) {
	self = this
	library = _library
	cb(null, self)
}

Transaction.prototype.getId = function (trs) {
	return modules.api.crypto.getId(this.getBytes(trs))
}

Transaction.prototype.getBytes = function (trs, skipSignature) {
	try {


		var bb = new ByteBuffer()
		bb.writeInt(trs.timestamp)
		bb.writeString(trs.fee)
		bb.writeString(trs.func)
		for (let i = 0; i < trs.args.length; ++i) {
			bb.writeString(trs.args[i])
		}

		assert(trs.senderPublicKey instanceof Buffer)
		bb.append(Array.from(trs.senderPublicKey))

		if (!skipSignature && trs.signature) {
			assert(trs.signature instanceof Buffer)
			bb.append(Array.from(trs.signature))
		}

		bb.flip()
	} catch (e) {
		throw Error(e.toString())
	}
	return bb.toBuffer()
}

Transaction.prototype.verifySignature = function (trs, publicKey, signature) {
	if (!signature) return false

	try {
		var bytes = self.getBytes(trs, true)
		var hash = modules.api.crypto.getHash('sha256', bytes)
		var res = modules.api.crypto.verify(publicKey, signature, hash)
	} catch (e) {
		throw Error(e.toString())
	}

	return res
}

Transaction.prototype.verify = function (trs, sender) { //inheritance
	//check sender
	if (!sender) {
		throw new Error("Missing sender")
	}

	//check sender
	if (trs.senderId != sender.address) {
		throw new Error("Invalid sender id: " + trs.id)
	}

	if (trs.timestamp > slots.getNow()) {
		throw new Error("Invalid timestamp")
	}

	//verify signature
	try {
		var valid = self.verifySignature(trs, trs.senderPublicKey, trs.signature)
	} catch (e) {
		throw new Error('verify signature exception: ' + e)
	}
	return valid
}

Transaction.prototype.save = function (trs, cb) {
	modules.api.sql.insert({
		table: "transactions",
		values: {
			id: trs.id,
			timestamp: trs.timestamp,
			senderId: trs.senderId,
			senderPublicKey: trs.senderPublicKey,
			fee: trs.fee,
			signature: trs.signature,
			blockId: trs.blockId,
			func: trs.func,
			args: JSON.stringify(trs.args)
		}
	}, cb)
}

Transaction.prototype.normalize = function (tx) {
	for (var i in tx) {
		if (tx[i] === null || typeof tx[i] === "undefined") {
			delete tx[i]
		}
	}

	var valid = library.validator.validate(tx, {
		type: "object",
		properties: {
			id: {
				type: "string"
			},
			timestamp: {
				type: "integer"
			},
			senderId: {
				type: "string"
			},
			senderPublicKey: {
				type: "string",
				format: "publicKey"
			},
			fee: {
				type: "string",
				minimum: 0
			},
			signature: {
				type: "string",
				format: "signature"
			},
			func: {
				type: "string"
			},
			args: {
				type: "array"
			}
		},
		required: ["id", "timestamp", "senderPublicKey", "fee", "signature", "func", "args"]
	})
	if (!valid) {
		throw new Error(library.validator.getError())
	}
}

Transaction.prototype.dbRead = function (row) {
	if (!row.t_id) {
		return null
	}

	var trs = {
		id: row.t_id,
		timestamp: row.t_timestamp,
		senderId: row.t_senderId,
		senderPublicKey: row.t_senderPublicKey,
		fee: row.t_fee,
		signature: row.t_signature,
		blockId: row.t_blockId,
		func: row.t_func,
		args: JSON.parse(row.t_args)
	}

	return trs
}

Transaction.prototype.onBind = function (_modules) {
	modules = _modules
}

//export
module.exports = Transaction
