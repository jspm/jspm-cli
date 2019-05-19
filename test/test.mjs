import Mocha from 'mocha';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

(async () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const tests = readdirSync(__dirname).filter(name => name.endsWith('.js'))
  // DYNAMIC IMPORT BUG in Node.js :P
  .filter(x => x !== 'install-basic.js');
  const mocha = new Mocha({
    ui: 'tdd'
  });

  for (const test of tests) {
    mocha.suite.emit('pre-require', global, test, mocha);
    await import('./' + test);
  }

  mocha.run();
})()
.catch(e => {
  console.error(e);
});