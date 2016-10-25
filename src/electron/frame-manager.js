const EventEmitter = require('events');
const util         = require('util');

const RENDER_ELEMENT_ID = '__ELECTRON_RUNNER_RENDER__';


/**
 * FrameManager is an event emitter that produces a 'data' event each time the
 * browser window draws to the screen.
 * The primary use for this is to ensure that calling `capturePage()` on a
 * window will produce an image that is up-to-date with the state of the page.
 */
function FrameManager(window) {
  EventEmitter.call(this);
  let subscribed     = false;
  let requestedFrame = false;

  let subscribe = (eventName) => {
    if (!subscribed && eventName === 'data') {
      window.webContents.beginFrameSubscription(receiveFrame);
    }
  }

  let unsubscribe = () => {
    if (!this.listenerCount('data')) {
      window.webContents.endFrameSubscription();
      subscribed = false;
    }
  }

  let receiveFrame = (buffer) => {
    requestedFrame = false;
    this.emit('data', buffer);
  }

  this.on('newListener', subscribe);
  this.on('removeListener', unsubscribe);


  /**
   * In addition to listening for events, calling `requestFrame` will ensure
   * that a frame is queued up to render (instead of just waiting for the next
   * time the browser chooses to draw a frame).
   * @param  {Function} [callback] Called when the frame is rendered.
   */
  this.requestFrame = function(callback) {
    if (callback) {
      this.once('data', callback);
    }
    if (!requestedFrame) {
      requestedFrame = true;
      window.webContents.executeJavaScript(`
        (${triggerRender})("${RENDER_ELEMENT_ID}")
      `);
    }
  };
};

util.inherits(FrameManager, EventEmitter);

// this runs in the render process and alters the render tree, forcing Chromium
// to draw a new frame.
let triggerRender = (function (id) {
  let renderElement = document.getElementById(id);
  if (renderElement) {
    renderElement.remove();
  }
  else {
    renderElement = document.createElement('div');
    renderElement.id = id;
    renderElement.setAttribute('style',
      'position: absolute;' +
      'left: 0;' +
      'top: 0;' +
      'width: 1px;' +
      'height: 1px;');
    document.documentElement.appendChild(renderElement);
  }
}).toString();

/* Export FrameManager */
module.exports = function(window){
  return new FrameManager(window);
};
