//-----------------------------------------------------------------------------
// Init
//-----------------------------------------------------------------------------

var fs           = require('fs');
var path         = require('path');
var spawn        = require('child_process').spawn;
var util         = require('util');
var EventEmitter = require('events').EventEmitter;

//-----------------------------------------------------------------------------
// Constructor
//-----------------------------------------------------------------------------

function Sandbox(options) {
  var self = this;

  // message_queue is used to store messages that are meant to be sent
  // to the sandbox before the sandbox is ready to process them
  self._ready = false;
  self._exited = false;
  self._message_queue = [];

  self.options = {
    timeout: 0,
    node:    'node',
    shovel:  path.join(__dirname, 'shovel2.js'),
    file: options.file,
    args: options.args
  };

  // self.info = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json')));
}

// Make the Sandbox class an event emitter to handle messages
util.inherits(Sandbox, EventEmitter);


//-----------------------------------------------------------------------------
// Instance Methods
//-----------------------------------------------------------------------------

Sandbox.prototype.run = function() {
  var self = this;
  var timer;
  var stdout = '';
  var childArgs = [this.options.shovel, this.options.file].concat(this.options.args);
  self.child = spawn(
    this.options.node,
    childArgs,
    {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    }
  );

  // Listen
  self.child.stdout.on('data', function(data) {
    self.emit('stdout', data.toString('utf8').replace(/\n$/, ''));
  });

  self.child.stderr.on('data', function(data) {
    self.emit('stderr', data.toString('utf8').replace(/\n$/, ''));
  });

  // Pass messages out from child process
  // These messages can be handled by Sandbox.on('message', function(message){...});
  self.child.on('message', function(message) {
    if (message === '__sandbox_inner_ready__') {

      self.emit('ready');
      self._ready = true;

      // Process the _message_queue
      while(self._message_queue.length > 0) {
        self.postMessage(self._message_queue.shift());
      }

    } else {
      self.emit('message', message);
    }
  });

  self.child.on('exit', function(code) {
    if (self.options.timeout > 0 && timer) {
      clearTimeout(timer);
    }
    self.exited = true;
    self.emit('exit', code);
  });

  if (self.options.timeout > 0) {
    self.child.timer = setTimeout(function () {
      this.parent.stdout.removeListener('output', output);
      stdout = JSON.stringify({ result: 'TimeoutError', console: [] });
      this.parent.kill('SIGKILL');
    }, self.options.timeout);
    self.child.timer.parent = self.child; 
  }

};

Sandbox.prototype.kill = function () {
  var self = this;
  if (self._ready && !self.exited &&　self.child) {
    self.child.kill('SIGKILL');
  }
}

// Send a message to the code running inside the sandbox
// This message will be passed to the sandboxed
// code's `onmessage` function, if defined.
// Messages posted before the sandbox is ready will be queued
Sandbox.prototype.postMessage = function(message) {
  var self = this;

  if (self._ready) {
    self.child.send(message);
  } else {
    self._message_queue.push(message);
  }
};

//-----------------------------------------------------------------------------
// Export
//-----------------------------------------------------------------------------

module.exports = Sandbox;
