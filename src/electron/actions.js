import jsesc from 'jsesc';
import fs from 'fs';


/**
 * Helper functions for type() and insert() to focus/blur
 * so that we trigger DOM events.
 */

let focusSelector = function(done, selector) {
  return this.evaluate_now(function(selector) {
    document.querySelector(selector).focus();
  }, done.bind(this), selector);
};

let blurSelector = function(done, selector) {
  return this.evaluate_now(function(selector) {
    document.querySelector(selector).blur();
  }, done.bind(this), selector);
};

/**
 * Type into an element.
 *
 * @param {String} selector
 * @param {String} text
 * @param {Function} done
 */

export function type() {
  let selector = arguments[0], text, done;
  if(arguments.length == 2) {
    done = arguments[1];
  } else {
    text = arguments[1];
    done = arguments[2];
  }

  let self = this;

  focusSelector.bind(this)(function() {
    let blurDone = blurSelector.bind(this, done, selector);
    if ((text || '') == '') {
      this.evaluate_now(function(selector) {
        document.querySelector(selector).value = '';
      }, blurDone, selector);
    } else {
      self.child.call('type', text, blurDone);
    }
  }, selector);
};

/**
 * Wait
 *
 * @param {...} args
 */

export function wait(...args){
  let done = args[args.length-1];
  if (args.length < 2) {
    return done();
  }

  let arg = args[0];
  if (typeof arg === 'number') {
    if(arg < this.options.waitTimeout){
      waitms(arg, done);
    } else {
      waitms(this.options.waitTimeout, () => {
        done(new Error('.wait() timed out after '+this.options.waitTimeout+'msec'));
      });
    }
  }
  else if (typeof arg === 'string') {
    let timeout = null; 
    if (typeof args[1] === 'number') { 
      timeout = args[1];
    } 
    waitelem.apply({ timeout: timeout }, [this, arg, done]);
  }
  else if (typeof arg === 'function') {
    args.unshift(this);
    waitfn.apply(this, args);
  }
  else {
    done();
  }
};

/**
 * Wait for a specififed amount of time.
 *
 * @param {Number} ms
 * @param {Function} done
 */

function waitms (ms, done) {
  setTimeout(done, ms);
}

/**
 * Wait for a specified selector to exist.
 *
 * @param {Driver} self
 * @param {String} selector
 * @param {Function} done
 */

function waitelem (self, selector, done) {
  let elementPresent = new Function(`
    'use strict';
    let element = document.querySelector('${jsesc(selector)}');
    return (element ? true : false);
  `);
  waitfn.apply(this, [self, elementPresent, done]);
}

/**
 * Wait until evaluated function returns true.
 *
 * @param {Driver} self
 * @param {Function} fn
 * @param {...} args
 * @param {Function} done
 */

function waitfn() { 
  let timeout = this.timeout || null;
  let waitMsPassed = 0;
  return tick.apply(this, arguments)

  function tick (...args /** self, fn, arg1, arg2..., done**/) {
    let [self, fn] = args;
    let done = args[args.length-1];
    let waitDone = function (err, result) {
      if (result) {
        return done();
      }
      else if (timeout && waitMsPassed > timeout) {
        return done();
      }
      else if (self.options.waitTimeout && waitMsPassed > self.options.waitTimeout) {
        return done(new Error('.wait() timed out after '+self.options.waitTimeout+'msec'));
      }
      else {
        waitMsPassed += self.options.pollInterval;
        setTimeout(function () {
          tick.apply(self, args);
        }, self.options.pollInterval);
      }
    };
    let newArgs = [fn, waitDone].concat(args.slice(2,-1));
    self.evaluate_now.apply(self, newArgs);
  }
}

/**
 * Execute a function on the page.
 *
 * @param {Function} fn
 * @param {...} args
 * @param {Function} done
 */

export function evaluate(...args /** fn, arg1, arg2..., done**/){
  let [fn] = args;
  let done = args[args.length-1];
  let newArgs = [fn, done].concat(args.slice(1,-1));
  if (typeof fn !== 'function') {
    return done(new Error('.evaluate() fn should be a function'));
  }
  this.evaluate_now.apply(this, newArgs);
};

/**
 * Set the viewport.
 *
 * @param {Number} width
 * @param {Number} height
 * @param {Function} done
 */

export function viewport(width, height, done){
  this.child.call('size', width, height, done);
};

/**
 * Take a screenshot.
 *
 * @param {String} path
 * @param {Function} done
 */

export function screenshot(path, done){
  this.child.call('screenshot', path, undefined, (error, img) => {
    let buf = new Buffer(img.data);
    fs.writeFile(path, buf, done);
  });
};

/**
 * Authentication
 */

 export function authentication(login, password, done){
   this.child.call('authentication', login, password, done);
 };
