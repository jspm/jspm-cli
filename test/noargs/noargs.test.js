import { jspm } from '../test.js';
import { ok, strictEqual } from 'assert';

const { code, stdout, stderr } = await jspm([], import.meta.url);
strictEqual(code, 0);
strictEqual(stderr, '');
ok(stdout.includes('Already installed'));
