var fs = require('fs');
var path = require('path');
var NodeVM = require('./vm2').NodeVM;

var entryFile = process.argv[2];
var rootDir = path.dirname(entryFile);

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
            'ed25519',
            'extend',
            'ip',
            'z-schema'
        ],
        root: rootDir
    }
});

var dapp = vm.run(fs.readFileSync(entryFile), entryFile);

process.on('SIGTERM', function () {
});
process.on('SIGINT', function () {
});
process.on('message', function (data) {
    dapp.processParentMessage(data);
});

dapp.on('message', function (data) {
    process.send(data);
});

dapp.on('exit', function (code) {
    process.exit(code);
});

dapp.run(process.argv.slice(3));
process.send('__sandbox_inner_ready__');