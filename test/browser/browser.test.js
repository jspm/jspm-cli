import { jspm } from '../test.js';
import { ok, strictEqual } from 'assert';

const { code, stdout, stderr } = await jspm(['install', 'jspm=../../dist/api.js'], import.meta.url);
strictEqual(code, 0);
strictEqual(stderr, '');
ok(stdout.includes('Successfully installed'));

{
  const { code, stdout, stderr } = await jspm(['link', './browser-tests.js', '-o', 'browser.html'], import.meta.url);
  strictEqual(code, 0);
  strictEqual(stderr, '');
  ok(stdout.includes('Linked'));
}
