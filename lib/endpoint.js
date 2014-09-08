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
    var tmpDir = path.resolve(process.env.HOME, '.jspm', 'tmp-' + endpoint);
    if (!fs.existsSync(tmpDir))
      fs.mkdirSync(tmpDir);

    var options = {
      timeout: 120, 
      tmpDir: tmpDir
    };
    extend(options, config.globalConfig.endpoints[endpoint] || {});

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

  var endpointClass = require(handler);
  if (!endpointClass.configure)
    return;
  return Promise.resolve(endpointClass.configure(endpointConfig, ui))
  .then(function(_config) {
    _config.handler = handler;
    config.globalConfig.endpoints[endpoint] = _config;
  })
  .then(function() {
    config.saveGlobalConfig();
  });
}

// jspm endpoint create mycompany jspm-github
// creates a custom endpoint based on the given handler
// needs wiring up, but straightforward to do
exports.create = function(endpoint, name) {

}