#!/usr/bin/env node

// CLI
if (require.main === module) {
  const cli = require('./cli').cli;
  const chalk = require('chalk');
  const [,, cmd, ...rawArgs] = process.argv;
  cli(cmd, rawArgs)
  .catch(e => {
    if (e.jspmError)
      console.error(`${chalk.bold.red('err')}  ${e.message}`);
    else
      console.error(e);
    process.exit(1);
  });  
}
// API
else {
  module.exports = require('./tracemap');
}
