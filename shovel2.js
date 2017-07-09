var fs = require('fs')
var path = require('path')
var EventEmitter = require('events').EventEmitter
var NodeVM = require('./vm2').NodeVM
//var Sequelize = require('sequelize')
var changeCase = require('change-case')
var helpers = require('./framework/helpers')
var amountHelper = require('./framework/helpers/amount')
var ORM = require('./framework/helpers/orm')
var SmartDB = require('./framework/helpers/smartdb')
var BalanceManager = require('./framework/helpers/balance-manager')
var AutoIncrement = require('./framework/helpers/auto-increment')
var FeePool = require('./framework/helpers/fee-pool')

var rootDir = path.join(__dirname, 'framework')
var entryFile = path.join(rootDir, 'index.js')
var dappRootDir = process.argv[2]
var secrets = process.argv.slice(3)

if (dappRootDir[0] !== '/') {
    dappRootDir = path.join(process.cwd(), dappRootDir)
}
console.log('dappRootDir', dappRootDir)

function runDapp(app) {
    var vm = new NodeVM({
        console: 'inherit',
        sandbox: {
        },
        require: {
            external: true,
            context: 'sandbox',
            builtin: [
                'assert',
                'crypto',
                'events',
                'os',
                'path',
                'punycode',
                'querystring',
                'string_decoder',
                'url',
                'util',
                'zlib',

                // following are external builtin modules
                'async',
                'bignumber',
                'bytebuffer',
                'change-case',
                'sodium',
                'extend',
                'ip',
                'z-schema',
                'protocol-buffers',
                'asch-js'
            ],
            root: [
                rootDir,
                dappRootDir
            ]
        }
    })

    var dapp = vm.run(fs.readFileSync(entryFile), entryFile)

    process.on('SIGTERM', function () {
    })
    process.on('SIGINT', function () {
    })
    process.on('message', function (data) {
        dapp.processParentMessage(data);
    })

    dapp.on('message', function (data) {
        process.send(data);
    })

    dapp.on('exit', function (code) {
        (async () => {
          try {
            await app.db.close()
          } catch (e) {
            console.log('Failed to close db:', e)
          }
        })()
        process.exit(code);
    })

    dapp.run(app)
    process.send('__sandbox_inner_ready__')
}

function run2(app) {
    var dapp = require(entryFile)
    process.on('SIGTERM', function () {
    })
    process.on('SIGINT', function () {
    })
    process.on('message', function (data) {
        dapp.processParentMessage(data);
    })

    dapp.on('message', function (data) {
        process.send(data);
    })

    dapp.on('exit', function (code) {
        (async () => {
          try {
            await app.db.close()
          } catch (e) {
            console.log('Failed to close db:', e)
          }
        })()
        process.exit(code);
    })

    dapp.run(app)
    process.send('__sandbox_inner_ready__')
}

async function loadModels(dir) {
    let modelFiles = await helpers.PIFY(fs.readdir)(dir)
    for (let i in modelFiles) {
        var modelFile = modelFiles[i]
        console.log('loading model', modelFile)
        let basename = path.basename(modelFile, '.js')
        let modelName = changeCase.pascalCase(basename)
        let fullpath = path.join(dir, modelFile)
        let schema = require(fullpath)
        app.model[modelName] = app.db.define(changeCase.snakeCase(basename), schema, { timestamps: false })
        await app.model[modelName].sync()
    }
}

async function loadContracts(dir) {
    let contractFiles = await helpers.PIFY(fs.readdir)(dir)
    for (let i in contractFiles) {
        var contractFile = contractFiles[i]
        console.log('loading contract', contractFile)
        let basename = path.basename(contractFile, '.js')
        let contractName = changeCase.snakeCase(basename)
        let fullpath = path.join(dir, contractFile)
        let contract = require(fullpath)
        if (contractFile !== 'index.js') {
            app.contract[contractName] = contract
        }
    }
}

async function loadInterfaces(dir) {
    let interfaceFiles = await helpers.PIFY(fs.readdir)(dir)
    for (let f of interfaceFiles) {
        console.log('loading interface', f)
        require(path.join(dir, f))
    }
}

class Route {
    constructor() {
        this.routes = []
    }
    get(path, handler) {
        this.routes.push({ path: path, method: 'get', handler: handler })
    }

    put(path, handler) {
        this.routes.push({ path: path, method: 'put', handler: handler })
    }

    post(path, handler) {
        this.routes.push({ path: path, method: 'post', handler: handler })
    }
    getRoutes() {
        return this.routes
    }
}

async function main() {
    global.app = {
        db: null,
        sdb: null,
        balances: null,
        model: {},
        contract: {},
        rootDir: dappRootDir,
        config: require(path.join(dappRootDir, 'config.json')),
        contractTypeMapping: {},
        feeMapping: {},
        defaultFee: {
            currency: 'XAS',
            min: '10000000'
        },
        feePool: null
    }
    app.validators = {
        amount: function (value) {
            return amountHelper.validate(value)
        }
    }
    app.validate = function (type, value) {
        if (!app.validators[type]) throw new Error('Validator not found: ' + type)
        let error = app.validators[type](value)
        if (error) throw new Error(error)
    }
    app.registerContract = function (type, name) {
        if (type < 1000) throw new Error('Contract types that small than 1000 are reserved')
        app.contractTypeMapping[type] = name
    }
    app.getContractName = function (type) {
        return app.contractTypeMapping[type]
    }

    app.registerFee = function (type, min, currency) {
        app.feeMapping[type] = {
            currency: currency || app.defaultFee.currency,
            min: min
        }
    }
    app.getFee = function (type) {
        return app.feeMapping[type]
    }
    app.setDefaultFee = function (min, currency) {
        app.defaultFee.currency = currency
        app.defaultFee.min = min
    }

    app.db = new ORM('', '', '', {
        dialect: 'sqlite',
        storage: path.join(dappRootDir, 'blockchain.db'),
        logging: false
    })

    app.sdb = new SmartDB(app)
    app.balances = new BalanceManager(app.sdb)
    app.autoID = new AutoIncrement(app.sdb)
    app.feePool = new FeePool(app.sdb)
    app.route = new Route()
    app.events = new EventEmitter()

    await loadModels(path.join(rootDir, 'model'))
    await loadModels(path.join(dappRootDir, 'model'))
    await loadContracts(path.join(rootDir, 'contract'))
    await loadContracts(path.join(dappRootDir, 'contract'))
    await loadInterfaces(path.join(rootDir, 'interface'))
    await loadInterfaces(path.join(dappRootDir, 'interface'))

    await app.sdb.load('Balance', app.model.Balance.fields(), [['address', 'currency']])
    await app.sdb.load('Variable', ['key', 'value'], ['key'])
    await app.sdb.load('RoundFee', app.model.RoundFee.fields(), [['round', 'currency']])

    app.contractTypeMapping[1] = 'core.deposit'
    app.contractTypeMapping[2] = 'core.withdrawal'
    app.contractTypeMapping[3] = 'core.transfer'

    run2(global.app)
}

(async function () {
    try {
        main()
    } catch (e) {
        console.log('Failed to initialize app sandbox')
        process.exit(1)
    }
})()