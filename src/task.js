export default class Task {
  constructor(run){
    let result;
    this.run = (cb) => {
      if(result){
        cb(result);
      } else {
        run(x => {
          result = x;
          cb(x);
        });
      }
    };
  }
  map(f){
    let run = cb =>
      this.run(v => cb(f(v)));
    return new Task(run);
  }
  flatten(){
    let run = cb =>
      this.run(t => t.run(cb));
    return new Task(run);
  }
  flatMap(f){
    return this.map(f).flatten();
  }
  static fromPromise(promise){
    return new Task((cb) => promise.then(cb));
  }
  static of(x){
    return new Task(cb => process.nextTick(() => cb(x)));
  }
}
