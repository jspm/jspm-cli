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
var fs = require('graceful-fs');
var path = require('path');
var config = require('./config');
var globalConfig = require('./global-config');
var ui = require('./ui');
var dextend = require('./common').dextend;
var hasProperties = require('./common').hasProperties;
var Promise = require('rsvp').Promise;

/*
  Registry API
  See https://github.com/jspm/jspm-cli/wiki/Registry-API for the spec
*/
var registryClasses = {};

process.on('exit', function() {
  // dispose all loaded registries
  // allows for saving cache state using sync fs
  for (var e in registryClasses) {
    if (registryClasses[e].dispose)
      registryClasses[e].dispose();
  }
});

var registryHooks = ['locate', 'lookup', 'download', 'getPackageConfig', 'processPackageConfig', 'build', 'getOverride'];

exports.load = function(registry) {
  // add local as an registry if not existing, this way only created when used
  if (registry === 'local' && !globalConfig.config.registries.local) {
    globalConfig.config.registries.local = {};
    globalConfig.save();
  }
  if (registryClasses[registry])
    return registryClasses[registry];

  try {
    // ensure the tmpDir exists
    var tmpDir = path.resolve(config.HOME, '.jspm', registry + '-cache');
    if (!fs.existsSync(tmpDir))
      fs.mkdirSync(tmpDir);

    var options = dextend({
      timeouts: {
        lookups: 60,
        download: 300,
        build: 120
      },
      tmpDir: tmpDir,
      apiVersion: '1.0'
    }, globalConfig.config.registries[registry] || {});

    options.name = registry;

    if (!options.handler)
      throw 'Registry %' + registry + '% not found.';

    var RegistryClass = require(options.handler);
    var registryPackageJSON = require(options.handler + '/package.json');
    var versionString = registryPackageJSON.name + '@' + registryPackageJSON.version.split('.').splice(0, 2).join('.');
    options.versionString = versionString;

    var registryInstance = registryClasses[registry] = new RegistryClass(options, ui);
    registryInstance.constructor = RegistryClass;

    var timeoutLookups = options.timeouts.lookups * 1000;
    var timeoutDownload = options.timeouts.download * 1000;
    var timeoutBuild = options.timeouts.build * 1000;

    // allow options to have been mutated by constructor
    if (options.timeouts.lookups === 30)
      delete options.timeouts.lookups;
    if (options.timeouts.download === 300)
      delete options.timeouts.download;
    if (options.timeouts.build === 300)
      delete options.timeouts.build;
    if (!hasProperties(options.timeouts))
      delete options.timeouts;
    delete options.tmpDir;
    delete options.apiVersion;
    delete options.versionString;
    delete options.name;
    globalConfig.config.registries[registry] = options;
    globalConfig.save();

    registryInstance.versionString = registryInstance.versionString || versionString;

    var maxRetries = globalConfig.config.maxRetries || 3;

    // patch the calls to apply timeout and retry logic
    registryHooks.forEach(function(hook) {
      if (!registryInstance[hook])
        return;

      var runHook = registryInstance[hook];
      registryInstance[hook] = function() {
        var self = this;
        var args = arguments;
        var retries = 0;
        var timeout;
        if (hook === 'download')
          timeout = timeoutDownload;
        else if (hook === 'build')
          timeout = timeoutBuild;
        else
          timeout = timeoutLookups;

        return new Promise(function(resolve, reject) {

          function tryHook() {
            var active = true;

            var timer = setTimeout(function() {
              active = false;
              checkRetry();
            }, timeout);
            
            Promise.resolve()
            .then(function() {
              return runHook.apply(self, args);
            })
            .then(function(result) {
              clearTimeout(timer);
              if (active)
                resolve(result);
            }, function(err) {
              clearTimeout(timer);
              if (!active)
                return;
              active = false;
              checkRetry(err);
            });
          }

          function checkRetry(err) {
            // don't retry build or processPackageConfig
            if (hook === 'build' || hook === 'processPackageConfig')
              retries = maxRetries;
            retries++;
            ui.log('warn', (err ? 'Error' : 'Timed out') + ' on ' + hook +
               (typeof args[0] === 'string' ? ' for `' + registry + ':' + args[0] + '`' : '') +
               (retries <= maxRetries ? ', retrying (' + retries + ').' : '') +
               (err ? '\n' + (err.stack || err) : ''));
            if (retries <= maxRetries)
              return tryHook();
            else
              return reject();
          }

          tryHook();
        });
      };
    });

    return registryInstance;
  }
  catch(e) {
    ui.log('err', e.stack || e);
    throw 'Unable to load registry %' + registry + '%';
  }
};

exports.configure = function(registry) {
  var registryConfig = globalConfig.config.registries[registry] || {},
      RegistryClass;

  if (!registryConfig.handler)
    throw 'Registry %' + registry + '% not found.';

  var handler = registryConfig.handler;
  delete registryConfig.handler;

  try {
    RegistryClass = require(handler);
  }
  catch(e) {
    throw 'Registry handler`' + handler + '` not installed.';
  }

  registryConfig.name = registry;
  return Promise.resolve(RegistryClass.configure && RegistryClass.configure(registryConfig, ui) || registryConfig)
  .then(function(_config) {
    delete _config.name;
    _config.handler = handler;
    globalConfig.config.registries[registry] = _config;
  })
  .then(function() {
    globalConfig.save();
  });
};

// jspm registry create mycompany jspm-github
// creates a custom registry based on the given handler
exports.create = function(name, handler, override) {

  // handle override prompts etc
  if (!override && globalConfig.config.registries[name]) {
    if (globalConfig.config.registries[name].handler === handler)
      return ui.confirm('Registry %' + name + '% already exists. Do you want to reconfigure it now?')
      .then(function(configure) {
        if (configure)
          return Promise.resolve(exports.configure(name))
          .then(function() {
            ui.log('ok', 'Registry %' + name + '% configured successfully.');
            return false;
          });
        else
          return false;
      });
    else
      return ui.confirm('Registry %' + name + '% already exists, but based on `' + globalConfig.config.registries[name].handler + '`. Are you sure you want to override it?')
      .then(function(override) {
        if (override)
          return Promise.resolve(exports.create(name, handler, true));
        return false;
      });
  }

  var registryConfig = globalConfig.config.registries[name] = globalConfig.config.registries[name] || {};
  registryConfig.handler = handler;

  // load the registry and configure it
  return exports.configure(name);
};
