let Emitter = require('events').EventEmitter;


/**
 * Export `IPC`
 */

module.exports = IPC;

/**
 * Initialize `IPC`
 */

let instance = Symbol();
function IPC(process) {
  if (process[instance]) {
    return process[instance];
  }

  let emitter = process[instance] = new Emitter();
  let emit = emitter.emit;
  let callId = 0;
  let responders = {};

  // no parent
  if (!process.send) {
    return emitter;
  }

  process.on('message', function(...data) {
    emit.apply(emitter, ...data);
  });

  emitter.emit = function(...args) {
    if(process.connected){
      process.send(args);
    }
  };

  /**
   * Call a responder function in the associated process. (In the process,
   * responders can be registered with `ipc.respondTo()`.) The last argument
   * should be a callback function, which will called with the results of the
   * responder.
   * This returns an event emitter. You can listen for the results of the
   * responder using the `end` event (this is the same as passing a callback).
   * @param  {String} name Name of the responder function to call
   * @param  {...Objects} [arguments] Any number of arguments to send
   * @param  {Function} [callback] A callback function that handles the results
   * @return {Emitter}
   */
  emitter.call = (name, ...args) => {
    let callback = args.pop();
    if (typeof callback !== 'function') {
      args.push(callback);
      callback = undefined;
    }

    let id = callId++;
    let progress = new Emitter();

    emitter.once(`CALL_RESULT_${id}`, (...args) => {
      progress.emit('end', ...args);
      progress.removeAllListeners();
      progress = undefined;
      if (callback) {
        callback(...args);
      }
    });

    emitter.emit('CALL', id, name, ...args);
    return progress;
  };

  /**
   * Register a responder to be called from other processes with `ipc.call()`.
   * The responder should be a function that accepts any number of arguments,
   * where the last argument is a callback function. When the responder has
   * finished its work, it MUST call the callback. The first argument should be
   * an error, if any, and the second should be the results.
   * Only one responder can be registered for a given name.
   * @param {String} name The name to register the responder under.
   * @param {Function} responder
   */
  emitter.respondTo = (name, responder) => {
    responders[name] = responder;
  };

  emitter.on('CALL', (id, name, ...args) => {
    let responder = responders[name];
    let done = (...args) => {
      emitter.emit(`CALL_RESULT_${id}`, ...args);
    };

    if (!responder) {
      done(`Nothing responds to "${name}"`);
      return;
    }

    try {
      responder(...args, done);
    } catch (error) {
      done(error);
    }
  });

  return emitter;
}
