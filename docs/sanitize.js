import { readFileSync, writeFileSync } from 'node:fs';

let docs = readFileSync('docs.md', 'utf8');

docs = docs.replace(/\x1b\[[0-9;]*m/g, '');
docs = docs.replace(/jspm\/[^\n]+\n/g, '');
docs = docs.replace(/^([a-zA-Z-_]+):$/mg, '### $1');
docs = docs.replace(/  ((-[a-zA-Z], )?--[a-zA-Z-_]+)/mg, '* `$1`');
docs = docs.replace(/\$ (jspm[^\n]+)\n/g, '\n```\n$1```');
docs = docs.replace(/\<([a-zA-Z0-9]+)\>/g, '_&lt;$1&gt;_');

writeFileSync('docs.md', docs);
