#!/usr/bin/env node

/*
 *   Copyright 2014-2016 Guy Bedford (http://guybedford.com)
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */

var Liftoff = require('liftoff');
var path = require('path');

var jspmCLI = new Liftoff({
  name: 'jspm',
  configName: 'package',
  extensions: {
    '.json': null
  }
});

var args = process.argv.slice(2);
var cwdArgIndex = args.indexOf('--cwd');
if (cwdArgIndex > -1) {
  process.chdir(args[cwdArgIndex + 1]);
}

jspmCLI.launch({ cwd: process.cwd() }, function(env) {
  process.env.jspmConfigPath = env.configPath || '';
  process.env.globalJspm = !env.modulePath;
  if (env.modulePath)
    require(path.resolve(env.modulePath, '../cli'));
  else
    require('./cli');
});
