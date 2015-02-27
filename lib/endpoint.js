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

process.on('exit', function() {
  // dispose all loaded endpoints
  // allows for saving cache state using sync fs
  for (var e in endpointClasses) {
    if (endpointClasses[e].dispose)
      endpointClasses[e].dispose();
  }
});

var ep = exports;

/*
  Endpoint API
  See https://github.com/jspm/jspm-cli/wiki/Endpoint-API for the spec
*/
var endpointClasses = {
  local: {
    lookup: function() {
      throw 'Local endpoint can only be used for linking. Try %jspm install -l local:...%';
    }
  }
};

var endpointHooks = ['locate', 'lookup', 'download', 'getPackageConfig', 'processPackageConfig', 'build', 'getOverride'];

exports.load = function(endpoint) {
  // add local as an endpoint if not existing, this way only created when used
  if (endpoint == 'local' && !globalConfig.config.endpoints.local) {
    globalConfig.config.endpoints.local = {};
    globalConfig.save();
  }
  if (endpointClasses[endpoint])
    return endpointClasses[endpoint];

  try {
    // ensure the tmpDir exists
    var tmpDir = path.resolve(config.HOME, '.jspm', endpoint + '-cache');
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
    }, globalConfig.config.endpoints[endpoint] || {});

    options.name = endpoint;

    if (!options.handler)
      throw 'Endpoint %' + endpoint + '% not found.';

    var endpointClass = require(options.handler);
    var endpointPackageJSON = require(options.handler + '/package.json');
    var versionString = endpointPackageJSON.name + '@' + endpointPackageJSON.version.split('.').splice(0, 2).join('.');
    options.versionString = versionString;

    var endpointInstance = endpointClasses[endpoint] = new endpointClass(options, ui);
    endpointInstance.constructor = endpointClass;
    
    var timeoutLookups = options.timeouts.lookups * 1000;
    var timeoutDownload = options.timeouts.download * 1000;
    var timeoutBuild = options.timeouts.build * 1000;

    // allow options to have been mutated by constructor
    if (options.timeouts.lookups == 30)
      delete options.timeouts.lookups;
    if (options.timeouts.download == 300)
      delete options.timeouts.download;
    if (options.timeouts.build == 300)
      delete options.timeouts.build;
    if (!hasProperties(options.timeouts))
      delete options.timeouts;
    delete options.tmpDir;
    delete options.apiVersion;
    delete options.versionString;
    delete options.name;
    globalConfig.config.endpoints[endpoint] = options;
    globalConfig.save();

    endpointInstance.versionString = endpointInstance.versionString || versionString;

    var maxRetries = globalConfig.config.maxRetries || 3;

    // patch the calls to apply timeout and retry logic
    endpointHooks.forEach(function(hook) {
      if (!endpointInstance[hook])
        return;

      var runHook = endpointInstance[hook];
      endpointInstance[hook] = function() {
        var self = this;
        var args = arguments;
        var retries = 0;
        var timeout;
        if (hook == 'download')
          timeout = timeoutDownload;
        else if (hook == 'build')
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
            if (hook == 'build' || hook == 'processPackageConfig')
              retries = maxRetries;
            retries++;
            ui.log('warn', (err ? 'Error' : 'Timed out') + ' on ' + hook
               + (typeof args[0] == 'string' ? ' for `' + endpoint + ':' + args[0] + '`' : '') 
               + (retries <= maxRetries ? ', retrying (' + retries + ').' : '')
               + (err ? '\n' + (err.stack || err) : ''));
            if (retries <= maxRetries)
              return tryHook();
            else
              return reject();
          }

          tryHook();
        });
      }
    });

    return endpointInstance;
  }
  catch(e) {
    ui.log('err', e.stack || e);
    throw 'Unable to load endpoint %' + endpoint + '%';
  }
}

exports.configure = function(endpoint) {
  var endpointConfig = globalConfig.config.endpoints[endpoint] || {};

  if (!endpointConfig.handler)
    throw 'Endpoint %' + endpoint + '% not found.';

  var handler = endpointConfig.handler;
  delete endpointConfig.handler;

  try {
    var endpointClass = require(handler);
  }
  catch(e) {
    throw 'Endpoint handler`' + handler + '` not installed.';
  }

  endpointConfig.name = endpoint;
  return Promise.resolve(endpointClass.configure && endpointClass.configure(endpointConfig, ui) || endpointConfig)
  .then(function(_config) {
    delete _config.name;
    _config.handler = handler;
    globalConfig.config.endpoints[endpoint] = _config;
  })
  .then(function() {
    globalConfig.save();
  });
}

// jspm endpoint create mycompany jspm-github
// creates a custom endpoint based on the given handler
exports.create = function(name, handler, override) {

  // handle override prompts etc
  if (!override && globalConfig.config.endpoints[name]) {
    if (globalConfig.config.endpoints[name].handler == handler)
      return ui.confirm('Endpoint %' + name + '% already exists. Do you want to reconfigure it now?')
      .then(function(configure) {
        if (configure)
          return Promise.resolve(exports.configure(name))
          .then(function() {
            ui.log('ok', 'Endpoint %' + name + '% configured successfully.');
            return false;
          });
        else
          return false;
      });
    else
      return ui.confirm('Endpoint %' + name + '% already exists, but based on `' + globalConfig.config.endpoints[name].handler + '`. Are you sure you want to override it?')
      .then(function(override) {
        if (override)
          return Promise.resolve(exports.create(name, handler, true));
        return false;
      });
  }

  var endpointConfig = globalConfig.config.endpoints[name] = globalConfig.config.endpoints[name] || {};
  endpointConfig.handler = handler;

  // load the endpoint and configure it
  return exports.configure(name);
}
