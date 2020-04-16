import fs from 'fs';
import jspm from '../dist/index.js';
import { fileURLToPath } from 'url';

const { TraceMap } = jspm;

(async () => {
  const tests = eval(fs.readFileSync(fileURLToPath(import.meta.url + '/../test-list.json')).toString());
  const skip = eval(fs.readFileSync(fileURLToPath(import.meta.url + '/../skip-list.json')).toString());
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
    if (fs.existsSync(path))
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
