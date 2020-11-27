import { jspm } from '../test.js';
import { strictEqual, ok } from 'assert';
import { existsSync } from 'fs';

const { code, stdout, stderr } = await jspm(['link', './static.js', '--static', '-o'], import.meta.url);
strictEqual(stderr, '');
strictEqual(code, 0);
ok(stdout.indexOf('{}') > 0);

strictEqual(existsSync(new URL('./jspm.importmap', import.meta.url)), false);
