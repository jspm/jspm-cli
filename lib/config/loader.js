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
var stringify = require('../common').stringify;
var ui = require('../ui');
var extractObj = require('./utils').extractObj;

/*
 * Loader Configuration Class
 *
 * baseURL
 * endpoints
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
  this.__fileName = fileName;
}
Config.prototype.read = function(prompts) {
  if (this.__read)
    throw 'Config already read';
  this.__read = true;

  var self = this;
  return asp(fs.readFile)(this.__fileName)
  .catch(function() {
    return '';
  })
  .then(function(source) {
    var cfg = {};
    var System = {
      config: function(_cfg) {
        for (var c in _cfg) {
          if (!_cfg.hasOwnProperty(c))
            continue;

          var v = _cfg[c];
          if (typeof v === 'object') {
            cfg[c] = cfg[c] || {};
            for (var p in v) {
              if (!v.hasOwnProperty(p))
                continue;
              cfg[c][p] = v[p];
            }
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
    self.__originalConfig = cfg;

    self.baseURL = cfg.baseURL;

    // NB deprecate cfg.parser with 0.11.0
    self.transpiler = cfg.transpiler || cfg.parser || 'traceur';
    // NB deprecate babel rename with 0.13
    if (self.transpiler === '6to5')
      self.transpiler = 'babel';

    // separate paths into endpoints and paths
    self.endpoints = {};
    self.paths = {};
    for (var p in cfg.paths) {
      if (p.match(endpointRegEx)) {
        var endpointName = p.substr(0, p.length - 2);
        var endpointPath = new EndpointPath(endpointName, cfg.paths[p]);
        self.endpoints[endpointName] = endpointPath;
        if (self.local === undefined) {
          if (endpointPath.mode === 'local')
            self.local = true;
          else
            self.local = false;
        }
      }
      else {
        self.paths[p] = cfg.paths[p];
      }
    }

    self.paths = cfg.paths;

    self.shim = cfg.shim;
    self.bundles = cfg.bundles;
    self.depCache = cfg.depCache;

    // separate map into baseMap and depMap
    self.baseMap = {};
    self.depMap = {};
    for (var d in cfg.map) {
      if (typeof cfg.map[d] === 'string')
        self.baseMap[d] = new PackageName(cfg.map[d]);
      else {
        var depMap = cfg.map[d];
        self.depMap[d] = {};
        for (var m in depMap)
          if (depMap.hasOwnProperty(m)) {
            self.depMap[d][m] = new PackageName(depMap[m]);
          }
      }
    }

    // ensure that everything in baseMap has a depMap, even if empty
    var baseMap = self.baseMap, exactName;
    for (var n in baseMap) {
      if (baseMap.hasOwnProperty(n)) {
        exactName = baseMap[n].exactName;
        self.depMap[exactName] = self.depMap[exactName] || {};
      }
    }

    self.versions = self.versions || {};
    for (var v in cfg.versions) {
      if (typeof cfg.versions[v] === 'string')
        self.versions[v] = [cfg.versions[v]];
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

      return ui.input('Which ES6 transpiler would you like to use, %Traceur% or %Babel%?', self.transpiler);
    })
    .then(function(transpiler) {
      transpiler = transpiler.toLowerCase();
      if (transpiler !== 'babel')
        transpiler = 'traceur';
      self.transpiler = transpiler;
    });
  });
};

Config.prototype.ensureEndpoint = function(endpointName, remote) {
  var endpoints = this.endpoints;

  if (typeof remote === 'undefined') {
    // detect the endpoint mode from the first endpoint
    var endpointKeys = Object.keys(endpoints);
    if (endpointKeys.length > 0) {
      remote = endpoints[endpointKeys[0]].mode === 'remote';
    } else {
      remote = false;
    }
  }

  if (endpoints[endpointName]) {
    if (remote)
      endpoints[endpointName].setRemote();
    else
      endpoints[endpointName].setLocal();
    return;
  }

  var ep = endpoints[endpointName] = new EndpointPath(endpointName);
  if (remote)
    ep.setRemote();
  else
    ep.setLocal();
};

// return the loader configuration for a server loading use
Config.prototype.getConfig = function() {
  var cfg = extend({}, this.__originalConfig);

  // set all endpoint paths to be local paths
  cfg.paths = extend({}, cfg.paths);
  var endpoints = this.endpoints;
  for (var e in endpoints) {
    if (endpoints.hasOwnProperty(e))
      cfg.paths[e + ':*'] = endpoints[e].local;
  }
  return cfg;
};

/*
 * EndpointPath object
 */
var jspmPackages;
function EndpointPath(name, endpointPath) {
  jspmPackages = jspmPackages || path.relative(config.pjson.baseURL, config.pjson.packages).replace(/\\/g, '/');
  var endpointRemote = endpoint.load(name).remote;
  this.remote = endpointRemote + '/*.js';
  this.local = jspmPackages + '/' + name + '/*.js';

  this.mode = 'local';
  if (endpointPath === this.remote)
    this.mode = 'remote';
  this.path = endpointPath;
}
EndpointPath.prototype.setLocal = function() {
  this.path = this.local;
  this.mode = 'local';
};
EndpointPath.prototype.setRemote = function() {
  this.path = this.remote;
  this.mode = 'remote';
};
EndpointPath.prototype.write = function() {
  return this.path;
};

Config.prototype.write = function() {
  // extract over original config to keep initial values
  var cfg = extractObj(this, this.__originalConfig),
      cfgEndpoints, cfgMap, cfgVersions;

  // allow * path to be overridden
  if (!cfg.paths['*'])
    cfg.paths['*'] = '*.js';

  cfgEndpoints = cfg.endpoints;
  for (var e in cfgEndpoints) {
    if (!cfgEndpoints.hasOwnProperty(e))
      continue;
    var val = cfgEndpoints[e];
    delete cfgEndpoints[e];
    cfgEndpoints[e + ':*'] = val;
  }

  extend(cfg.paths, alphabetize(cfg.endpoints));
  delete cfg.endpoints;

  cfg.baseMap = alphabetize(cfg.baseMap);
  cfg.map = extend(cfg.baseMap, alphabetize(cfg.depMap));
  delete cfg.baseMap;
  delete cfg.depMap;

  cfgMap = cfg.map;
  for (var p in cfgMap) {
    if (!cfgMap.hasOwnProperty(p))
      continue;
    var subMap = cfgMap[p];
    if (typeof subMap === 'object') {
      if (!hasProperties(subMap))
        delete cfgMap[p];
      else
        cfgMap[p] = alphabetize(cfgMap[p]);
    }
  }

  cfgVersions = cfg.versions;
  for (var v in cfgVersions) {
    if (!cfgVersions.hasOwnProperty(v))
      continue;
    var version = cfgVersions[v];
    if (version.length === 1)
      cfgVersions[v] = version[0];
    if (version.length === 0)
      delete cfgVersions[v];
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

  if (cfg.transpiler === 'traceur')
    delete cfg.transpiler;

  if (cfg.bundles && !hasProperties(cfg.bundles))
    delete cfg.bundles;

  if (hasProperties(cfg))
    configContent += 'System.config(' + stringify(cfg) + ');' + config.newLine + config.newLine;

  cfg.meta = meta;
  cfg.depCache = depCache;
  cfg.map = map;
  cfg.versions = versions;

  if (hasProperties(meta))
    configContent += 'System.config(' + stringify({ meta: meta }) + ');' + config.newLine + config.newLine;

  if (hasProperties(depCache))
    configContent += 'System.config(' + stringify({ depCache: depCache }) + ');' + config.newLine + config.newLine;

  if (hasProperties(map))
    configContent += 'System.config(' + stringify({ map: map }) + ');' + config.newLine + config.newLine;

  if (hasProperties(versions))
    configContent += 'System.config(' + stringify({ versions: versions }) + ');' + config.newLine + config.newLine;

  return asp(fs.writeFile)(this.__fileName, configContent);
};
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
