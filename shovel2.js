var fs = require('fs');
var path = require('path');
var NodeVM = require('./vm2').NodeVM;

var entryFile = process.argv[2];
var rootDir = path.dirname(entryFile);

function getNodeModules() {
    var nodeModules = {};
    [
        'async',
        'bignumber',
        'bytebuffer',
        'change-case',
        'ed25519',
        'extend',
        'ip',
        'z-schema'
    ].forEach(function (name) {
        nodeModules[name] = require(name);
    });
}

var vm = new NodeVM({
    console: 'inherit',
    sandbox: {
        console: console,
        process: {
            exit: process.exit,
            argv: process.argv.slice(2),
        },
        node_modules: getNodeModules()
    },
    require: {
        external: true,
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
            'zlib'
        ],
        root: rootDir
    }
});

var dapp = vm.run(fs.readFileSync(entryFile), entryFile);

process.on('message', function (data) {
    dapp.processParentMessage(data);
});

dapp.on('message', function (data) {
    process.send(data);
});

dapp.run();
process.send('__sandbox_inner_ready__');