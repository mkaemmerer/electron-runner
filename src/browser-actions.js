import Free from './free';

//Actions
let liftF    = cmd => Free.impure(Free.pure, cmd);
let doAction = name => (...args) => liftF({ name, args });

export let begin = Free.pure;

//Action Types
export let click      = doAction('click');
export let evaluate   = doAction('evaluate');
export let goto       = doAction('goto');
export let screenshot = doAction('screenshot');
export let type       = doAction('type');
export let viewport   = doAction('viewport');
export let wait       = doAction('wait');
