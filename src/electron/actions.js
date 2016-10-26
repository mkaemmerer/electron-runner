import fs from 'fs';


/**
 * Helper functions for type() and insert() to focus/blur
 * so that we trigger DOM events.
 */

let focusSelector = function(selector) {
  return this.evaluate_now(function(selector) {
    document.querySelector(selector).focus();
  }, selector);
};

let blurSelector = function(selector) {
  return this.evaluate_now(function(selector) {
    document.querySelector(selector).blur();
  }, selector);
};

/**
 * Type into an element.
 *
 * @param {String} selector
 * @param {String} text
 */

export function type(selector, text) {
  return focusSelector.call(this, selector)
    .then(() => {
      if(text === ''){
        return this.evaluate_now(function(selector){
          document.querySelector(selector).value = '';
        }, selector);
      } else {
        return this.child.call('type', text);
      }
    })
    .then(() => {
      return blurSelector.call(this, selector);
    });
};

/**
 * Wait
 *
 * @param {...} args
 */

export function wait(condition, ...args){
  return new Promise((resolve, reject) => {
    let done = (err, res) => {
      if(err){ reject(err); }
      resolve(res);
    };

    if (condition === undefined) {
      done();
      return;
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
  });
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
    self.evaluate_now(fn, ...args)
      .then((res) => {
        waitDone(null, res);
      }, (err) => {
        waitDone(err);
      });
  }
}

/**
 * Execute a function on the page.
 *
 * @param {Function} fn
 * @param {...} args
 */

export function evaluate(fn, ...args){
  if (typeof fn !== 'function') {
    return Promise.reject(new Error('.evaluate() fn should be a function'));
  }
  return this.evaluate_now(fn, ...args);
};

/**
 * Set the viewport.
 *
 * @param {Number} width
 * @param {Number} height
 */

export function viewport(width, height){
  return this.child.call('size', width, height);
};

/**
 * Take a screenshot.
 *
 * @param {String} path
 */

export function screenshot(path){
  return this.child.call('screenshot')
    .then((img) => {
      let buf = new Buffer(img.data);
      return new Promise((resolve) => {
        fs.writeFile(path, buf, resolve);
      });
    });
};

/**
 * Authentication
 *
 * @param {String} login
 * @param {String} password
 */

 export function authentication(login, password){
   return this.child.call('authentication', login, password);
 };
