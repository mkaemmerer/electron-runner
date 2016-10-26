let electron      = require('electron');
let defaults      = require('deep-defaults');
let path          = require('path');
let BrowserWindow = electron.BrowserWindow;
let renderer      = electron.ipcMain;
let app           = electron.app;
let urlFormat     = require('url');
let parent        = require('./ipc')(process);
let FrameManager  = require('./frame-manager');

// Default Electron options
const DEFAULT_OPTIONS = {
  show: false,
  alwaysOnTop: true,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    nodeIntegration: false
  }
};
// URL protocols that don't need to be checked for validity
const KNOWN_PROTOCOLS = ['http', 'https', 'file', 'about', 'javascript'];
// Property for tracking whether a window is ready for interaction
const IS_READY = Symbol('isReady');

/**
 * Handle uncaught exceptions in the main electron process
 */

process.on('uncaughtException', (e) => {
  parent.emit('uncaughtException', e.stack)
})

/**
 * Update the app paths
 */

let processArgs = JSON.parse(process.argv[2]);
let paths = processArgs.paths;
if (paths) {
  for (let i in paths) {
    app.setPath(i, paths[i]);
  }
}
let switches = processArgs.switches;
if (switches) {
  for (let i in switches) {
    app.commandLine.appendSwitch(i, switches[i]);
  }
}

/**
 * Hide the dock
 */

// app.dock is not defined when running
// electron in a platform other than OS X
if (!processArgs.dock && app.dock) {
  app.dock.hide();
}

/**
 * Listen for the app being "ready"
 */

app.on('ready', () => {
  let win, frameManager, options, closed;

  /**
   * create a browser window
   */

  parent.respondTo('browser-initialize', (done, opts = {}) => {

    options = defaults(opts, DEFAULT_OPTIONS);

    /**
     * Create a new Browser Window
     * Window Docs:
     * https://github.com/atom/electron/blob/master/docs/api/browser-window.md
     */

    win = new BrowserWindow(options);
    if(options.show && options.openDevTools){
      if(typeof options.openDevTools === 'object') {
        win.openDevTools(options.openDevTools);
      } else {
        win.openDevTools();
      }
    }


    frameManager = FrameManager(win);

    /**
     * Window options
     */

    win.webContents.setAudioMuted(true);

    /**
     * Pass along web content events
     */

    renderer.on('page', (sender, ...args) => {
      parent.emit('page', ...args);
    });

    renderer.on('console', (sender, type, ...args) => {
      parent.emit('console', type, ...args);
    });

    win.webContents.on('did-finish-load',           forward('did-finish-load'));
    win.webContents.on('did-fail-load',             forward('did-fail-load'));
    win.webContents.on('did-fail-provisional-load', forward('did-fail-provisional-load'));
    win.webContents.on('did-frame-finish-load',     forward('did-frame-finish-load'));
    win.webContents.on('did-start-loading',         forward('did-start-loading'));
    win.webContents.on('did-stop-loading',          forward('did-stop-loading'));
    win.webContents.on('did-get-response-details',  forward('did-get-response-details'));
    win.webContents.on('did-get-redirect-request',  forward('did-get-redirect-request'));
    win.webContents.on('dom-ready',                 forward('dom-ready'));
    win.webContents.on('page-favicon-updated',      forward('page-favicon-updated'));
    win.webContents.on('new-window',                forward('new-window'));
    win.webContents.on('will-navigate',             forward('will-navigate'));
    win.webContents.on('crashed',                   forward('crashed'));
    win.webContents.on('plugin-crashed',            forward('plugin-crashed'));
    win.webContents.on('destroyed',                 forward('destroyed'));
    win.webContents.on('close', (e) => { closed = true; });

    let loadwatch;

    win.webContents.on('did-start-loading', () => {
      if (win.webContents.isLoadingMainFrame()) {
        if(options.loadTimeout){
          loadwatch = setTimeout(() => {
            win.webContents.stop();
          }, options.loadTimeout);
        }
        setIsReady(false);
      }
    });

    win.webContents.on('did-stop-loading', () => {
      clearTimeout(loadwatch);
      setIsReady(true);
    });

    setIsReady(true);

    done();
  });

  /**
   * goto
   */

  parent.respondTo('goto', (done, url, headers, timeout) => {
    if (!url || typeof url !== 'string') {
      return done(new Error('goto: `url` must be a non-empty string'));
    }

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
    httpReferrer && (loadUrlOptions.httpReferrer = httpReferrer);

    if (win.webContents.getURL() == url) {
      done();
    } else {
      let responseData = {};
      let domLoaded = false;

      let timer = setTimeout(() => {
        // If the DOM loaded before timing out, consider the load successful.
        let error = domLoaded ? undefined : {
          message: 'navigation error',
          code: -7, // chromium's generic networking timeout code
          details: `Navigation timed out after ${timeout} ms`,
          url: url
        };
        // Even if "successful," note that some things didn't finish.
        responseData.details = `Not all resources loaded after ${timeout} ms`;
        cleanup(error, responseData);
      }, timeout);

      function handleFailure(event, code, detail, failedUrl, isMainFrame) {
        if (isMainFrame) {
          cleanup({
            message: 'navigation error',
            code: code,
            details: detail,
            url: failedUrl || url
          });
        }
      }

      function handleDetails(
        event, status, newUrl, oldUrl, statusCode, method, referrer, headers, resourceType) {
        if (resourceType === 'mainFrame') {
          responseData = {
            url: newUrl,
            code: statusCode,
            method: method,
            referrer: referrer,
            headers: headers
          };
        }
      }

      function handleDomReady() { domLoaded = true; }

      // We will have already unsubscribed if load failed, so assume success.
      function handleFinish(event) {
        cleanup(null, responseData);
      }

      function cleanup(error, data) {
        clearTimeout(timer);
        win.webContents.removeListener('did-fail-load',             handleFailure);
        win.webContents.removeListener('did-fail-provisional-load', handleFailure);
        win.webContents.removeListener('did-get-response-details',  handleDetails);
        win.webContents.removeListener('dom-ready',                 handleDomReady);
        win.webContents.removeListener('did-finish-load',           handleFinish);
        setIsReady(true);
        // wait a tick before notifying to resolve race conditions for events
        setImmediate(() => done(error, data));
      }

      // In most environments, loadURL handles this logic for us, but in some
      // it just hangs for unhandled protocols. Mitigate by checking ourselves.
      function canLoadProtocol(protocol, callback) {
        protocol = (protocol || '').replace(/:$/, '');
        if (!protocol || KNOWN_PROTOCOLS.includes(protocol)) {
          return callback(true);
        }
        electron.protocol.isProtocolHandled(protocol, callback);
      }

      function startLoading() {
        // abort any pending loads first
        if (win.webContents.isLoading()) {
          win.webContents.once('did-stop-loading', () => {
            startLoading();
          });
          return win.webContents.stop();
        }

        win.webContents.on('did-fail-load',             handleFailure);
        win.webContents.on('did-fail-provisional-load', handleFailure);
        win.webContents.on('did-get-response-details',  handleDetails);
        win.webContents.on('dom-ready',                 handleDomReady);
        win.webContents.on('did-finish-load',           handleFinish);
        win.webContents.loadURL(url, loadUrlOptions);

        // javascript: URLs *may* trigger page loads; wait a bit to see
        if (protocol === 'javascript:') {
          setTimeout(() => {
            if (!win.webContents.isLoadingMainFrame()) {
              done(null, {
                url: url,
                code: 200,
                method: 'GET',
                referrer: win.webContents.getURL(),
                headers: {}
              });
            }
          }, 10);
        }
      }

      let protocol = urlFormat.parse(url).protocol;
      canLoadProtocol(protocol, (canLoad) => {
        if (canLoad) {
          return startLoading();
        }

        cleanup({
          message: 'navigation error',
          code: -1000,
          details: 'unhandled protocol',
          url: url
        });
      });
    }
  });

  /**
   * javascript
   */

  parent.respondTo('javascript', (done, src) => {
    let response = (event, response) => {
      renderer.removeListener('error', error);
      renderer.removeListener('log', log);
      done(null, response);
    };

    let error = (event, error) => {
      renderer.removeListener('log', log);
      renderer.removeListener('response', response);
      done(error);
    };

    let log = (event, args) => parent.emit.apply(parent, ['log'].concat(args));

    renderer.once('response', response);
    renderer.once('error', error);
    renderer.on('log', log);

    win.webContents.executeJavaScript(src);
  });

  /**
   * size
   */

  parent.respondTo('size', (done, width, height) => {
    win.setSize(width, height);
    done();
  });

  /**
   * type
   */

  parent.respondTo('type', (done, value) => {
    let chars = String(value).split('');

    let type = () => {
      let ch = chars.shift();
      if (ch === undefined) {
        return done();
      }

      // keydown
      win.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: ch
      });
      // keypress
      win.webContents.sendInputEvent({
        type: 'char',
        keyCode: ch
      });
      // keyup
      win.webContents.sendInputEvent({
        type: 'keyUp',
        keyCode: ch
      });

      setTimeout(type, options.typeInterval);
    }

    // start
    type();
  })

  /**
   * screenshot
   */

  parent.respondTo('screenshot', (done) => {
    // https://gist.github.com/twolfson/0d374d9d7f26eefe7d38
    frameManager.requestFrame(() => {
      win.capturePage((img) => {
        done(null, img.toPng());
      });
    });
  });

  /**
   * Add custom functionality
   */

  parent.respondTo('action', (done, name, fntext) => {
    let fn = new Function('with(this){ return ' + fntext + '}')
      .call({
        require: require,
        parent: parent
      });
    fn(name, options, parent, win, renderer, (error) => {
      done(error);
     });
  });

  /**
   * Continue
   */

  parent.respondTo('continue', (done) => {
    if (isReady()) {
      done();
    } else {
      win.once('did-change-is-ready', () => {
        done();
      });
    }
  });

  /**
   * Authentication
   */

  let loginListener;
  parent.respondTo('authentication', (done, login, password) => {
    let currentUrl;
    let tries = 0;
    if(loginListener){
      win.webContents.removeListener('login', loginListener);
    }

    loginListener = (webContents, request, authInfo, callback) => {
      tries++;
      if(currentUrl != request.url) {
        currentUrl = request.url;
        tries = 1;
      }

      if(tries >= options.maxAuthRetries){
        parent.emit('die', 'problem authenticating, check your credentials');
      } else {
        callback(login, password);
      }
    }
    win.webContents.on('login', loginListener);

    done();
  });

 /**
   * Kill the electron app
   */

  parent.respondTo('quit', (done) => {
    app.quit();
    done();
  });

  /**
   * Send "ready" event to the parent process
   */

  parent.emit('ready');

  /**
   * Check whether the window is ready for interaction
   */
  function isReady() {
    return win[IS_READY];
  }

  /**
   * Set whether the window is ready for interaction
   */
  function setIsReady(ready) {
    ready = !!ready;
    if (ready !== win[IS_READY]) {
      win[IS_READY] = ready;
      win.emit('did-change-is-ready', ready);
    }
  }

  /**
   * Forward events
   */

  function forward(name) {
    return (event, ...args) => {
      // NOTE: the raw Electron event used to be forwarded here, but we now send
      // an empty event in its place -- the raw event is not JSON serializable.
      if(!closed) {
        parent.emit(name, {}, ...args);
      }
    };
  }

});
