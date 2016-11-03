window.__electron_runner = {};
__electron_runner.ipc = require('electron').ipcRenderer;

// Listen for error events
window.addEventListener('error', function(e) {
  __electron_runner.ipc.send('page', 'error', e.message, e.error.stack);
});

(function(){
  // listen for console.log
  var defaultLog = console.log;
  console.log = function() {
    __electron_runner.ipc.send('console', 'log', Array.prototype.slice.apply(arguments));
    return defaultLog.apply(this, arguments);
  };

  // listen for console.warn
  var defaultWarn = console.warn;
  console.warn = function() {
    __electron_runner.ipc.send('console', 'warn', Array.prototype.slice.apply(arguments));
    return defaultWarn.apply(this, arguments);
  };

  // listen for console.error
  var defaultError = console.error;
  console.error = function() {
    __electron_runner.ipc.send('console', 'error', Array.prototype.slice.apply(arguments));
    return defaultError.apply(this, arguments);
  };

  // overwrite the default alert
  window.alert = function(message){
    __electron_runner.ipc.send('page', 'alert', message);
  };

  // overwrite the default prompt
  window.prompt = function(message, defaultResponse){
    __electron_runner.ipc.send('page', 'prompt', message, defaultResponse);
  }

  // overwrite the default confirm
  window.confirm = function(message, defaultResponse){
    __electron_runner.ipc.send('page', 'confirm', message, defaultResponse);
  }
})()
