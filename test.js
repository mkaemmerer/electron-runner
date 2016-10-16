import { begin, click, evaluate, goto, screenshot, type, viewport, wait } from './src/browser-actions';
import run from './src/interpreter';

import Nightmare from 'nightmare';

const SITE_URL = 'http://yoursite.com';
const CREDENTIALS = {
  email:    'EMAIL',
  password: 'PASSWORD'
};


// ----- Using Nightmare directly
// let browser = Nightmare({
//   show: true,
//   webPreferences: {
//     partition: 'none'
//   }
// });
// let program1 = browser
//   .goto(SITE_URL)
//     .type('.input-field:not([type=password])', CREDENTIALS.email)
//     .type('.input-field[type=password]', CREDENTIALS.password)
//     .click('button[type=submit]')
//   .wait('.dashboard-header')
//   .screenshot('./screenshots/dashboard.png');
// program1.end().then(() => {});


// ----- Using Free Monads
let login = ({email, password}) => begin()
  .flatMap_(type('.input-field:not([type=password])', email))
  .flatMap_(type('.input-field[type=password]', password))
  .flatMap_(click('button[type=submit]'));

let program = begin()
  .flatMap_(viewport(320, 568))
  .flatMap_(goto(SITE_URL))
  .flatMap_(login(CREDENTIALS))
  .flatMap_(wait('.dashboard-header'))
  .flatMap_(screenshot('./screenshots/dashboard.png'));


run(program, {
  show: true,
  webPreferences: {
    partition: 'none'
  }
});
