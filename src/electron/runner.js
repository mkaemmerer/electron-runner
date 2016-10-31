let electron      = require('electron');
let defaults      = require('deep-defaults');
let path          = require('path');
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
    return win.goto(url, headers, timeout);
  });

  /**
   * javascript
   */

  parent.respondTo('javascript', (src) => {
    return win.javascript(src);
  });

  /**
   * setSize
   */

  parent.respondTo('size', (width, height) => {
    return win.setSize(width, height);
  });

  /**
   * type
   */

  parent.respondTo('type', (value) => {
    return win.type(value, options.typeInterval);
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
