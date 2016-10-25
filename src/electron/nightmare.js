import * as actions from './actions';
let default_electron_path = require('electron-prebuilt');
let proc = require('child_process');
let path = require('path');
let child = require('./ipc');
let once = require('once');
let split2 = require('split2');
let defaults = require('defaults');
let noop = function() {};
let keys = Object.keys;

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
 * Template
 */

let template = require('./javascript');

/**
 * Initialize `Nightmare`
 *
 * @param {Object} options
 */

function Nightmare(options = {}) {
  if (!(this instanceof Nightmare)) return new Nightmare(options);
  let electronArgs = {};

  options.waitTimeout = options.waitTimeout || DEFAULT_WAIT_TIMEOUT;
  options.gotoTimeout = options.gotoTimeout || DEFAULT_GOTO_TIMEOUT;
  options.pollInterval = options.pollInterval || DEFAULT_POLL_INTERVAL;

  options.typeInterval = options.typeInterval || DEFAULT_TYPE_INTERVAL;

  let electron_path = options.electronPath || default_electron_path

  if (options.paths) {
    electronArgs.paths = options.paths;
  }

  if (options.switches) {
    electronArgs.switches = options.switches;
  }
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
      console.error('Nightmare runner error:\n\n%s\n', '\t' + stack.replace(/\n/g, '\n\t'));
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
  Object.keys(Nightmare.childActions).forEach(function(key){
    this.queue(function(done){
      this.child.call('action', key, String(Nightmare.childActions[key]), done);
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

Nightmare.childActions = {};

/**
 * Go to a `url`
 */

Nightmare.prototype.goto = function(url, headers = {}) {
  this.queue((fn) => {
    this.child.call('goto', url, headers, this.options.gotoTimeout, fn);
  });
  return this;
};

/**
 * run
 */

Nightmare.prototype.run = function(fn) {
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

Nightmare.prototype.evaluate_now = function(js_fn, done, ...args) {
  let argsList = JSON.stringify(args).slice(1,-1);
  let source = template.execute({ src: String(js_fn), args: argsList });

  this.child.call('javascript', source, done);
  return this;
};

/**
 * end
 */

Nightmare.prototype.end = function(done) {
  this.ending = true;

  if (done && !this.running && !this.ended) {
    this.run(done);
  }

  return this;
};

/**
 * Queue
 */

Nightmare.prototype.queue = function(...args) {
  let fn = args.pop();
  this._queue.push([fn, args]);
};


/**
 * then
 */

Nightmare.prototype.then = function(fulfill, reject) {
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
 * @param {Function|Object} parentfn - Nightmare implementation
 * @return {Nightmare}
 */

Nightmare.action = function() {
  let name = arguments[0], childfn, parentfn;
  if(arguments.length === 2) {
    parentfn = arguments[1];
  } else {
    parentfn = arguments[2];
    childfn = arguments[1];
  }

  if(parentfn) {
    Nightmare.prototype[name] = function(...args){
      this._queue.push([parentfn, args]);
      return this;
    };
  }

  if(childfn) {
    Nightmare.childActions[name] = childfn;
  }
}

/**
 * Attach all the actions.
 */

Object.keys(actions).forEach(function (name) {
  let fn = actions[name];
  Nightmare.action(name, fn);
});

/**
 * Export `Nightmare`
 */

export default Nightmare;
