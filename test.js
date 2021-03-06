import { begin, click, evaluate, goto, screenshot, type, viewport, wait, run } from './index';

const SITE_URL = 'http://yoursite.com';
const CREDENTIALS = {
  email:    'EMAIL',
  password: 'PASSWORD'
};

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
