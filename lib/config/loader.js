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

var endpoint = require('../endpoint');
var config = require('../config');
var extend = require('../common').extend;
var hasProperties = require('../common').hasProperties;
var fs = require('graceful-fs');
var asp = require('rsvp').denodeify;
var path = require('path');
var PackageName = require('./package-name');
var alphabetize = require('../common').alphabetize;
var ui = require('../ui');

/*
 * Loader Configuration Class
 *
 * baseURL
 * endpoints
 * app
 * transpiler
 *
 * paths
 * bundles
 * depCache
 *
 * baseMap
 * depMap
 * versions
 *
 */
// and endpoint is a path rule ending in ':*'
var endpointRegEx = /\:\*$/;
function Config(fileName) {
  this.fileName_ = fileName;
}
Config.prototype.read = function(prompts) {
  if (this.read_)
    throw "Config already read";
  this.read_ = true;

  var self = this;
  return asp(fs.readFile)(this.fileName_)
  .catch(function() {
    return '';
  })
  .then(function(source) {
    var cfg = {};
    var System = {
      config: function(_cfg) {
        for (var c in _cfg) {
          var v = _cfg[c];
          if (typeof v == 'object') {
            cfg[c] = cfg[c] || {};
            for (var p in v)
              cfg[c][p] = v[p];
          }
          else
            cfg[c] = v;
        }
      },
      paths: {},
      map: {},
      versions: {}
    };
    eval(source.toString());

    // allow declarative form too
    var config = System.config;
    delete System.config;
    config(System);

    return cfg;
  })
  .then(function(cfg) {
    self.originalConfig_ = cfg;

    self.baseURL = cfg.baseURL;

    // NB deprecate cfg.parser with 0.11.0
    self.transpiler = cfg.transpiler || cfg.parser || 'traceur';

    // separate paths into endpoints and paths
    self.endpoints = {};
    self.paths = {};
    for (var p in cfg.paths) {
      if (p.match(endpointRegEx)) {
        var endpointName = p.substr(0, p.length - 2);
        var endpointPath = new EndpointPath(endpointName, cfg.paths[p]);
        self.endpoints[endpointName] = endpointPath;
        if (self.local === undefined) {
          if (endpointPath.mode == 'local')
            self.local = true;
          else
            self.local = false;
        }
      }
      else {
        self.paths[p] = cfg.paths[p];
      }
    }
    // create a structured configuration for the application path if present
    self.app = new PathName();
    self.app.setPath(config.pjson.lib);
    var appPath = config.pjson.name + '/*';
    if (!self.paths[appPath] || self.paths[appPath] != self.app.path)
      ui.log(!self.paths[appPath] ? 'ok' : 'warn', 'The %' + appPath + '% path has been set to `' + self.app.path + '`.\n'
        + 'To alter this path, set the %directories.lib% in the package.json or run %jspm init -p% to set the code folder.\n');

    self.paths = cfg.paths;

    self.shim = cfg.shim;
    self.bundles = cfg.bundles;
    self.depCache = cfg.depCache;

    // separate map into baseMap and depMap
    self.baseMap = {};
    self.depMap = {};
    for (var d in cfg.map) {
      if (typeof cfg.map[d] == 'string')
        self.baseMap[d] = new PackageName(cfg.map[d]);
      else {
        var depMap = cfg.map[d];
        self.depMap[d] = {};
        for (var m in depMap)
          self.depMap[d][m] = new PackageName(depMap[m]);
      }
    }

    // ensure that everything in baseMap has a depMap, even if empty
    for (var d in self.baseMap) {
      var name = self.baseMap[d].exactName;
      var depMap = self.depMap[name] = self.depMap[name] || {};
    }

    self.versions = self.versions || {};
    for (var v in cfg.versions) {
      if (typeof cfg.versions[v] == 'string')
        self.versions[v] = [cfg.versions[v]]
      else
        self.versions[v] = cfg.versions[v];
    }

    if (hasProperties(self.versions))
      upgradeToExactVersionResolution(self);

  })
  .then(function() {
    if (!prompts)
      return;

    return ui.input('Enter client baseURL (public folder URL)', self.baseURL || '/')
    .then(function(baseURL) {
      self.baseURL = baseURL;

      return ui.input('Which ES6 transpiler would you like to use, %Traceur% or %6to5%?', self.transpiler);
    })
    .then(function(transpiler) {
      if (transpiler !== '6to5')
        transpiler = 'traceur';
      self.transpiler = transpiler;
    });
  });
}

Config.prototype.ensureEndpoint = function(endpointName, remote) {
  if (typeof remote == 'undefined') {
    // detect the endpoint mode from the first endpoint
    remote = false;
    for (var e in this.endpoints) {
      if (this.endpoints[e].mode == 'remote')
        remote = true;
      break;
    }
  }

  if (this.endpoints[endpointName]) {
    if (remote)
      this.endpoints[endpointName].setRemote();
    else
      this.endpoints[endpointName].setLocal();
    return;
  }

  var ep = this.endpoints[endpointName] = new EndpointPath(endpointName);
  if (remote)
    ep.setRemote();
  else
    ep.setLocal();
}

// return the loader configuration for a server loading use
Config.prototype.getConfig = function() {
  var cfg = extend({}, this.originalConfig_);

  // set all endpoint paths to be local paths
  cfg.paths = extend({}, cfg.paths);
  for (var e in this.endpoints)
    cfg.paths[e + ':*'] = this.endpoints[e].local;

  return cfg;
}

/*
 * PathName object, can be empty
 *
 * represents paths['app/*'] = 'lib/*.js';
 */
function PathName(path) {
  this.path = path;
}
PathName.prototype.setPath = function(_path) {
  var relPath = path.relative(config.pjson.baseURL, _path).replace(/\\/g, '/');
  if (relPath)
    this.path = relPath + '/*.js';
  else
    this.path = '*.js';
}
PathName.prototype.write = function() {
  return this.path;
}

/*
 * EndpointPath object
 */
var jspmPackages;
function EndpointPath(name, endpointPath) {
  jspmPackages = jspmPackages || path.relative(config.pjson.baseURL, config.pjson.packages);
  var endpointRemote = endpoint.load(name).remote;
  this.remote = endpointRemote + '/*.js';
  this.local = jspmPackages + '/' + name + '/*.js';

  this.mode = 'local';
  if (endpointPath == this.remote)
    this.mode = 'remote';
  this.path = endpointPath;
}
EndpointPath.prototype.setLocal = function() {
  this.path = this.local;
  this.mode = 'local';
}
EndpointPath.prototype.setRemote = function() {
  this.path = this.remote;
  this.mode = 'remote';
}
EndpointPath.prototype.write = function() {
  return this.path;
}

// convert structured configuration into a plain object
// by calling the .write() methods of structured classes
// properties ending in _ are considered private
// NB may be less convoluted just to make these explicit
function extractObj(obj, host) {
  var out = {};
  for (var p in obj) {
    if (!obj.hasOwnProperty(p))
      continue;
    if (p.substr(p.length - 1, 1) ==  '_')
      continue;

    var val = obj[p], writeValue;
    if (typeof val == 'string')
      out[p] = val;
    else if (typeof val == 'object') {
      if (typeof val.write == 'function')
        out[p] = val.write();
      else if (val instanceof Array)
        out[p] = val;
      else
        out[p] = extractObj(val, {});
    }
  }
  for (var p in host)
    if (!(p in out))
      out[p] = host[p];
  return out;
}

Config.prototype.write = function() {
  // extract over original config to keep initial values
  var cfg = extractObj(this, this.originalConfig_);

  // allow * path to be overridden
  if (!cfg.paths['*'])
    cfg.paths['*'] = '*.js';

  if (cfg.app)
    cfg.paths[config.pjson.name + '/*'] = cfg.app;
  delete cfg.app;

  for (var e in cfg.endpoints) {
    var val = cfg.endpoints[e];
    delete cfg.endpoints[e];
    cfg.endpoints[e + ':*'] = val;
  }

  extend(cfg.paths, alphabetize(cfg.endpoints));
  delete cfg.endpoints;

  cfg.baseMap = alphabetize(cfg.baseMap);
  cfg.map = extend(cfg.baseMap, alphabetize(cfg.depMap));
  delete cfg.baseMap;
  delete cfg.depMap;

  for (var p in cfg.map) {
    var subMap = cfg.map[p];
    if (typeof subMap == 'object') {
      if (!hasProperties(subMap))
        delete cfg.map[p];
      else
        cfg.map[p] = alphabetize(cfg.map[p]);
    }
  }

  for (var v in cfg.versions) {
    var version = cfg.versions[v];
    if (version.length == 1)
      cfg.versions[v] = version[0];
    if (version.length == 0)
      delete cfg.versions[v];
  }

  var configContent = '';

  var meta = cfg.meta;
  var depCache = cfg.depCache;
  var map = cfg.map;
  var versions = alphabetize(cfg.versions);

  delete cfg.meta;
  delete cfg.depCache;
  delete cfg.map;
  delete cfg.versions;

  if (cfg.transpiler == 'traceur')
    delete cfg.transpiler;

  if (cfg.bundles && !hasProperties(cfg.bundles))
    delete cfg.bundles;

  if (hasProperties(cfg))
    configContent += 'System.config(' + JSON.stringify(cfg, null, 2) + ');\n\n';

  cfg.meta = meta;
  cfg.depCache = depCache;
  cfg.map = map;
  cfg.versions = versions;

  if (hasProperties(meta))
    configContent += 'System.config(' + JSON.stringify({ meta: meta }, null, 2) + ');\n\n';

  if (hasProperties(depCache))
    configContent += 'System.config(' + JSON.stringify({ depCache: depCache }, null, 2) + ');\n\n';

  if (hasProperties(map))
    configContent += 'System.config(' + JSON.stringify({ map: map }, null, 2) + ');\n\n';

  if (hasProperties(versions))
    configContent += 'System.config(' + JSON.stringify({ versions: versions }, null, 2) + ');\n\n';

  return asp(fs.writeFile)(this.fileName_, configContent);
}
module.exports = Config;




// --- can be removed after jspm@0.8 is fully deprecated --
var semver = require('../semver');
function upgradeToExactVersionResolution(config) {
  // run through depMap and baseMap, and assign exact version matches
  Object.keys(config.baseMap).forEach(function(p) {
    upgradeToExactVersionResolveRange(config.baseMap[p], config);
  });

  Object.keys(config.depMap).forEach(function(p) {
    var curMap = config.depMap[p];
    Object.keys(curMap).forEach(function(p) {
      upgradeToExactVersionResolveRange(curMap[p], config);
    });
  });

  config.versions = {};
}
function upgradeToExactVersionResolveRange(range, config) {
  var versions = config.versions[range.name];
  if (versions)
  versions.sort(semver.compare).reverse().some(function(version) {
    if (semver.match(range.version, version)) {
      range.setVersion(version);
      return true;
    }
  });
}