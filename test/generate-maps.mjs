import fs from 'fs';
import jspm from '../dist/index.js';
import { fileURLToPath } from 'url';

const { TraceMap } = jspm;

(async () => {
  const tests = eval(fs.readFileSync(fileURLToPath(import.meta.url + '/../tests.js')).toString());
  for (const test of tests) {
    const [installs] = typeof test === 'string' ? [test, test] : test;
    const map = new TraceMap(new URL('.', import.meta.url).href);
    await map.install(installs.split(' '));
    fs.writeFileSync(fileURLToPath(import.meta.url + '/../maps/') + encodeURIComponent(installs) + '.json', map.toString());
  }
})()
.catch(e => {
  console.error(e);
  process.exit(1);
});
