import { cli } from '../dist/cli.js';

const commands = ['link', 'install', 'uninstall', 'update', 'clear-cache'];

for (const command of commands) {
  console.log(`## ${command}`);
  cli.parse(['node', 'jspm', command, '--help']);
}
