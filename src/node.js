#!/usr/bin/env node

// CLI
if (require.main === module) {
  const cli = require('./cli').cli;
  const [,, cmd, ...rawArgs] = process.argv;
  // help and version are only commands that support either form in CLI
  if (cmd) {
    if (cmd === '-v' || cmd === '--version')
      cmd = 'version';
    else if (cmd === '-h' || cmd === '--help')
      cmd = 'help';
    else if (cmd[0] === '-')
      cmd = undefined;
  }
  cli(cmd, rawArgs)
  .catch(e => {
    console.error(e);
    process.exit(1);
  });  
}
// API
else {
  module.exports = require('./tracemap');
}
