import { jspm } from '../test.js';
import { unlinkSync, readFileSync } from 'fs';
import { ok, strictEqual } from 'assert';

const { code, stdout, stderr } = await jspm(['install', 'jquery'], import.meta.url);
strictEqual(code, 0);
strictEqual(stderr, '');
ok(stdout.includes('Successfully installed'));

const importmap = readFileSync('jspm.importmap').toString();
importmap.includes('"jquery"');
unlinkSync('jspm.importmap');
