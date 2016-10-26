let Emitter = require('events').EventEmitter;

let instance = Symbol();
function IPC(process) {
  if (process[instance]) {
    return process[instance];
  }

  let emitter    = process[instance] = new Emitter();
  let emit       = emitter.emit;
  let callId     = 0;
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
   * responders can be registered with `ipc.respondTo()`.) The first argument
   * should be a callback function, which will called with the results of the
   * responder.
   * @param  {String} name Name of the responder function to call
   * @param  {Function} [callback] A callback function that handles the results
   * @param  {...Objects} [arguments] Any number of arguments to send
   */
  emitter.call = (name, callback, ...args) => {
    let id = callId++;

    emitter.once(`CALL_RESULT_${id}`, (...args) => {
      callback(...args);
    });

    emitter.emit('CALL', id, name, ...args);
  };

  /**
   * Register a responder to be called from other processes with `ipc.call()`.
   * The responder should be a function that accepts any number of arguments,
   * where the first argument is a callback function. When the responder has
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
      done(new Error(`Nothing responds to "${name}"`));
      return;
    }

    try {
      responder(done, ...args);
    } catch (error) {
      done(error);
    }
  });

  return emitter;
}

/**
 * Export `IPC`
 */

module.exports = IPC;
