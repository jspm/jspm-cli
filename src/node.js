#!/usr/bin/env node

// CLI
if (require.main === module) {
  const cli = require('./cli').cli;
  const [,, cmd, ...rawArgs] = process.argv;
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
