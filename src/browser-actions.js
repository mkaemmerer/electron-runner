import Free from './free';

//Actions
let liftF    = cmd => Free.impure(Free.pure, cmd);
let doAction = name => (...args) => liftF({ name, args });

export let begin = Free.pure;

//Primitive Actions
export let evaluate   = doAction('evaluate');
export let goto       = doAction('goto');
export let screenshot = doAction('screenshot');
export let type       = doAction('type');
export let viewport   = doAction('viewport');
export let wait       = doAction('wait');

//Derived Actions
function doClick(selector){
  document.activeElement.blur();
  let element = document.querySelector(selector);
  if (!element) {
    throw new Error('Unable to find element by selector: ' + selector);
  }
  let event = document.createEvent('MouseEvent');
  event.initEvent('click', true, true);
  element.dispatchEvent(event);
}
export let click = (selector) => evaluate(doClick, selector);
