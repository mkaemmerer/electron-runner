import Nightmare from 'nightmare';
import Task from './task';

const DEFAULT_OPTIONS = {
  show: false,
  webPreferences: {
    partition: 'none'
  }
};

//NightmareT<A>  ::  [Task<Nightmare>, Task<A>]
class NightmareT {
  constructor(browser, result){
    this.browser = browser;
    this.result  = result;
  }
  map(f){
    let new_result = this.result.map(f);
    return new NightmareT(this.browser, new_result);
  }
  flatten(){
    let inner_browser = this.result
      .flatMap(n => n.browser);
    let inner_result = this.result
      .flatMap(n => n.result);
    return new NightmareT(inner_browser, inner_result);
  }
  flatMap(f){
    return this.map(f).flatten();
  }
  doAction(name, args){
    let action = this.browser
      .map(n => {
        console.log('Action: ' + name + ' - ' + args);
        return n[name](...args);
      });
    let new_browser = action;
    let new_result  = action.flatMap(Task.fromPromise);

    return new NightmareT(new_browser, new_result);
  }
  static build(opts){
    let nightmare = Nightmare(opts);
    return new NightmareT(Task.of(nightmare), Task.fromPromise(nightmare));
  }
}

let interpret = (program, options) => {
  let start = NightmareT.build(options);
  let step = (browser, {name, args}) => {
    let browser2 = browser.doAction(name, args);
    return [browser2, browser2];
  };
  let done = (browser, result) => {
    return browser;
  };
  return program.foldRun(start, step, done);
};

let run = (program, options = DEFAULT_OPTIONS) => {
  let result = interpret(program, options);
  result.browser
    .run(n => {
      console.log('END');
      n.end().then(() => {});
    });

  return result.result;
};

export default run;
