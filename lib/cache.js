/*
 *   Copyright 2014-2015 Guy Bedford (http://guybedford.com)
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
require('core-js/es6/string');

var config = require('./config');
var path = require('path');
var fs = require('graceful-fs');
var rimraf = require('rimraf');

exports.clean = function () {
  var jspmDir = path.resolve(config.HOME, '.jspm');
  var loaderFilesCacheDir = path.join(jspmDir, 'loader-files');
  var packagesCacheDir = path.join(jspmDir, 'packages');

  if (fs.existsSync(loaderFilesCacheDir))
    rimraf.sync(loaderFilesCacheDir);

  if (fs.existsSync(packagesCacheDir))
    rimraf.sync(packagesCacheDir);

  var files = fs.readdirSync(jspmDir);

  for (var i = 0; i < files.length; i++) {
    var filePath = path.join(jspmDir, files[i]), basename = files[i];
    if (basename.endsWith('-cache') && fs.lstatSync(filePath).isDirectory()) {
      rimraf.sync(filePath);
    }
  }
};
