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
  if (registryClasses[registry])
    return registryClasses[registry];

  try {
    // ensure the tmpDir exists
    var tmpDir = path.resolve(config.HOME, '.jspm', registry + '-cache');
    if (!fs.existsSync(tmpDir))
      fs.mkdirSync(tmpDir);

    var options = dextend({
      timeouts: {
        lookup: 60,
        download: 300,
        build: 120
      },
      tmpDir: tmpDir,
      apiVersion: '1.6'
    }, globalConfig.config.registries[registry] || {});

    options.name = registry;
    if (globalConfig.config.strictSSL === false || globalConfig.config.strictSSL == 'false')
      options.strictSSL = false;

    if (!options.handler)
      throw 'Registry %' + registry + '% not found.';

    var RegistryClass = require(options.handler);
    var registryPackageJSON = require(options.handler + '/package.json');
    var versionString = registryPackageJSON.name + '@' + registryPackageJSON.version.split('.').splice(0, 2).join('.');
    options.versionString = versionString;

    var registryInstance = registryClasses[registry] = new RegistryClass(options, ui);
    registryInstance.constructor = RegistryClass;

    var timeoutLookup = options.timeouts.lookup * 1000;
    var timeoutDownload = options.timeouts.download * 1000;
    var timeoutBuild = options.timeouts.build * 1000;

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
        if (hook == 'download')
          timeout = timeoutDownload;
        else if (hook == 'build')
          timeout = timeoutBuild;
        else
          timeout = timeoutLookup;

        return new Promise(function(resolve, reject) {

          function tryHook() {
            var active = true;

            var timer = setTimeout(function() {
              active = false;
              checkRetry();
            }, timeout);

            // in case registry is being reconfigured, chain on a promise
            // which delivers the registry to use, when it is ready
            (self.reconfigPromise_ || Promise.resolve(self))
            .then(function(endpoint) {
              self = endpoint;
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
              return checkConfigure(err) || checkRetry(err);
            });
          }

          /* When err.config is set, that indicates config credentials are somehow the cause.
           * Call the configure hook and reinstantiate the registry with new config */
          function checkConfigure(err) {
            if (err && err.config && !self.triedConfig) {
              // Place promise chain on existing instance, to block subsequent hooks.
              // Also print warning for only for first such error, if multiple in a batch
              if (!self.reconfigPromise_) {
                ui.log('warn', err.message);

                self.reconfigPromise_ = exports.configure(registry)
                .then(function() {
                  // replace registered instance
                  delete registryClasses[registry];
                  var instance = exports.load(registry);
                  instance.triedConfig = true;
                  return instance;
                });
              }

              tryHook();
              return true;
            }
          }

          function checkRetry(err) {
            // don't retry build or processPackageConfig
            if (hook === 'build' || hook === 'processPackageConfig')
              retries = maxRetries;

            retries++;
            var retriable = !err || err.retriable;
            var retry = retriable && retries <= maxRetries;

            var msg = (err ? 'Error' : 'Timed out') + ' on ' + hook +
               (typeof args[0] === 'string' ? ' for `' + registry + ':' + args[0] + '`' : '') +
               (retry ? ', retrying (' + retries + ').' : '') +

               (!err ? '\nTo increase the timeout run %jspm config registries.' + registry + '.timeouts.' + (hook == 'download' || hook == 'build' ? hook : 'lookup') + ' ' + timeout / 1000 * 2 + '%' : '') +
               (err ? '\n' + (!err.hideStack && err.stack || err) : '');
            ui.log('warn', msg);
            if (retry)
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
    ui.log('err', !e.hideStack && e.stack || e);
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
    throw 'Registry handler `' + handler + '` not installed.';
  }

  registryConfig.name = registry;
  registryConfig.strictSSL = globalConfig.config.strictSSL;

  return Promise.resolve(RegistryClass.configure && RegistryClass.configure(registryConfig, ui) || registryConfig)
  .then(function(_config) {
    delete _config.name;
    delete _config.strictSSL;
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
