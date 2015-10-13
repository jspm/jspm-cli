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

var defaultConfig = {
  defaultTranspiler: 'babel',
  defaultRegistry: 'jspm',
  strictSSL: true,
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
};

var config = {
  // default to globalConfigFilePath
  current: 'global',
  global: {
    path: HOME + path.sep + '.jspm' + path.sep + 'config',
    content: {}
  },
  local: {
    path: getLocalConfigPath(),
    content: {}
  }
};

// old windows HOME migration
// can deprecate with jspm 0.15.3
if (process.env.USERPROFILE && HOME !== process.env.USERPROFILE && !fs.existsSync(path.join(HOME, '.jspm')) && fs.existsSync(path.join(process.env.USERPROFILE, '.jspm'))) {
  var OLD_HOME = process.env.USERPROFILE;
  var from = path.join(OLD_HOME, '.jspm');
  var to = path.join(HOME, '.jspm');
  ui.log('info', 'Migrating global jspm folder from `' + from + '` to `' + to + '`...');
  try {
    ui.log('info', 'Copying configuration...');
    var oldConfig = fs.readFileSync(path.resolve(from, 'config'));
    fs.mkdirSync(to);
    fs.writeFileSync(path.resolve(to, 'config'), oldConfig);
    ui.log('ok', 'Migration successful. Note that linked packages will need to be relinked.');
  }
  catch (e) {
    ui.log('err', 'Error migrating to new jspm folder\n' + (e && e.stack || e));
  }
}




if (fs.existsSync(config.global.path)) {
  config.global.content = loadConfigFile(config.global.path);
  exports.globalConfig = config.global.content;
}

// Existance of local config has already been checked in getLocalConfigPath()
if (config.local.path) {
  config.local.content = loadConfigFile(config.local.path);
  exports.localConfig = config.local.content;
  config.current = 'local';
}

exports.config = config[config.current].content;

if ( !exports.config ) {
  exports.config = {};
  if (HOME)
    save(exports.config, isLocal());
}




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
dprepend(exports.config, defaultConfig);

// config upgrade paths
// NB can deprecate with jspm < 10
if (exports.config.github) {
  dprepend(exports.config.registries.github, exports.config.github);
  delete exports.config.github;
}


save(exports.config, isLocal());



function loadConfigFile(configFilePath) {
    var config;
    try {
      config = JSON.parse(fs.readFileSync(configFilePath).toString() || '{}');
    }
    catch(e) {
      config = {};
      ui.log('err', 'Unable to read ' + config.current + ' configuration file.\nEnsure you have read and write access to %' + configFilePath + '%.');
      process.exit(1);
    }

    return config;
}


function getLocalConfigPath() {
    var configDir = process.env.jspmConfigPath.substr(0, process.env.jspmConfigPath.lastIndexOf('/')) || process.cwd();
    var configFilePath;

    if ( fs.existsSync(configDir + path.sep + '.jspmrc') ) {
        configFilePath = configDir + path.sep + '.jspmrc';
    } else if ( fs.existsSync(configDir + path.sep + '.config' + path.sep + '.jspmrc') ) {
        configFilePath = configDir + path.sep + '.config' + path.sep + '.jspmrc';
    }

    return configFilePath;
}

function getDefaultLocalConfigPath() {
    var configDir = process.env.jspmConfigPath.substr(0, process.env.jspmConfigPath.lastIndexOf('/')) || process.cwd();

    return configDir + path.sep + '.jspmrc';
}


function isLocal() {
    return config.current === 'local';
}


exports.save = save;
function save(configToWrite, saveLocal) {
  var place = saveLocal === true ? 'local' : 'global';

  if ( place === 'global' ) {
    try {
      fs.mkdirSync(HOME + path.sep + '.jspm');
    }
    catch(e) {
    if (e.code !== 'EEXIST')
      throw 'Unable to create jspm system folder\n' + e.stack;
    }
  }

  // If the user wants to save options to a local configuration file that is not
  // created, we need to create it and extend it with the default config.
  if ( saveLocal && !config.local.path ) {
    config.local.path = getDefaultLocalConfigPath();
    dprepend(configToWrite, defaultConfig);
  }

  try {
    fs.writeFileSync(config[place].path, JSON.stringify(configToWrite, null, 2));
  }
  catch(e) {
    throw 'Unable to write configuration file\n' + e.stack;
  }
}


exports.set = set;
function set(name, val, setLocal) {
    var nameParts = name.split('.');

    var place = setLocal ? 'local' : 'global';
    var configUpdate = config[place].content;

    var part;
    while (nameParts.length > 1) {
        part = nameParts.shift();
        configUpdate[part] = typeof configUpdate[part] === 'object' ? configUpdate[part] : {};
        configUpdate = configUpdate[part];
    }
    if (val) {
        configUpdate[nameParts[0]] = val;
    }
    else {
        // If no value is specified, then remove property from config
        delete configUpdate[nameParts[0]];
    }

    save(config[place].content, !!setLocal);
}
