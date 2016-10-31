let electron      = require('electron');
let renderer      = electron.ipcMain;
let urlFormat     = require('url');
let FrameManager  = require('./frame-manager');

// URL protocols that don't need to be checked for validity
const KNOWN_PROTOCOLS = ['http', 'https', 'file', 'about', 'javascript'];


function Window(win, options){
  this.initialize(win, options);
}

Window.prototype.initialize = function(win, options){
  this.win          = win;
  this.webContents  = win.webContents;
  this.frameManager = FrameManager(win);

  this._isReady = true;

  //Mute audio
  this.webContents.setAudioMuted(true);
  //Open dev tools
  if(options.show && options.openDevTools){
    if(typeof options.openDevTools === 'object') {
      this.win.openDevTools(options.openDevTools);
    } else {
      this.win.openDevTools();
    }
  }
  //Handle is ready
  this.webContents.on('did-start-loading', () => {
    if (this.webContents.isLoadingMainFrame()) {
      this.setIsReady(false);
    }
  });
  this.webContents.on('did-stop-loading', () => {
    this.setIsReady(true);
  });
};

Window.prototype.isReady = function() {
  return this._isReady;
};
Window.prototype.setIsReady = function(ready) {
  if (ready !== this._isReady) {
    this._isReady = ready;
    this.win.emit('did-change-is-ready', ready);
  }
};

/**
 * goto {url, headers, timeout}
 */
Window.prototype.goto = function(url, headers, timeout){
  if (!url || typeof url !== 'string') {
    let error = new Error('goto: `url` must be a non-empty string');
    return Promise.reject(error);
  }
  if (this.webContents.getURL() == url) {
    return Promise.resolve();
  }

  let loadUrlOptions = toLoadURLOptions(headers);
  let responseData = {};
  let domLoaded = false;

  let navigate = () => new Promise((resolve, reject) => {
    let handleFailure = (event, code, detail, failedUrl, isMainFrame) => {
      if (isMainFrame) {
        let error = {
          message: 'navigation error',
          code:    code,
          details: detail,
          url:     failedUrl || url
        };
        cleanup();
        // wait a tick before notifying to resolve race conditions for events
        setImmediate(() => reject(error));
      }
    };
    let handleDetails = (event, status, newUrl, oldUrl, statusCode, method, referrer, headers, resourceType) => {
      if (resourceType === 'mainFrame') {
        responseData = {
          url:      newUrl,
          code:     statusCode,
          method:   method,
          referrer: referrer,
          headers:  headers
        };
      }
    };
    let handleDomReady = () => {
      domLoaded = true;
    };
    let handleFinish = () => {
      // We will have already unsubscribed if load failed, so assume success.
      cleanup();
      // wait a tick before notifying to resolve race conditions for events
      setImmediate(() => resolve(responseData));
    };
    let setup = () => {
      this.webContents.on('did-fail-load',             handleFailure);
      this.webContents.on('did-fail-provisional-load', handleFailure);
      this.webContents.on('did-get-response-details',  handleDetails);
      this.webContents.on('dom-ready',                 handleDomReady);
      this.webContents.on('did-finish-load',           handleFinish);
    };
    let cleanup = () => {
      this.webContents.removeListener('did-fail-load',             handleFailure);
      this.webContents.removeListener('did-fail-provisional-load', handleFailure);
      this.webContents.removeListener('did-get-response-details',  handleDetails);
      this.webContents.removeListener('dom-ready',                 handleDomReady);
      this.webContents.removeListener('did-finish-load',           handleFinish);
      this.setIsReady(true);
    };

    setup();

    // javascript: URLs *may* trigger page loads; wait a bit to see
    let protocol = urlFormat.parse(url).protocol || '';
    if (protocol === 'javascript:') {
      setTimeout(() => {
        if (!this.webContents.isLoadingMainFrame()) {
          let res = {
            url:      url,
            code:     200,
            method:   'GET',
            referrer: this.webContents.getURL(),
            headers:  {}
          };

          cleanup();
          resolve(res);
        }
      }, 10);
    }

    this.webContents.loadURL(url, loadUrlOptions);
  });

  let timer = wait(timeout)
    .then(() => {
      // Even if "successful," note that some things didn't finish.
      responseData.details = `Not all resources loaded after ${timeout} ms`;
      //Navigation error
      let error = {
        message: 'navigation error',
        code: -7, // chromium's generic networking timeout code
        details: `Navigation timed out after ${timeout} ms`,
        url: url
      };
      this.setIsReady(true);
      // If the DOM loaded before timing out, consider the load successful.
      return domLoaded ? Promise.resolve(responseData) : Promise.reject(error);
    });

  let abortPending = () =>
    new Promise((resolve) => {
      // abort any pending loads first
      if (this.webContents.isLoading()) {
        this.webContents.once('did-stop-loading', () => {
          resolve();
        });
        this.webContents.stop();
      } else {
        resolve();
      }
    });

  let goto = canLoadProtocol(url)
    .then(abortPending)
    .then(navigate);

  return Promise.race([timer, goto]);
};

/**
 * javascript {src}
 */

Window.prototype.javascript = function(src){
  let ret = new Promise((resolve, reject) => {
    let cleanup = () => {
      renderer.removeListener('response', response);
      renderer.removeListener('error', error);
    };
    let response = (event, resp) => {
      cleanup();
      resolve(resp);
    };
    let error = (event, err) => {
      cleanup();
      reject(err);
    };

    renderer.on('response', response);
    renderer.on('error', error);
  });

  this.webContents.executeJavaScript(src);

  return ret;
};

/**
 * setSize {width, height}
 */

Window.prototype.setSize = function(width, height){
  this.win.setSize(width, height);
  return Promise.resolve();
};

/**
 * sendKey {char}
 */

Window.prototype.sendKey = function(ch){
  // keydown
  this.webContents.sendInputEvent({
    type: 'keyDown',
    keyCode: ch
  });
  // keypress
  this.webContents.sendInputEvent({
    type: 'char',
    keyCode: ch
  });
  // keyup
  this.webContents.sendInputEvent({
    type: 'keyUp',
    keyCode: ch
  });
  return Promise.resolve();
};

/**
 * type {string, timeout}
 */

Window.prototype.type = function(value, typeInterval){
  let chars = String(value).split('');

  let type = () => {
    let ch = chars.shift();
    if (ch === undefined) {
      return Promise.resolve();
    }

    this.sendKey(ch);

    return wait(typeInterval).then(type);
  }

  return type();
};

/**
 * screenshot
 */

Window.prototype.screenshot = function(){
  return new Promise((resolve) => {
    // https://gist.github.com/twolfson/0d374d9d7f26eefe7d38
    this.frameManager.requestFrame(() => {
      this.win.capturePage((img) => {
        resolve(img.toPng());
      });
    });
  });
}

/**
 * continue
 */

Window.prototype.continue = function(){
  let onChange = () =>
    new Promise((resolve) => this.win.once('did-change-is-ready', resolve));

  return this.isReady() ? Promise.resolve() : onChange();
};



/**
 * Utility Functions
 */

// In most environments, loadURL handles this logic for us, but in some
// it just hangs for unhandled protocols. Mitigate by checking ourselves.
function canLoadProtocol(url) {
  let protocol = urlFormat.parse(url).protocol || '';
  protocol = protocol.replace(/:$/, '');

  if (!protocol || KNOWN_PROTOCOLS.includes(protocol)) {
    return Promise.resolve(true);
  } else {
    return new Promise((resolve, reject) => {
      let done = (err, result) => {
        if(err) reject(err);
        if(!result){
          reject({
            message: 'navigation error',
            code:    -1000,
            details: 'unhandled protocol',
            url:     url
          });
        }
        resolve(result);
      };
      electron.protocol.isProtocolHandled(protocol, done);
    });
  }
}
// Format headers object for call to loadURL
function toLoadURLOptions(headers){
  let httpReferrer = '';
  let extraHeaders = '';
  for (let key in headers) {
    if (key.toLowerCase() == 'referer') {
      httpReferrer = headers[key];
      continue;
    }

    extraHeaders += key + ': ' + headers[key] + '\n';
  }
  let loadUrlOptions = { extraHeaders: extraHeaders };
  if(httpReferrer){
    loadUrlOptions.httpReferrer = httpReferrer;
  }
  return loadUrlOptions;
}
//Return a promise that resolves after {time}
function wait(time){
  return new Promise((resolve) => setTimeout(resolve, time));
}


/* Export Window */
module.exports = (win, options) => new Window(win, options);
