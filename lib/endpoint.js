/*
 *   Copyright 2014 Guy Bedford (http://guybedford.com)
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
var ui = require('./ui');

function extend(a, b) {
  for (var p in b)
    a[p] = b[p];
  return a;
}

/*
  Endpoint API

  CONSTRUCTOR
    new Endpoint(options, ui)

    options.timeout
    options.tmpDir

    Any other options as set by config

  METHODS
    parse (name) 
      -> { package, path }
    lookup (packageName)
      -> { notfound: true } / { redirect: 'new:package' } / { versions: {...} }
    download (packageName, version, hash, dir)
      -> Promise pjson
    getPackageConfig (packageName, version, hash), optional
      -> Promise pjson
    build (pjson, dir), optional
      -> pjson (optional)

  STATICS
    configure (config, ui), optional
      -> Promise for config, expects "name"
  
  PROPERTIES
    remote, optional
      -> remote URL used for jspm setmode remote and injectino

  User-Configuration
    jspm endpoint create jspm-myspecial-endpoint [name]
    jspm endpoint configure github
    jspm config endpoints.github.remote https://custom-remote
*/
var endpointClasses = {};
exports.load = function(endpoint) {
  if (endpointClasses[endpoint])
    return endpointClasses[endpoint];

  try {
    // ensure the tmpDir exists
    var tmpDir = path.resolve(config.HOME, '.jspm', 'tmp-' + endpoint);
    if (!fs.existsSync(tmpDir))
      fs.mkdirSync(tmpDir);

    var options = {
      timeout: 120, 
      tmpDir: tmpDir
    };
    extend(options, config.globalConfig.endpoints[endpoint] || {});

    options.name = endpoint;

    if (!options.handler)
      throw 'Endpoint not found.';

    var endpointClass = require(options.handler);

    return endpointClasses[endpoint] = new endpointClass(options, ui);
  }
  catch(e) {
    ui.log('err', e.stack || e);
    throw 'Unable to load endpoint %' + endpoint + '%';
  }
}

exports.configure = function(endpoint) {
  var endpointConfig = config.globalConfig.endpoints[endpoint] || {};
  if (!endpointConfig.handler)
    throw 'Endpoint %' + endpoint + '% not found.';

  var handler = endpointConfig.handler;
  delete endpointConfig.handler;

  try {
    var endpointClass = require(handler);
  }
  catch(e) {
    throw 'Endpoint handler `' + handler + '` not installed.';
  }

  endpointConfig.name = endpoint;
  return Promise.resolve(endpointClass.configure && endpointClass.configure(endpointConfig, ui) || endpointConfig)
  .then(function(_config) {
    delete _config.name;
    _config.handler = handler;
    config.globalConfig.endpoints[endpoint] = _config;
  })
  .then(function() {
    config.saveGlobalConfig();
  });
}

// jspm endpoint create mycompany jspm-github
// creates a custom endpoint based on the given handler
exports.create = function(name, handler, override) {

  // handle override prompts etc
  if (!override && config.globalConfig.endpoints[name]) {
    if (config.globalConfig.endpoints[name].handler == handler)
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
      return ui.confirm('Endpoint %' + name + '% already exists, but based on `' + handler + '`. Are you sure you want to override it?')
      .then(function(override) {
        if (override)
          return Promise.resolve(exports.create(name, handler, true));
        return false;
      });
  }

  var endpointConfig = config.globalConfig.endpoints[name] = config.globalConfig.endpoints[name] || {};
  endpointConfig.handler = handler;

  // load the endpoint and configure it
  return exports.configure(name);
}