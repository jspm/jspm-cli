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

var registry = require('../registry');
var config = require('../config');
var extend = require('../common').extend;
var hasProperties = require('../common').hasProperties;
var fs = require('graceful-fs');
var asp = require('rsvp').denodeify;
var path = require('path');
var PackageName = require('../package-name');
var alphabetize = require('../common').alphabetize;
var stringify = require('../common').stringify;
var ui = require('../ui');
var extractObj = require('./utils').extractObj;

/*
 * Loader configuration class built in base config class
 */

// wip
var ConfigBase = require('./base');


module.exports = LoaderConfig;
function LoaderConfig(fileName) {
  this.file = new LoaderConfigFile(fileName);

  this.baseURL = this.file.get(['jspm', 'baseURL']) || this.file.get(['baseURL']);
}
LoaderConfig.prototype.ensureRegistry = function() {

};
LoaderConfig.prototype.getConfig = function() {

};
LoaderConfig.prototype.prompt = function() {

};
LoaderConfig.prototype.write = function() {
  this.file.setIfExists(['jspm', 'baseURL'], this.baseURL) || this.file.set(['baseURL'], this.baseURL);

  this.file.write();
};

function LoaderConfigFile(fileName) {
  ConfigBase.call(this, fileName);
}
LoaderConfigFile.prototype = Object.create(ConfigBase);
LoaderConfigFile.prototype.serialize = function() {
  // TODO
};
LoaderConfigFile.prototype.deserialize = function() {
  // TODO
};


/*
 * Loader Configuration Class
 *
 * baseURL
 * packageConfigPaths
 * registries
 *
 * paths
 * bundles
 * depCache
 *
 * packages
 * baseMap
 * depMap
 *
 */
// and registry is a path rule ending in ':*'
var registryRegEx = /\:\*$/;
function Config(fileName) {
  this.__fileName = fileName;
}
Config.prototype.read = function(prompts, sync) {
  if (this.__read)
    throw 'Config already read';
  this.__read = true;

  var self = this;
  var source;
  try {
    source = fs.readFileSync(this.__fileName);
  }
  catch(e) {
    source = '';
  }

  var cfg = {};
  var System = {
    config: function(_cfg) {
      for (var c in _cfg) {
        var v = _cfg[c];
        if (typeof v === 'object' && (!(v instanceof Array))) {
          cfg[c] = cfg[c] || {};
          for (var p in v)
            cfg[c][p] = v[p];
        }
        else
          cfg[c] = v;
      }
    },
    paths: {},
    map: {}
  };
  eval(source.toString());

  // allow declarative form too
  var config = System.config;
  delete System.config;
  config(System);

  self.__originalConfig = cfg;

  self.baseURL = cfg.baseURL;

  self.packageConfigPaths = cfg.packageConfigPaths;

  // downgrade back to jsp 0.16 then upgrade can mess packageConfigPaths
  if (!(self.packageConfigPaths instanceof Array)) {
    self.upgrade16 = true;
    self.packageConfigPaths = Object.keys(self.packageConfigPaths || {}).map(function(path) {
      return self.packageConfigPaths[path];
    });
  }

  var m, p;

  // separate paths into registries and paths
  self.registries = {};
  self.paths = {};
  for (p in cfg.paths) {
    if (p.match(registryRegEx)) {
      var registryName = p.substr(0, p.length - 2);
      var registryPath = new RegistryPath(registryName, cfg.paths[p]);
      self.registries[registryName] = registryPath;
      if (self.__local === undefined) {
        if (registryPath.mode === 'local')
          self.__local = true;
        else
          self.__local = false;
      }
    }
    // deprecate *: *.js
    else if (p === '*' && cfg.paths[p] === '*.js') {
      delete cfg.paths[p];
      continue;
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
      for (m in depMap)
        self.depMap[d][m] = new PackageName(depMap[m]);
    }
  }

  // separate packages into packages and depMap
  self.packages = {};
  for (p in cfg.packages) {
    var curPackage = self.packages[p] = cfg.packages[p];

    for (m in curPackage.map) {
      // skip internal maps
      if (m[0] == '.' || curPackage.map[m][0] == '.')
        continue;
      // external maps are then depMap
      self.depMap[p] = self.depMap[p] || {};
      self.depMap[p][m] = new PackageName(curPackage.map[m]);
    }
  }

  // ensure that everything in baseMap has a depMap, even if empty
  var baseMap = self.baseMap, exactName;
  for (var n in baseMap) {
    exactName = baseMap[n].exactName;
    self.depMap[exactName] = self.depMap[exactName] || {};
  }

  if (!prompts)
    return;

  if (sync)
    throw 'Configuration file has not been initialized. Run jspm init first.';

  return initPrompts.call(self);
};

function initPrompts() {
  var self = this;

  return ui.input('Enter client baseURL (public folder URL)', self.baseURL || '/')
  .then(function(baseURL) {
    self.baseURL = baseURL;

    // all package properties get their defaults from the package.json itself
    /* return ui.confirm('Would you like to configure package loader plugins for custom loading and transpilation?', true);
  })
  .then(function(loaderConfig) {
    if (!loaderConfig)
      return;

    ui.log('info', 'TODO!'); */

    /* return ui.confirm('Would you like to use a transpiler for the package?', true)
    .then(function(transpile) {
      // NB disable self.transpiler
      ui.log('info', 'TODO!');
    }); */
  });
}

Config.prototype.ensureRegistry = function(registryName, remote) {
  var registries = this.registries;

  // ensure packageNameFormats are added as packageConfigPaths for SystemJS
  var packageConfigPaths = this.packageConfigPaths;
  var packageNameFormats = registry.load(registryName).constructor.packageNameFormats || ['*'];
  packageNameFormats.forEach(function(packageNameFormat) {
    var packageConfigPath = registryName + ':' + packageNameFormat + '.json';
    if (packageConfigPaths.indexOf(packageConfigPath) == -1)
      packageConfigPaths.push(packageConfigPath);
  });

  if (typeof remote === 'undefined') {
    // detect the registry mode from the first registry
    var registryKeys = Object.keys(registries);
    if (registryKeys.length > 0) {
      remote = registries[registryKeys[0]].mode === 'remote';
    } else {
      remote = false;
    }
  }

  if (registries[registryName]) {
    if (remote)
      registries[registryName].setRemote();
    else
      registries[registryName].setLocal();
    return;
  }

  var ep = registries[registryName] = new RegistryPath(registryName);
  if (remote)
    ep.setRemote();
  else
    ep.setLocal();
};

// return the loader configuration for a server loading use
Config.prototype.getConfig = function() {
  var cfg = extend({}, this.__originalConfig);

  // set all registry paths to be local paths
  cfg.paths = extend({}, cfg.paths);
  var registries = this.registries;
  for (var e in registries)
    cfg.paths[e + ':*'] = registries[e].local;
  return cfg;
};

/*
 * RegistryPath object
 */
var jspmPackages;
function RegistryPath(name, registryPath) {
  jspmPackages = jspmPackages || path.relative(config.pjson.baseURL, config.pjson.packages).replace(/\\/g, '/');
  var registryRemote = registry.load(name).remote;
  this.remote = registryRemote + '/*';
  this.local = jspmPackages + '/' + name + '/*';

  this.mode = 'local';
  if (registryPath === this.remote)
    this.mode = 'remote';
  this.path = registryPath;
}
RegistryPath.prototype.setLocal = function() {
  this.path = this.local;
  this.mode = 'local';
};
RegistryPath.prototype.setRemote = function() {
  this.path = this.remote;
  this.mode = 'remote';
};
RegistryPath.prototype.write = function() {
  return this.path;
};

Config.prototype.write = function() {
  // extract over original config to keep initial values
  var cfg = extractObj(this, this.__originalConfig);

  delete cfg.upgrade16;
  
  var cfgRegistries = cfg.registries;
  for (var e in cfgRegistries) {
    var val = cfgRegistries[e];
    delete cfgRegistries[e];
    cfgRegistries[e + ':*'] = val;
  }

  extend(cfg.paths, alphabetize(cfg.registries));
  delete cfg.registries;

  var map = alphabetize(cfg.baseMap);
  var packages = cfg.packages;
  for (var p in cfg.depMap) {
    packages[p] = packages[p] || {};
    packages[p].map = alphabetize(cfg.depMap[p]);
    if (!hasProperties(packages[p].map))
      delete packages[p].map;
    if (!hasProperties(packages[p]))
      delete packages[p];
  }
  packages = alphabetize(packages);
  delete cfg.baseMap;
  delete cfg.depMap;
  delete cfg.packages;

  var meta = cfg.meta;
  var depCache = cfg.depCache;

  delete cfg.meta;
  delete cfg.depCache;
  delete cfg.map;

  if (cfg.bundles && !hasProperties(cfg.bundles))
    delete cfg.bundles;

  var outConfig = {};

  if (hasProperties(cfg))
    extend(outConfig, cfg);

  // deprecate defaultJSExtensions
  delete outConfig.defaultJSExtensions;

  cfg.meta = meta;
  cfg.depCache = depCache;
  cfg.map = map;

  if (hasProperties(meta))
    extend(outConfig, { meta: meta });

  if (hasProperties(depCache))
    extend(outConfig, { depCache: depCache });

  if (hasProperties(map))
    extend(outConfig, { map: map });

  if (hasProperties(packages))
    extend(outConfig, { packages: packages });

  var configContent = stringify(outConfig)
      // add a newline before "meta", "depCache", "map" blocks, removing quotes
      .replace(new RegExp('^' + config.tab + '"(meta|depCache|map|packages)"', 'mg'), config.newLine + config.tab + '$1')
      // remove quotes on first-level letter-based properties
      .replace(new RegExp('^' + config.tab + '"(\\w+)"', 'mg'), config.tab + '$1');

  return asp(fs.writeFile)(this.__fileName, 'System.config(' + configContent + ');' + config.newLine);
};
module.exports = Config;