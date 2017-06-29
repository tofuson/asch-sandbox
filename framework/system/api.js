var private = {}
var self = null
var library = null
var modules = null

private.apies = {}
private.appApiHandlers = {}
private.loaded = false

function Api(cb, _library) {
	self = this;
	library = _library;

	cb(null, self);
}

private.ns = function (src, path) {
	var o, d;
	d = path.split(".");
	o = src[d[0]];
	for (var i = 0; i < d.length; i++) {
		d = d.slice(1);
		o = o[d[0]];
		if (!o) break;
	}
	return o;
};

private.applyApiHandler = function (handler, req, cb) {
	(async () => {
		try {
			let response = await handler(req)
			cb(null, { response: response })
		} catch (e) {
			cb(e.toString())
		}
	})()
}

Api.prototype.onBind = function (_modules) {
	modules = _modules;
}

Api.prototype.onBlockchainLoaded = function () {
	private.loaded = true;

	try {
		var router = require("../routes.json");
	} catch (e) {
		library.logger("Failed to load routes.json");
		process.exit(4)
	}

	router.forEach(function (route) {
		private.apies[route.method + " " + route.path] = private.ns(modules, route.handler);
	});

	var appRoutes = app.route.getRoutes()
	for (let r of appRoutes) {
		private.appApiHandlers[r.method + ' ' + r.path] = r.handler
	}

	(async function () {
		try {
			for (let r of appRoutes) {
				console.log('register app interface', r.method, r.path)
				await PIFY(modules.api.dapps.registerInterface)(r)
			}
		} catch (e) {
			console.log('Failed to register dapp interface', e)
			process.exit(5)
			return
		}
	})()

	library.sandbox.onMessage(function (message, callback_id, cb) {
		var handler = private.apies[message.method + " " + message.path];
		if (handler) {
			handler(message.query, function (err, response) {
				if (err) {
					err = err.toString();
				}

				cb(err, {response: response});
			});
		} else {
			handler = private.appApiHandlers[message.method + " " + message.path]
			if (!handler) return cb("API call not found")
			private.applyApiHandler(handler, message.query, cb)
		}
	});

	modules.api.dapps.setReady(function (err) {
		if (err) {
			console.log('app set ready failed: ' + err)
		} else {
			console.log('app set ready success')
		}
	});
}

Api.prototype.message = function (req, cb) {
	library.bus.message("message", req.query);
	cb(null, {});
}

module.exports = Api;
