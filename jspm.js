#!/usr/bin/env node
var Liftoff = require('liftoff');
var path = require('path');

var jspmCLI = new Liftoff({
  name: 'jspm',
  configName: 'package',
  extensions: {
    '.json': null
  }
});
jspmCLI.launch({}, function(env) {
  if (env.modulePath) {
    process.env.localJspm = true;
    require(path.resolve(env.modulePath, '../cli'));
  }
  else {
    require('./cli');
  }
});