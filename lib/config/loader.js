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
var ConfigFileBase = require('./file-base');
var PackageName = require('../package-name');
var ui = require('../ui');
var registry = require('../registry');

/*
 * Loader configuration class
 *
 * Public Properties:
 * - baseMap
 * - depMap
 * - upgrade16
 *
 * Public Methods:
 * - ensureRegistry(registryName)
 * - getConfig
 * - prompt
 * - write
 */
module.exports = LoaderConfig;
function LoaderConfig(fileName) {
  this.file = new LoaderConfigFile(fileName);

  var self = this;

  // the base install map is the global map config
  this.baseMap = {};
  this.file.getProperties(['map']).forEach(function(prop) {
    self.baseMap[prop.key] = new PackageName(prop.value);
  });

  // the dep map is the package contextual map
  this.depMap = {};
  this.file.getProperties(['packages']).forEach(function(name) {
    if (!self.file.has(['packages', name, 'map']))
      return;
    var curMap = self.depMap[prop.key] = {};
    self.file.getProperties(['packages', name, 'map']).forEach(function(dep) {
      curMap[dep] = new PackageName(self.file.getValue(['packages', name, 'map', dep]));
    });
  });

  // downgrade back to jspm 0.16 then upgrade can mess packageConfigPaths
  this.upgrade16 = false;
  var packageConfigPaths = this.file.getValue(['packageConfigPaths']);
  if (!(packageConfigPaths instanceof Array)) {
    this.upgrade16 = true;
    this.setValue(['packageConfigPaths'], Object.keys(packageConfigPaths || {}).map(function(path) {
      return packageConfigPaths[path];
    }));
  }
}
LoaderConfig.prototype.ensureRegistry = function(registryName) {
  // ensure packageNameFormats are present as packageConfigPaths in the right order
  var packageConfigPaths = this.file.getValue(['packageConfigPaths']);

  var lastIndex;
  var self = this;
  (registry.load(registryName).constructor.packageNameFormats || ['*'])
  .forEach(function(packageNameFormat) {
    var packageConfigPath = registryName + ':' + packageNameFormat + '.json';

    var curIndex = packageConfigPaths.indexOf(packageConfigPath);

    // add if not present
    if (curIndex == -1) {
      packageConfigPaths.push(packageConfigPath);
    }
    // reorder if not in order
    else {
      if (curIndex < lastIndex)
        packageConfigPaths.splice(curIndex, 1);

      lastIndex = curIndex;
    }
  });
};
LoaderConfig.prototype.prompt = function() {
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
};
LoaderConfig.prototype.write = function() {
  this.syncFile();
  return this.file.write();
};
LoaderConfig.prototype.toJSON = function() {
  this.syncFile();
  return this.file.toJSON();
};

// ensure baseMap and depMap are synced to file config
LoaderConfig.prototype.syncFile = function() {
  var baseMap = {};
  Object.keys(self.baseMap).forEach(function(name) {
    baseMap[name] = self.baseMap[name].toString();
  });

  this.file.setObject(['map'], baseMap);

  var self = this;
  Object.keys(this.depMap).forEach(function(parentName) {
    var depMap = {};
    Object.keys(self.depMap[parentName]).forEach(function(name) {
      depMap[name] = self.depMap[parentName][name].toString();
    });
    self.file.setObject(['packages', parentName, 'map'], depMap);
  });
};

/*
 * LoaderConfigFile
 * Extends ConfigFile, implementing specific jspm config serialization and deserialization
 */
function LoaderConfigFile(fileName) {
  ConfigFileBase.call(this, fileName);
}
LoaderConfigFile.prototype = Object.create(ConfigFileBase);
LoaderConfigFile.prototype.serialize = function() {
  // base class serialize is JSON serialization of properties
  var serializedString = ConfigFileBase.prototype.serialize.call(this);

  var tab = this.style.tab;
  var quote = this.style.quote;
  var newLine = this.style.newLine;

  return serializedString
      // add a newline before "meta", "depCache", "map" blocks, removing quotes
      .replace(new RegExp('^' + tab + quote + '(meta|depCache|map|packages)' + quote, 'mg'), newLine + tab + '$1')
      // remove quotes on first-level letter-based properties
      .replace(new RegExp('^' + tab + quote + '(\\w+)' + quote, 'mg'), tab + '$1');
};
LoaderConfigFile.prototype.deserialize = function(configString) {
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
        else {
          cfg[c] = v;
        }
      }
    },
    paths: {},
    map: {}
  };
  eval(source.toString());

  self.setObject([], cfg);
};
