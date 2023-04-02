import { cli } from '../dist/cli.js';
import { readFileSync } from 'node:fs';

const commands = ['link', 'install', 'uninstall', 'update', 'clear-cache'];

console.log(readFileSync('docs/intro.md', 'utf8'));

for (const command of commands) {
  console.log(`## ${command}`);
  cli.parse(['node', 'jspm', command, '--help']);
}

console.log(readFileSync('docs/config.md', 'utf8'));
