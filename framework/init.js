var async = require("async");
var path = require('path')
var ZSchema = require("z-schema");
var extend = require("extend");
var changeCase = require("change-case");

var modules = {};
var ready = false;

module.exports = function (options, cb) {
  async.auto({
		sandbox: function (cb) {
			cb(null, options.sandbox);
		},

		logger: function (cb) {
			cb(null, console.log);
		},

		// scheme: ["logger", function (cb, scope) {
		// 	try {
		// 		var db = require("./blockchain.json");
		// 	} catch (e) {
		// 		scope.logger("Failed to load blockchain.json");
		// 	}

		// 	var fields = [],
		// 		aliasedFields = [],
		// 		types = {},
		// 		selector = {};

		// 	function getType(type) {
		// 		var nativeType;

		// 		switch (type) {
		// 			case "BigInt":
		// 				nativeType = Number;
		// 				break;
		// 			default:
		// 				nativeType = String;
		// 		}

		// 		return nativeType;
		// 	}

		// 	var i, n, __field, __alias, __type;

		// 	for (i = 0; i < db.length; i++) {
		// 		for (n = 0; n < db[i].tableFields.length; n++) {
		// 			__field = db[i].alias + "." + db[i].tableFields[n].name;;
		// 			__alias = db[i].alias + "_" + db[i].tableFields[n].name;
		// 			__type = db[i].tableFields[n].type;

		// 			fields.push(__field);
		// 			aliasedFields.push({ field: __field, alias: __alias });
		// 			types[__alias] = getType(__type);
		// 		}

		// 		selector[db[i].table] = extend(db[i], { tableFields: undefined });
		// 	}

		// 	cb(null, { scheme: db, fields: fields, aliasedFields: aliasedFields, types: types, selector: selector });
		// }],

		validator: function (cb) {
			ZSchema.registerFormat("publicKey", function (value) {
				try {
					var b = new Buffer(value, "hex");
					return b.length == 32;
				} catch (e) {
					return false;
				}
			});

			ZSchema.registerFormat("signature", function (value) {
				try {
					var b = new Buffer(value, "hex");
					return b.length == 64;
				} catch (e) {
					return false;
				}
			});

			ZSchema.registerFormat("hex", function (value) {
				try {
					new Buffer(value, "hex");
				} catch (e) {
					return false;
				}

				return true;
			});
			ZSchema.prototype.getError = function () {
				var error = this.getLastErrors()[0]
				if (!error) {
					return "unknow error"
				} else {
					return error.message + ": " + error.path
				}
			}
			var validator = new ZSchema();
			cb(null, validator);
		},

		bus: function (cb) {
			var bus = function () {
				this.message = function () {
					if (ready) {
						var args = [];
						Array.prototype.push.apply(args, arguments);
						var topic = args.shift();
						Object.keys(modules).forEach(function (namespace) {
							Object.keys(modules[namespace]).forEach(function (moduleName) {
								var eventName = "on" + changeCase.pascalCase(topic);
								if (typeof (modules[namespace][moduleName][eventName]) == "function") {
									modules[namespace][moduleName][eventName].apply(modules[namespace][moduleName][eventName], args);
								}
							});
						});
					}
				}
			}
			cb(null, new bus)
		},

		sequence: function (cb) {
			var Sequence = require("./helpers/sequence.js");
			var sequence = new Sequence({
				name: 'Main',
				onWarning: function (current, limit) {
					scope.logger.warn("Main queue", current)
				}
			});
			cb(null, sequence);
		},

		// protobuf: function (cb) {
		// 	var protocolBuffers = require("protocol-buffers");
		// 	var schema = `
		// 		message Block {
		// 			required string id = 1;
		// 			required int32 timestamp = 2;
		// 			required int64 height = 3;
		// 			required int32 payloadLength = 4;
		// 			required bytes payloadHash = 5;
		// 			optional string prevBlockId = 6;
		// 			optional string pointId = 7;
		// 			optional int64 pointHeight = 8;
		// 			required bytes delegate = 9;
		// 			optional bytes signature = 10;
		// 			required int32 count = 11;
		// 			repeated Transaction transactions = 12;
		// 		}

		// 		message Transaction {
		// 			required string id = 1;
		// 			required int32 timestamp = 2;
		// 			required bytes senderPublicKey = 3;
		// 			required bytes signature = 4;
		// 			optional string fee = 5;
		// 			required string func = 6;
		// 			repeated string args = 7;
		// 		}
		// 	`
		// 	cb(null, protocolBuffers(schema));
		// },

		modules: ["sandbox", "logger", "bus", "sequence", "validator", function (cb, scope) {
			var lib = require("./modules.full.json");
			var tasks = [];
			Object.keys(lib).forEach(function (path) {
				var raw = path.split("/");
				var namespace = raw[0];
				var moduleName = raw[1];
				tasks.push(function (cb) {
					var library = require(lib[path]);
					var obj = new library(cb, scope);
					modules[namespace] = modules[namespace] || {};
					modules[namespace][moduleName] = obj;
				});
			})

			async.series(tasks, function (err) {
				cb(err, modules);
			});
		}],

		ready: ["modules", "bus", "logger", function (cb, scope) {
			ready = true;

			(async function () {
				var initFile = path.join(app.rootDir, 'init.js')
				var init = require(initFile)
				try {
					await init()
				} catch (e) {
					console.log('Failed to initialize app: ' + e)
					process.exit(3)
				}
			})()

			scope.bus.message("bind", scope.modules);
			cb();
		}]
	}, cb);
}
