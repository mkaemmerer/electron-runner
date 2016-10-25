import * as actions from './actions';
let default_electron_path = require('electron-prebuilt');
import proc     from 'child_process';
import path     from 'path';
import once     from 'once';
import split2   from 'split2';
import defaults from 'defaults';
import child    from './ipc';

let noop = function() {};

// Standard timeout for loading URLs
const DEFAULT_GOTO_TIMEOUT = 30 * 1000;
// Standard timeout for wait(ms)
const DEFAULT_WAIT_TIMEOUT = 30 * 1000;
// Timeout between keystrokes for `.type()`
const DEFAULT_TYPE_INTERVAL = 100;
// timeout between `wait` polls
const DEFAULT_POLL_INTERVAL = 250;
// max retry for authentication
const MAX_AUTH_RETRIES = 3;


/**
 * runner script
 */

let runner = path.join(__dirname, 'runner.js');


/**
 * Initialize `Driver`
 *
 * @param {Object} options
 */

function Driver(options = {}) {
  let electronArgs = {};

  options.waitTimeout  = options.waitTimeout  || DEFAULT_WAIT_TIMEOUT;
  options.gotoTimeout  = options.gotoTimeout  || DEFAULT_GOTO_TIMEOUT;
  options.pollInterval = options.pollInterval || DEFAULT_POLL_INTERVAL;
  options.typeInterval = options.typeInterval || DEFAULT_TYPE_INTERVAL;

  let electron_path = options.electronPath || default_electron_path;

  options.maxAuthRetries = options.maxAuthRetries || MAX_AUTH_RETRIES;

  electronArgs.loadTimeout = options.loadTimeout;

  electronArgs.dock = options.dock || false;

  attachToProcess(this);

  // initial state
  this.state   = 'initial';
  this.running = false;
  this.ending  = false;
  this.ended   = false;
  this._queue  = [];
  this.options = options;

  this.queue((done) => {
    this.proc = proc.spawn(electron_path, [runner, JSON.stringify(electronArgs)], {
      stdio: [null, null, null, 'ipc'],
      env: defaults(options.env || {}, process.env)
    });

    this.proc.stdout.pipe(split2()).on('data', (data) => {
      console.log(data);
    });

    this.proc.stderr.pipe(split2()).on('data', (data) => {
      console.error(data);
    });

    this.proc.on('close', (code) => {
      if(!this.ended){
        handleExit(code, this, noop);
      }
    });

    this.child = child(this.proc);

    this.child.once('die', (err) => {
      this.die = err;
    });

    // propagate console.log(...) through
    this.child.on('log', (...args) => {
      console.log(...args);
    });

    this.child.on('uncaughtException', (stack) => {
      console.error('Driver runner error:\n\n%s\n', '\t' + stack.replace(/\n/g, '\n\t'));
      endInstance(this, noop);
      process.exit(1);
    });

    this.child.once('ready', () => {
      this.child.call('browser-initialize', options, () => {
        this.state = 'ready';
        done();
      });
    });
  });

  //prepend adding child actions to the queue
  Object.keys(Driver.childActions).forEach(function(key){
    this.queue(function(done){
      this.child.call('action', key, String(Driver.childActions[key]), done);
    });
  }, this);
}

function handleExit(code, instance, cb){
  let help = {
    127: 'command not found - you may not have electron installed correctly',
    126: 'permission problem or command is not an executable - you may not have all the necessary dependencies for electron',
    1:   'general error - you may need xvfb',
    0:   'success!'
  };

  instance.proc.removeAllListeners();
  cb();
};

function endInstance(instance, cb) {
  instance.ended = true;
  detachFromProcess(instance);
  if (instance.proc && instance.proc.connected) {
    instance.proc.on('close', (code) => {
      handleExit(code, instance, cb);
    });
    instance.child.call('quit', () => {
      instance.child.removeAllListeners();
    });
  } else {
    cb();
  }
}

/**
 * Attach any instance-specific process-level events.
 */
function attachToProcess(instance) {
  instance._endNow = () => endInstance(instance, noop);
  process.setMaxListeners(Infinity);
  process.on('exit',     instance._endNow);
  process.on('SIGINT',   instance._endNow);
  process.on('SIGTERM',  instance._endNow);
  process.on('SIGQUIT',  instance._endNow);
  process.on('SIGHUP',   instance._endNow);
  process.on('SIGBREAK', instance._endNow);
}

function detachFromProcess(instance) {
  process.removeListener('exit',     instance._endNow);
  process.removeListener('SIGINT',   instance._endNow);
  process.removeListener('SIGTERM',  instance._endNow);
  process.removeListener('SIGQUIT',  instance._endNow);
  process.removeListener('SIGHUP',   instance._endNow);
  process.removeListener('SIGBREAK', instance._endNow);
}

/**
 * Child actions to create
 */

Driver.childActions = {};

/**
 * Go to a `url`
 */

Driver.prototype.goto = function(url, headers = {}) {
  this.queue((fn) => {
    this.child.call('goto', url, headers, this.options.gotoTimeout, fn);
  });
  return this;
};

/**
 * run
 */

Driver.prototype.run = function(fn) {
  let steps = this._queue;
  this.running = true;
  this._queue = [];
  let self = this;

  // kick us off
  next();

  // next function
  function next (err, res) {
    let item = steps.shift();
    // Immediately halt execution if an error has been thrown, or we have no more queued up steps.
    if (err || !item) return done.apply(self, arguments);
    let args = item[1] || [];
    let method = item[0];
    args.push(once(after));
    method.apply(self, args);
  }

  function after (err, res) {
    err = err || self.die;
    let args = Array.prototype.slice.apply(arguments);

    if(self.child){
      self.child.call('continue', () => next.apply(self, args));
    } else {
      next.apply(self, args);
    }
  }

  function done () {
    let doneargs = arguments;
    self.running = false;
    if (self.ending) {
      return endInstance(self, () => fn.apply(self, doneargs));
    }
    return fn.apply(self, doneargs);
  }

  return this;
};

/**
 * run the code now (do not queue it)
 *
 * you should not use this, unless you know what you're doing
 * it should be used for plugins and custom actions, not for
 * normal API usage
 */

Driver.prototype.evaluate_now = function(js_fn, done, ...args) {
  let fn       = String(js_fn);
  let argsList = JSON.stringify(args).slice(1,-1);

  let source = `
  (function javascript () {
    var ipc = __electron_runner.ipc;
    try {
      var response = (${fn})(${argsList});
      ipc.send('response', response);
    } catch (e) {
      ipc.send('error', e.message);
    }
  })()
  `;

  this.child.call('javascript', source, done);
  return this;
};

/**
 * end
 */

Driver.prototype.end = function(done) {
  this.ending = true;

  if (done && !this.running && !this.ended) {
    this.run(done);
  }

  return this;
};

/**
 * Queue
 */

Driver.prototype.queue = function(...args) {
  let fn = args.pop();
  this._queue.push([fn, args]);
};


/**
 * then
 */

Driver.prototype.then = function(fulfill, reject) {
  return new Promise((success, failure) => {
    this.run(function(err, result) {
      if (err) failure(err);
      else success(result);
    })
  })
  .then(fulfill, reject);
};


/**
 * Static: Support attaching custom actions
 *
 * @param {String} name - method name
 * @param {Function|Object} [childfn] - Electron implementation
 * @param {Function|Object} parentfn - Driver implementation
 * @return {Driver}
 */

Driver.action = function() {
  let name = arguments[0], childfn, parentfn;
  if(arguments.length === 2) {
    parentfn = arguments[1];
  } else {
    parentfn = arguments[2];
    childfn = arguments[1];
  }

  if(parentfn) {
    Driver.prototype[name] = function(...args){
      this._queue.push([parentfn, args]);
      return this;
    };
  }

  if(childfn) {
    Driver.childActions[name] = childfn;
  }
}

/**
 * Attach all the actions.
 */

Object.keys(actions).forEach(function (name) {
  let fn = actions[name];
  Driver.action(name, fn);
});

/**
 * Export `Driver`
 */

export default function(options){
  return new Driver(options);
}