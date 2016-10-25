let minstache = require('minstache');

/**
 * Run the `src` function on the client-side, capture
 * the response and logs, and send back via
 * ipc to electron's main process
 */

let execute = `
(function javascript () {
  var ipc = __electron_runner.ipc;
  try {
    var response = ({{!src}})({{!args}})
    ipc.send('response', response);
  } catch (e) {
    ipc.send('error', e.message);
  }
})()
`;

/**
 * Export the templates
 */

exports.execute = minstache.compile(execute);
