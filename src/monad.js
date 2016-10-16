import Free from './free';

let cached = f => {
  let value = undefined;
  return x => {
    if(value === undefined) {
      value = f(x);
    }
    return value;
  };
};

let Monad = {
  do: gen => {
    let g    = gen();
    let step = data => {
      let { done, value } = g.next(data);
      return done ? value : value.flatMap(cached(step));
    };
    return step();
  },
  of: Free.pure
};

export default Monad;
