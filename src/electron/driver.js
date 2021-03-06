import * as actions from './actions';
import proc     from 'child_process';
import path     from 'path';
import defaults from 'deep-defaults';
import child    from './ipc';
import default_electron_path from 'electron';


const DEFAULT_OPTIONS = {
  //Timing
  gotoTimeout:  30 * 1000,
  waitTimeout:  30 * 1000,
  typeInterval: 100,
  pollInterval: 250,
  //Electron
  electronPath: default_electron_path,
  electronArgs: {
    dock: false
  }
};


/**
 * Initialize `Driver`
 *
 * @param {Object} options
 */

function Driver(options = {}) {
  options = defaults(options, DEFAULT_OPTIONS);

  this.ended   = false;
  this._queue  = [];
  this.options = options;

  attachToProcess(this);

  this.queue(() => {
    let spawnArgs = [ path.join(__dirname, 'runner.js'), JSON.stringify(options.electronArgs) ];
    this.proc = proc.spawn(options.electronPath, spawnArgs, {
      stdio: [null, null, null, 'ipc'],
      env: defaults(options.env || {}, process.env)
    });

    this.child = child(this.proc);

    // propagate console.log(...) through
    this.child.on('log', (...args) => {
      console.log(...args);
    });

    this.child.on('uncaughtException', (stack) => {
      console.error('Driver runner error:\n\n%s\n', '\t' + stack.replace(/\n/g, '\n\t'));
      endInstance(this);
      process.exit(1);
    });

    this.proc.on('close', (code) => {
      if(!this.ended){
        handleExit(code, this);
      }
    });

    return new Promise((resolve) => {
      this.child.once('ready', () => {
        this.child.call('browser-initialize', options)
          .then(resolve);
      });
    });

  });
}

function handleExit(code, instance){
  let help = {
    127: 'command not found - you may not have electron installed correctly',
    126: 'permission problem or command is not an executable - you may not have all the necessary dependencies for electron',
    1:   'general error - you may need xvfb',
    0:   'success!'
  };
  console.log(help[code]);
  instance.proc.removeAllListeners();
};

function endInstance(instance) {
  instance.ended = true;
  detachFromProcess(instance);

  return new Promise((resolve) => {
    if (instance.proc && instance.proc.connected) {
      instance.proc.on('close', (code) => {
        handleExit(code, instance);
        resolve();
      });
      instance.child.call('quit', () => {
        instance.child.removeAllListeners();
      });
    } else {
      resolve();
    }
  });
}

/**
 * Attach any instance-specific process-level events.
 */
function attachToProcess(instance) {
  instance._endNow = () => endInstance(instance);
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
 * run
 */

Driver.prototype.run = function() {
  let steps = this._queue;
  this._queue = [];

  let cont = () => this.child ? this.child.call('continue') : Promise.resolve();
  let step = ([method, args]) => method.apply(this, args);

  return steps.reduce(
      (last, next) => last
        .then(cont)
        .then(() => step(next)),
      Promise.resolve()
    )
    .catch((err) => {
      console.error(err);
      endInstance(this);
    });
};

/**
 * run the code now (do not queue it)
 *
 * you should not use this, unless you know what you're doing
 * it should be used for plugins and custom actions, not for
 * normal API usage
 */

Driver.prototype.evaluate_now = function(js_fn, ...args) {
  let fn       = String(js_fn);
  let argsList = JSON.stringify(args).slice(1,-1);

  return this.child.call('javascript', `(${fn})(${argsList})`);
};

/**
 * end
 */

Driver.prototype.end = function() {
  this.queue(() => endInstance(this));
  return this;
};

/**
 * Queue
 */

Driver.prototype.queue = function(fn, ...args) {
  this._queue.push([fn, args]);
};


/**
 * then
 */

Driver.prototype.then = function(fulfill, reject) {
  return this.run()
    .then(fulfill, reject);
};

/**
 * Attach all the actions.
 */

Object.keys(actions).forEach((name) => {
  let fn = actions[name];
  Driver.prototype[name] = function(...args){
    this.queue(fn, ...args);
    return this;
  };
});

/**
 * Export `Driver`
 */

export default function(options){
  return new Driver(options);
}
