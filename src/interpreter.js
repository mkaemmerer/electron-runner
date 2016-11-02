import Driver from './electron/driver';
import Free from './free';
import Task from './task';

const DEFAULT_OPTIONS = {
  show: false,
  webPreferences: {
    partition: 'none'
  }
};

let interpret = (program, browser) => {
  let start = Task.of(browser);
  let step  = (browser, {name, args}) => {
    let action = browser.map(n => n[name](...args));
    console.log('Action: ' + name + ' - ' + args);
    return [
      action.flatMap(Task.fromPromise),
      action
    ];
  };
  let done = (browser, result) => browser;

  return program.foldRun(start, step, done);
};

let end = Free.impure(Free.pure, {name: 'end', args: []});

let run = (program, options = DEFAULT_OPTIONS) => {
  let browser = Driver(options);
  let result  = interpret(program.flatMap(() => end), browser);

  result.run(() => {});

  return result;
};

export default run;
