var dapp = require('./framework/index.js')

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

dapp.run(process.argv.slice(2));
process.send('__sandbox_inner_ready__');