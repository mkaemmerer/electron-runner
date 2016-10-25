import Nightmare from './electron/nightmare';
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

let run = (program, options = DEFAULT_OPTIONS) => {
  let browser = Nightmare(options);
  let result  = interpret(program, browser);

  result
    .run(n => {
      console.log('END');
      n.end().then(() => {});
    });

  return result;
};

export default run;
