export default class Free {
  constructor(type, next, result){
    this.type   = type;
    this.next   = next;
    this.result = result;
  }
  static impure(next, result){
    return new Free('IMPURE', next, result);
  }
  static pure(result){
    return new Free('PURE', undefined, result);
  }

  map(f){
    switch(this.type){
      case 'IMPURE':
        let f_next = x => this.next(x).map(f);
        return Free.impure(f_next, this.result);
      case 'PURE':
        return Free.pure(f(this.result));
    }
  }
  flatten(){
    switch(this.type){
      case 'IMPURE':
        let inner_next = x => this.next(x).flatten();
        return Free.impure(inner_next, this.result);
      case 'PURE':
        return this.result;
    }
  }
  flatMap(f){
    return this.map(f).flatten();
  }
  flatMap_(x){
    return this.flatMap(() => x);
  }
  foldRun(start, step, done){
    switch(this.type){
      case 'IMPURE':
        let [nextM, nextState] = step(start, this.result);
        return nextM
          .flatMap(result => this.next(result).foldRun(nextState, step, done));
      case 'PURE':
        return done(start, this.result);
    }
  }
  foldMap(step, done){
    switch(this.type){
      case 'IMPURE':
        return step(this.result)
          .flatMap(r => this.next(r).foldMap(step, done));
      case 'PURE':
        return done(this.result);
    }
  }
}
