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
      self.child.call('type', blurDone, text);
    }
  }, selector);
};

/**
 * Wait
 *
 * @param {...} args
 */

export function wait(done, condition, ...args){
  if (condition === undefined) {
    return done();
  }

  if (typeof condition === 'number') {
    if(condition < this.options.waitTimeout){
      waitms(this, done, condition);
    } else {
      waitms(this, () => {
        done(new Error('.wait() timed out after '+this.options.waitTimeout+'msec'));
      }, this.options.waitTimeout);
    }
  }
  else if (typeof condition === 'string') {
    waitelem(this, done, condition);
  }
  else if (typeof condition === 'function') {
    waitfn(this, done, condition, ...args);
  }
  else {
    done();
  }
};

/**
 * Wait for a specififed amount of time.
 *
 * @param {Driver} self
 * @param {Function} done
 * @param {Number} ms
 */

function waitms (self, done, ms) {
  setTimeout(done, ms);
}

/**
 * Wait for a specified selector to exist.
 *
 * @param {Driver} self
 * @param {Function} done
 * @param {String} selector
 */

function waitelem (self, done, selector) {
  let elementPresent = function(selector){
    return (document.querySelector(selector) ? true : false);
  };
  waitfn(self, done, elementPresent, selector);
}

/**
 * Wait until evaluated function returns true.
 *
 * @param {Driver} self
 * @param {Function} done
 * @param {Function} fn
 * @param {...} args
 */

function waitfn(self, done, fn, ...args) { 
  let waitMsPassed = 0;
  return tick(self, done, fn, ...args);

  function tick (self, done, fn, ...args) {
    let waitDone = function (err, result) {
      if (result) {
        done();
      }
      else if (self.options.waitTimeout && waitMsPassed > self.options.waitTimeout) {
        done(new Error('.wait() timed out after '+self.options.waitTimeout+'msec'));
      }
      else {
        waitMsPassed += self.options.pollInterval;
        setTimeout(function () {
          tick(self, done, fn, ...args);
        }, self.options.pollInterval);
      }
    };
    self.evaluate_now(waitDone, fn, ...args);
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
  this.child.call('size', done, width, height);
};

/**
 * Take a screenshot.
 *
 * @param {Function} done
 * @param {String} path
 */

export function screenshot(done, path){
  this.child.call('screenshot', (error, img) => {
    let buf = new Buffer(img.data);
    fs.writeFile(path, buf, done);
  });
};

/**
 * Authentication
 */

 export function authentication(done, login, password){
   this.child.call('authentication', done, login, password);
 };
