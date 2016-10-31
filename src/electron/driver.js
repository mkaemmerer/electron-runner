import * as actions from './actions';
import proc     from 'child_process';
import path     from 'path';
import defaults from 'deep-defaults';
import child    from './ipc';
import default_electron_path from 'electron-prebuilt';


const DEFAULT_OPTIONS = {
  //Timing
  gotoTimeout:  30 * 1000,
  waitTimeout:  30 * 1000,
  typeInterval: 100,
  pollInterval: 250,
  //Retries
  maxAuthRetries: 3,
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

  // initial state
  this.state   = 'initial';
  this.running = false;
  this.ending  = false;
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

    this.child.once('die', (err) => {
      this.die = err;
    });

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
          .then(() => {
            this.state = 'ready';
            resolve();
          });
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
 * Go to a `url`
 */

Driver.prototype.goto = function(url, headers = {}) {
  this.queue(() => {
    return this.child.call('goto', url, headers, this.options.gotoTimeout);
  });
  return this;
};

/**
 * run
 */

Driver.prototype.run = function() {
  let steps = this._queue;
  this.running = true;
  this._queue = [];

  let cont = () => this.child ? this.child.call('continue') : Promise.resolve();

  let step = (item) => {
    let [method, args] = item;
    return method.apply(this, args)
      .then((res) =>
        cont().then(() => Promise.resolve(res))
      );
  };

  let cleanup = () => {
    this.running = false;
    return this.ending ? endInstance(this) : Promise.resolve();
  };

  let next = (res) => {
    let item = steps.shift();

    // Immediately halt execution if an error has been thrown, or we have no more queued up steps.
    if(this.die){
      return Promise.reject(this.die);
    }
    if (!item) {
      return Promise.resolve(res);
    }

    return step(item).then(next);
  };

  return next()
    .then((res) => {
      return cleanup()
        .then(() => Promise.resolve(res));
    })
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
  this.ending = true;

  if (!this.running && !this.ended) {
    this.run();
  }

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
 * Static: Support attaching custom actions
 *
 * @param {String} name - method name
 * @param {Function|Object} parentfn - Driver implementation
 * @return {Driver}
 */

Driver.action = function(name, parentfn) {
  Driver.prototype[name] = function(...args){
    this._queue.push([parentfn, args]);
    return this;
  };
  return Driver;
}

/**
 * Attach all the actions.
 */

Object.keys(actions).forEach((name) => {
  let fn = actions[name];
  Driver.action(name, fn);
});

/**
 * Export `Driver`
 */

export default function(options){
  return new Driver(options);
}
