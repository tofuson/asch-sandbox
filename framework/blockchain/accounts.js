var util = require("util");
var crypto = require("crypto");
var bignum = require("bignumber");
var extend = require("extend");
var addressHelper = require('../helpers/address.js');

var private = {}, self = null,
	library = null, modules = null;

private.accounts = [];
private.accountsIndexById = {};
private.executor = null;

function Accounts(cb, _library) {
	self = this;
	library = _library;

	cb(null, self);
}

function reverseDiff(diff) {
	var copyDiff = diff.slice();
	for (var i = 0; i < copyDiff.length; i++) {
		var math = copyDiff[i][0] == "-" ? "+" : "-";
		copyDiff[i] = math + copyDiff[i].slice(1);
	}
	return copyDiff;
}

function applyDiff(source, diff) {
	var res = source ? source.slice() : [];

	for (var i = 0; i < diff.length; i++) {
		var math = diff[i][0];
		var val = diff[i].slice(1);

		if (math == "+") {
			res = res || [];

			var index = -1;
			if (res) {
				index = res.indexOf(val);
			}
			if (index != -1) {
				return false;
			}

			res.push(val);
		}
		if (math == "-") {
			var index = -1;
			if (res) {
				index = res.indexOf(val);
			}
			if (index == -1) {
				return false;
			}
			res.splice(index, 1);
			if (!res.length) {
				res = null;
			}
		}
	}
	return res;
}

private.addAccount = function (account, scope) {
	if (!account.address) {
		account.address = self.generateAddressByPublicKey(account.publicKey);
	}
	account.balance = account.balance || {};
	account.u_balance = account.u_balance || {};
	account.balance["XAS"] = account.balance["XAS"] || 0;
	account.u_balance["XAS"] = account.u_balance["XAS"] || 0;
	(scope || private).accounts.push(account);
	var index = (scope || private).accounts.length - 1;
	(scope || private).accountsIndexById[account.address] = index;

	return account;
}

private.removeAccount = function (address, scope) {
	var index = (scope || private).accountsIndexById[address];
	delete (scope || private).accountsIndexById[address];
	(scope || private).accounts[index] = undefined;
}

private.getAccount = function (address, scope) {
	var index = (scope || private).accountsIndexById[address];
	return (scope || private).accounts[index];
}

Accounts.prototype.clone = function (cb) {
	var r = {
		data: extend(true, {}, private.accounts),
		index: extend(true, {}, private.accountsIndexById)
	};

	for (var i in r.data) {
		for (var t in r.data[i].u_balance) {
			r.data[i].u_balance[t] = r.data[i].balance[t] || 0;
		}
	}

	cb(null, r);
}

Accounts.prototype.getExecutor = function (cb) {
	var secret = app.secret;
	if (!secret) {
		return setImmediate(cb, "Secret is null");
	}
	if (private.executor) {
		return setImmediate(cb, null, private.executor);
	}
	var keypair = modules.api.crypto.keypair(secret);
	var address = self.generateAddressByPublicKey(keypair.publicKey.toString("hex"));
	private.executor = {
		address: address,
		keypair: keypair,
		secret: secret
	}
	cb(null, private.executor);
}

Accounts.prototype.generateAddressByPublicKey = function (publicKey) {
	return addressHelper.generateBase58CheckAddress(publicKey)
}

Accounts.prototype.getAccount = function (filter, cb, scope) {
	var address = filter.address;
	if (filter.publicKey) {
		address = self.generateAddressByPublicKey(filter.publicKey);
	}
	if (!address) {
		return cb("Account not found");
	}

	cb(null, private.getAccount(address, scope));
}

Accounts.prototype.getAccounts = function (cb, scope) {
	var result = (scope || private).accounts.filter(function (el) {
		if (!el) return false;
		return true;
	})
	cb(null, result);
}

Accounts.prototype.setAccountAndGet = function (data, cb, scope) {
	var address = data.address || null;
	if (address === null) {
		if (data.publicKey) {
			address = self.generateAddressByPublicKey(data.publicKey);
		} else {
			return cb("Missing address or publicKey");
		}
	}
	var account = private.getAccount(address, scope);

	if (!account) {
		account = private.addAccount(data, scope);
	} else {
		extend(account, data);
	}

	cb(null, account);
}

Accounts.prototype.mergeAccountAndGet = function (data, cb, scope) {
	var address = data.address || null;
	if (address === null) {
		if (data.publicKey) {
			address = self.generateAddressByPublicKey(data.publicKey);
		} else {
			return cb("Missing address or publicKey");
		}
	}

	var account = private.getAccount(address, scope);

	if (!account) {
		var raw = { address: address };
		if (data.publicKey) {
			raw.publicKey = data.publicKey;
		}
		account = private.addAccount(raw, scope);
	}

	Object.keys(data).forEach(function (key) {
		var trueValue = data[key];
		if (typeof trueValue == "number") {
			account[key] = (account[key] || 0) + trueValue;
		} else if (util.isArray(trueValue)) {
			account[key] = applyDiff(account[key], trueValue);
		} else if (typeof trueValue == "object") {
			for (var token in trueValue) {
				account[key][token] = (account[key][token] || 0) + trueValue[token];
			}
		}
	})

	cb(null, account);
}

Accounts.prototype.undoMerging = function (data, cb, scope) {
	var address = data.address || null;
	if (address === null) {
		if (data.publicKey) {
			address = self.generateAddressByPublicKey(data.publicKey);
		} else {
			return cb("Missing address or publicKey");
		}
	}
	var account = private.getAccount(address, scope);

	if (!account) {
		var raw = { address: address };
		if (data.publicKey) {
			raw.publicKey = data.publicKey;
		}
		account = private.addAccount(raw, scope);
	}

	Object.keys(data).forEach(function (key) {
		var trueValue = data[key];
		if (typeof trueValue == "number") {
			account[key] = (account[key] || 0) - trueValue;
		} else if (util.isArray(trueValue)) {
			trueValue = reverseDiff(trueValue);
			account[key] = applyDiff(account[key], trueValue);
		} else if (typeof trueValue == "object") {
			for (var token in trueValue) {
				account[key][token] = (account[key][token] || 0) - trueValue[token];
			}
		}
	});

	cb(null, account);
}

Accounts.prototype.onBind = function (_modules) {
	modules = _modules;
}

Accounts.prototype.login = function (req, cb) {
	var query = req.query
	if (!query.secret) {
		return cb('secret should not be empty');
	}

	(async () => {
		try {
			var keypair = modules.api.crypto.keypair(query.secret);
			var address = self.generateAddressByPublicKey(keypair.publicKey.toString("hex"));
			var balances = await app.model.Balance.findAll({
				condition: {address: address},
				fields: ['currency', 'balance']
			})
			var account = {
				address: address,
				publicKey: keypair.publicKey.toString('hex'),
				balances: balances
			}
			cb(null, { account: account });
		} catch (e) {
			cb('Server error: ' + e)
		}
	})()
}

Accounts.prototype.getBalances = function (req, cb) {
	if (!req.params || !req.params.address) {
		return cb('Address should not be empty');
	}

	(async () => {
		try {
			var address = req.params.address
			var balances = await app.model.Balance.findAll({
				condition: {address: address},
				fields: ['currency', 'balance']
			})
			cb(null, { balances: balances });
		} catch (e) {
			cb('Server error: ' + e)
		}
	})()
}

Accounts.prototype.open2 = function (query, cb) {
	if (!query.publicKey) {
		return cb("publicKey should not be empty");
	}

	try {
		var publicKey = new Buffer(query.publicKey, "hex");

		if (publicKey.length != 32) {
			return cb("publicKey should be hex format");
		}
	} catch (e) {
		return cb("Invalid publicKey");
	}
	var address = self.generateAddressByPublicKey(query.publicKey);
	var account = private.getAccount(address);

	if (!account) {
		account = private.addAccount({
			address: address,
			publicKey: query.publicKey
		});
	} else {
		account.publicKey = query.publicKey;
	}

	cb(null, { account: account });
}

module.exports = Accounts;
