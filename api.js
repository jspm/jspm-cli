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

var install = require('./lib/install');
var bundle = require('./lib/bundle');
var core = require('./lib/core');
var ui = require('./lib/ui');
var EventEmitter = require('events').EventEmitter;
var System = require('systemjs');
var config = require('./lib/config');
var path = require('path');
var Promise = require('rsvp').Promise;
var Builder = require('systemjs-builder');

require('rsvp').on('error', function(reason) {
  ui.log('warn', 'Unhandled promise rejection.\n' + reason && reason.stack || reason || '' + '\n');
});

var API = module.exports = new EventEmitter();

API.setPackagePath = function(packagePath) {
  process.env.jspmConfigPath = path.resolve(packagePath, 'package.json');
};

API.setPackagePath('.');

API.normalize = function(name, parentName) {
  return API.configureLoader()
  .then(function(System) {
    return System.normalize(name, parentName);
  });
};

API.locate = function(name, parentName) {
  return API.normalize(name, parentName)
  .then(function(normalized) {
    return System.locate({ name: normalized, metadata: {} });
  })
  .then(function(address) {
    return address.substr(5);
  });
};

/*
 * jspm.on('log', function(type, msg) { console.log(msg); });
 * jspm.on('prompt', function(prompt, callback) {
 *   if (prompt.type == 'confirm')
 *     callback({ confirm: true });
 *   if (prompt.type == 'input')
 *     callback({ input: value });
 * });
 *
 * Prompt as defined in https://github.com/SBoudrias/Inquirer.js/tree/master#question
 * Callback answer defined in https://github.com/SBoudrias/Inquirer.js/tree/master#answers
 */
ui.setResolver(API);
ui.useDefaults();

API.promptDefaults = function(_useDefaults) {
  ui.useDefaults(_useDefaults);
};

/*
 * Installs a library in the current folder
 * returns a promise
 *
 * jspm.install('jquery')
 * jspm.install('jquery', 'github:components/jquery@^2.0.0')
 * jspm.install('jquery', '2')
 * jspm.install('jquery', 'github:components/jquery')
 * jspm.install('jquery', { force: true });
 * jspm.install({ jquery: '1.2.3' }, { force: true })
 * jspm.install(true, options) // install from package.json
 *
 */
API.install = function(name, target, options) {
  return install.install(name, target, options);
};

/* Uninstalls a library in the current folder.
 * returns a promise
 *
 * jspm.uninstall('jquery')
 * jspm.uninstall(['jquery', 'handlebars'])
 *
 */
API.uninstall = function(names) {
  return install.uninstall(names);
};

API.import = function(moduleName, parentName) {
  return API.configureLoader()
  .then(function() {
    return System.import(moduleName, { name: parentName });
  });
};

// takes an optional config argument to configure
// returns the loader instance
var loaderConfigured = false;
API.configureLoader = function(cfg) {
  return Promise.resolve()
  .then(function() {
    if (loaderConfigured)
      return Promise.resolve(System);

    return config.load()
    .then(function() {
      var cfg = config.loader.getConfig();
      cfg.baseURL = 'file:' + config.pjson.baseURL;
      System.config(cfg);
      loaderConfigured = true;
    });
  })
  .then(function() {
    if (cfg)
      System.config(cfg);
    return System;
  });
};


/*
 * Returns a promise for the full install tree of some form?
 */
// API.installed = function() {
// }

// options.inject
// options.sourceMaps
// options.minify
API.bundle = function(expression, fileName, options) {
  return bundle.bundle(expression, fileName, options);
};

/*
 * Creates a distributable script file that can be used entirely on its own independent of SystemJS and jspm.
 * returns a promise
 * options.minify, options.sourceMaps
 */
API.bundleSFX = function(expression, fileName, options) {
  return bundle.bundleSFX(expression, fileName, options);
};

API.dlLoader = function(transpiler) {
  return core.checkDlLoader(transpiler);
};

/*
 * Returns a jspm-configured SystemJS Builder class
 */
API.Builder = function(_config) {
  config.loadSync();

  var cfg = config.loader.getConfig();
  cfg.baseURL = 'file:' + config.pjson.baseURL;

  var systemBuilder = new Builder(cfg);

  if (_config)
    systemBuilder.config(_config);

  return systemBuilder;
};
API.Builder.prototype = Object.create(Builder.prototype);
