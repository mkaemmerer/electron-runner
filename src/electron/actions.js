import fs from 'fs';


/**
 * Helper functions for type() and insert() to focus/blur
 * so that we trigger DOM events.
 */

let focusSelector = function(done, selector) {
  return this.evaluate_now(done.bind(this), function(selector) {
    document.querySelector(selector).focus();
  }, selector);
};

let blurSelector = function(done, selector) {
  return this.evaluate_now(done.bind(this), function(selector) {
    document.querySelector(selector).blur();
  }, selector);
};

/**
 * Type into an element.
 *
 * @param {Function} done
 * @param {String} selector
 * @param {String} text
 */

export function type(done, selector, text) {
  let self = this;

  focusSelector.bind(this)(function() {
    let blurDone = blurSelector.bind(this, done, selector);
    if ((text || '') == '') {
      this.evaluate_now(blurDone, function(selector) {
        document.querySelector(selector).value = '';
      }, selector);
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

export function wait(done, ...args){
  if (args.length === 0) {
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
    let element = document.querySelector('${JSON.stringify(selector).slice(1,-1)}');
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

function waitfn(...args) { 
  let timeout = this.timeout || null;
  let waitMsPassed = 0;
  return tick(...args);

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
    let newArgs = [waitDone, fn].concat(args.slice(2,-1));
    self.evaluate_now.apply(self, newArgs);
  }
}

/**
 * Execute a function on the page.
 *
 * @param {Function} done
 * @param {Function} fn
 * @param {...} args
 */

export function evaluate(done, fn, ...args){
  if (typeof fn !== 'function') {
    return done(new Error('.evaluate() fn should be a function'));
  }
  this.evaluate_now(done, fn, ...args);
};

/**
 * Set the viewport.
 *
 * @param {Number} width
 * @param {Number} height
 * @param {Function} done
 */

export function viewport(done, width, height){
  this.child.call('size', width, height, done);
};

/**
 * Take a screenshot.
 *
 * @param {Function} done
 * @param {String} path
 */

export function screenshot(done, path){
  this.child.call('screenshot', path, undefined, (error, img) => {
    let buf = new Buffer(img.data);
    fs.writeFile(path, buf, done);
  });
};

/**
 * Authentication
 */

 export function authentication(done, login, password){
   this.child.call('authentication', login, password, done);
 };
