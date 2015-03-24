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

var ui = require('./ui');
var fs = require('graceful-fs');
var path = require('path');
var HOME = require('./config').HOME;
var dprepend = require('./common').dprepend;

// global config - automatically created and loaded on startup
exports.registries = [];
var globalConfigFile = HOME + path.sep + '.jspm' + path.sep + 'config';
function save() {
  try {
    fs.mkdirSync(HOME + path.sep + '.jspm');
  }
  catch(e) {
    if (e.code !== 'EEXIST')
      throw 'Unable to create jspm system folder\n' + e.stack;
  }
  try {
    fs.writeFileSync(globalConfigFile, JSON.stringify(exports.config, null, 2));
  }
  catch(e) {
    throw 'Unable to write global configuration file\n' + e.stack;
  }
}
if (fs.existsSync(globalConfigFile)) {
  try {
    exports.config = JSON.parse(fs.readFileSync(globalConfigFile).toString() || '{}');
  }
  catch(e) {
    exports.config = {};
    ui.log('err', 'Unable to read global configuration file.\nEnsure you have read and write access to %' + globalConfigFile + '%.');
    process.exit(1);
  }
}
else {
  exports.config = {};
  if (HOME)
    save();
}
exports.save = save;


// NB can deprecate with jspm 0.14
if (!exports.config.defaultRegistry && exports.config.registry)
  exports.config.defaultRegistry = exports.config.registry;
if (!exports.config.registries && exports.config.endpoints)
  exports.config.registries = exports.config.endpoints;

// NB add this to deprecate 0.14
// delete exports.config.registry;
// delete exports.config.endpoints;

/*
 * Populate default registry configuration
 */
dprepend(exports.config, {
  defaultRegistry: 'jspm',
  registries: {
    github: {
      handler: 'jspm-github',
      remote: 'https://github.jspm.io'
    },
    npm: {
      handler: 'jspm-npm',
      remote: 'https://npm.jspm.io'
    },
    jspm: {
      handler: 'jspm-registry',
      remote: 'https://registry.jspm.io'
    }
  }
});

// config upgrade paths
// NB can deprecate with jspm < 10
if (exports.config.github) {
  dprepend(exports.config.registries.github, exports.config.github);
  delete exports.config.github;
}
save();

exports.set = function(name, val) {
  var nameParts = name.split('.');

  var config = exports.config;
  var part;
  while (nameParts.length > 1) {
    part = nameParts.shift();
    config[part] = typeof config[part] === 'object' ? config[part] : {};
    config = config[part];
  }
  if (val) {
    config[nameParts[0]] = val;
  }
  else {
    // If no value is specified, then remove property from config
    delete config[nameParts[0]];
  }

  save();
};
