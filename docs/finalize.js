import { readFileSync, writeFileSync } from 'node:fs';

let docs = readFileSync('docs.md', 'utf8');

// links
docs = docs.replace(/\<environments\>/g, '&lt;[environments](#environments)&gt;');
docs = docs.replace(/\<provider\>/g, '&lt;[providers](#providers)&gt;');
docs = docs.replace(/\<resolutions\>/g, '&lt;[resolutions](#resolutions)&gt;');

docs = docs.replace(/\x1b\[[0-9;]*m/g, '');
docs = docs.replace(/jspm\/[^\n]+\n/g, '');
docs = docs.replace(/^([a-zA-Z-_]+):$/mg, '### $1');
docs = docs.replace(/  ((-[a-zA-Z], )?--[a-zA-Z-_]+)/mg, '* `$1`');
docs = docs.replace(/\$ (jspm[^\n]+)\n/g, '\n```\n$1\n```');
docs = docs.replace(/\<([a-zA-Z0-9]+)\>/g, '_&lt;$1&gt;_');

const intro = readFileSync('docs/intro.md', 'utf8');
const config = readFileSync('docs/config.md', 'utf8');

writeFileSync('docs.md', `
${intro}
${docs.slice(docs.indexOf('#'))}
${config}
`);
