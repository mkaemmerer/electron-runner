import fs from 'fs';


/**
 * Helper functions for type() to focus/blur
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
  if (typeof condition === 'number') {
    if(condition < this.options.waitTimeout){
      return waitms(this, condition);
    } else {
      return waitms(this, this.options.waitTimeout)
        .then(() => {
          let error = new Error('.wait() timed out after '+this.options.waitTimeout+'msec');
          return Promise.reject(error);
        });
    }
  }
  if (typeof condition === 'string') {
    return waitelem(this, condition);
  }
  if (typeof condition === 'function') {
    return waitfn(this, condition, ...args);
  }

  return Promise.resolve();
};

/**
 * Wait for a specififed amount of time.
 *
 * @param {Driver} self
 * @param {Number} ms
 */

function waitms (self, ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Wait for a specified selector to exist.
 *
 * @param {Driver} self
 * @param {String} selector
 */

function waitelem (self, selector) {
  let elementPresent = function(selector){
    return (document.querySelector(selector) ? true : false);
  };
  return waitfn(self, elementPresent, selector);
}

/**
 * Wait until evaluated function returns true.
 *
 * @param {Driver} self
 * @param {Function} fn
 * @param {...} args
 */

function waitfn(self, fn, ...args) { 
  let waitMsPassed = 0;

  let tick = () =>
    self.evaluate_now(fn, ...args)
      .then((res) => {
        if(res){ return Promise.resolve(); }

        if (self.options.waitTimeout && waitMsPassed > self.options.waitTimeout) {
          let error = new Error('.wait() timed out after '+self.options.waitTimeout+'msec');
          return Promise.reject(error);
        } else {
          waitMsPassed += self.options.pollInterval;
          return waitms(self, self.options.pollInterval)
            .then(tick);
        }
      });

  return tick();
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
