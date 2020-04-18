import fs from 'fs';
import jspm from '../dist/index.js';
import { fileURLToPath } from 'url';

const { TraceMap } = jspm;

const regenerate = false;

(async () => {
  const testList = eval(fs.readFileSync(fileURLToPath(import.meta.url + '/../tests.js')).toString())
  const tests = [...testList.map(test => Array.isArray(test) ? test[0] : test), ...eval(fs.readFileSync(fileURLToPath(import.meta.url + '/../test-list.json')).toString())];
  const skip = eval(fs.readFileSync(fileURLToPath(import.meta.url + '/../skip-list.js')).toString());
  let failures = 0;
  let successes = 0;
  let count = tests.length;
  for (const [index, test] of tests.entries()) {
    if (skip.includes(test)) {
      count--;
      continue;
    }
    const [installs] = typeof test === 'string' ? [test, test] : test;
    const path = fileURLToPath(import.meta.url + '/../maps/') + encodeURIComponent(installs) + '.json';
    if (!regenerate && fs.existsSync(path))
      continue;
    console.log('Generating map for ' + test + ' (' + (index + 1) + ' / ' + count + ' | ' + successes + ' / ' + failures + ')');
    const map = new TraceMap(new URL('.', import.meta.url).href);
    try {
      await map.install(installs.split(' '));
      successes++;
    }
    catch (e) {
      failures++;
      console.error(e);
      continue;
    }
    fs.writeFileSync(path, map.toString());
  }
})()
.catch(e => {
  console.error(e);
  process.exit(1);
});
