let electron      = require('electron');
let defaults      = require('deep-defaults');
let path          = require('path');
let urlFormat     = require('url');
let BrowserWindow = electron.BrowserWindow;
let renderer      = electron.ipcMain;
let app           = electron.app;
let parent        = require('./ipc')(process);
let Window        = require('./window');

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
  let win, options;

  /**
   * create a browser window
   */

  parent.respondTo('browser-initialize', (opts = {}) => {
    options = defaults(opts, DEFAULT_OPTIONS);

    /**
     * Create a new Browser Window
     * Window Docs:
     * https://github.com/atom/electron/blob/master/docs/api/browser-window.md
     */

    win = Window(new BrowserWindow(options), options, parent);

    /**
     * Pass along web content events
     */

    renderer.on('page', (sender, ...args) => {
      parent.emit('page', ...args);
    });
    renderer.on('console', (sender, type, ...args) => {
      parent.emit('console', type, ...args);
    });

    return Promise.resolve();
  });

  /**
   * goto
   */

  parent.respondTo('goto', (url, headers, timeout) => {
    if (!url || typeof url !== 'string') {
      let error = new Error('navigate: `url` must be a non-empty string');
      return Promise.reject(error);
    }

    let timer = wait(timeout)
      //Navigation error
      .then(() =>
        Promise.reject({
          message: 'navigation error',
          code: -7, // chromium's generic networking timeout code
          details: `Navigation timed out after ${timeout} ms`,
          url: url
        }));

    let goto = canLoadProtocol(url)
      .then(() => win.abortPending())
      .then(() => win.navigate(url, headers));

    return Promise.race([timer, goto]);
  });

  /**
   * javascript
   */

  parent.respondTo('javascript', (src) => {
    return win.javascript(src);
  });

  /**
   * viewport
   */

  parent.respondTo('viewport', (width, height) => {
    return win.setSize(width, height);
  });

  /**
   * type
   */

  parent.respondTo('type', (value) => {
    let chars = String(value).split('');

    let type = (ch) =>
      win.sendKey(ch)
        .then(() => wait(options.typeInterval));

    return chars.reduce(
      (last, ch) => last.then(() => type(ch)),
      Promise.resolve()
    );
  });

  /**
   * screenshot
   */

  parent.respondTo('screenshot', () => {
    return win.screenshot();
  });

  /**
   * continue
   */

  parent.respondTo('continue', () => {
    return win.continue();
  });

  /**
   * Kill the electron app
   */

  parent.respondTo('quit', () => {
    app.quit();
    return Promise.resolve();
  });

  /**
   * Send "ready" event to the parent process
   */

  parent.emit('ready');

});


//Return a promise that resolves after {time}
function wait(time){
  return new Promise((resolve) => setTimeout(resolve, time));
}

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
