let electron      = require('electron');
let renderer      = electron.ipcMain;
let urlFormat     = require('url');
let FrameManager  = require('./frame-manager');


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
 * abortPending
 */
Window.prototype.abortPending = function(){
  return new Promise((resolve) => {
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
};

/**
 * navigate {url, headers}
 */
 Window.prototype.navigate = function(url, headers){
   if (this.webContents.getURL() == url) {
     return Promise.resolve();
   }

   let loadUrlOptions = toLoadURLOptions(headers);
   let responseData = {};

   return new Promise((resolve, reject) => {
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
       this.webContents.on('did-finish-load',           handleFinish);
     };
     let cleanup = () => {
       this.webContents.removeListener('did-fail-load',             handleFailure);
       this.webContents.removeListener('did-fail-provisional-load', handleFailure);
       this.webContents.removeListener('did-get-response-details',  handleDetails);
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
 };

/**
 * javascript {src}
 */
Window.prototype.javascript = function(source){
  let ret = new Promise((resolve, reject) => {
    renderer.once('javascript', (_, type, res) => {
      if(type === 'response'){
        resolve(res);
      } else {
        reject(res);
      }
    });
  });

  this.webContents.executeJavaScript(`
  (function javascript () {
    function sendResponse(r){
      if(window.__electron_runner){
        __electron_runner.ipc.send('javascript', 'response', r);
      } else {
        window.opener.postMessage({
          name: 'javascript',
          type: 'response',
          data: r
        });
      }
    }
    function sendError(e){
      if(window.__electron_runner){
        __electron_runner.ipc.send('javascript', 'error', e.message);
      } else {
        window.opener.postMessage({
          name: 'javascript',
          type: 'error',
          data: e.message
        });
      }
    }

    try {
      var response = ${source};
      sendResponse(response);
    } catch (error) {
      sendError(error);
    }
  })()
  `);

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


/* Export Window */
module.exports = (win, options) => new Window(win, options);
