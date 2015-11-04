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
  this.file = new LoaderConfigFile(fileName, [
    'baseURL',
    'packageConfigPaths',
    'paths',
    'map',
    'packages'
  ]);

  var emptyConfig = this.file.properties.length == 0;

  var self = this;

  // the base install map is the global map config
  this.baseMap = {};
  var map = this.file.getObject(['map']);
  Object.keys(map).forEach(function(key) {
    self.baseMap[key] = new PackageName(map[key]);
  });

  // the dep map is the package contextual map
  this.depMap = {};
  (this.file.getProperties(['packages']) || []).forEach(function(prop) {
    if (!self.file.has(['packages', prop.key, 'map']))
      return;
    var curMap = self.depMap[prop.key] = self.file.getObject(['packages', prop.key, 'map']);
    Object.keys(curMap).forEach(function(key) {
      curMap[key] = new PackageName(curMap[key]);
    });
  });

  // downgrade back to jspm 0.16 then upgrade can mess packageConfigPaths
  this.upgrade16 = false;

  // packageConfigPaths is the indicator property in the config to know if the project is jspm 0.17-ready
  // if the config file doesn't exist, then we assume the project is jspm 0.17-ready
  var packageConfigPaths;
  try {
    packageConfigPaths = this.file.getProperties(['packageConfigPaths']);
  }
  catch(e) {}
  if (packageConfigPaths) {
    this.upgrade16 = !emptyConfig;
    this.file.setValue(['packageConfigPaths'], Object.keys(packageConfigPaths || {}).map(function(path) {
      return packageConfigPaths[path];
    }));
  }
}
LoaderConfig.prototype.ensureRegistry = function(registryName) {
  // ensure packageNameFormats are present as packageConfigPaths in the right order
  var packageConfigPaths = this.file.getValue(['packageConfigPaths'], 'array');

  var lastIndex;
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
LoaderConfig.prototype.removePackage = function(exactName) {
  delete this.depMap[exactName];
  this.file.remove(['packages', exactName]);
};
LoaderConfig.prototype.write = function() {
  this.syncFile();
  this.file.write();
};
LoaderConfig.prototype.toJSON = function() {
  this.syncFile();
  return this.file.toJSON();
};

// ensure baseMap and depMap are synced to file config
LoaderConfig.prototype.syncFile = function() {
  var self = this;


  var baseMap = {};
  Object.keys(this.baseMap).forEach(function(name) {
    baseMap[name] = self.baseMap[name].toString();
  });

  this.file.setObject(['map'], baseMap);

  Object.keys(this.depMap).forEach(function(parentName) {
    var depMap = {};
    Object.keys(self.depMap[parentName]).forEach(function(name) {
      depMap[name] = self.depMap[parentName][name].toString();
    });
    self.file.setObject(['packages', parentName, 'map'], depMap);
  });
};

LoaderConfig.prototype.getConfig = function() {
  this.syncFile();
  return this.file.getObject([], true);
};

/*
 * LoaderConfigFile
 * Extends ConfigFile, implementing specific jspm config serialization and deserialization
 */
function LoaderConfigFile(fileName, ordering) {
  ConfigFileBase.call(this, fileName, ordering);
}
LoaderConfigFile.prototype = Object.create(ConfigFileBase.prototype);
LoaderConfigFile.prototype.serialize = function(obj) {
  // base class serialize is JSON serialization of properties
  var serializedString = ConfigFileBase.prototype.serialize.call(this, obj);

  var tab = this.style.tab;
  var quote = this.style.quote;
  var newline = this.style.newline;
  var trailingNewline = this.style.trailingNewline;

  return ('System.config(' + serializedString.trim() + ');' + (trailingNewline ? newline : ''))
      // add a newline before "meta", "depCache", "map" blocks, removing quotes
      .replace(new RegExp('^' + tab + quote + '(meta|depCache|map|packages)' + quote, 'mg'), newline + tab + '$1')
      // remove quotes on first-level letter-based properties
      .replace(new RegExp('^' + tab + quote + '(\\w+)' + quote, 'mg'), tab + '$1');
};
LoaderConfigFile.prototype.deserialize = function(configString) {
  /*jshint unused:false */
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
  eval(configString.toString());
  return cfg;
};

// NB finish this
LoaderConfig.prototype.prompt = function() {
  var self = this;

  return ui.input('Enter the browser %baseURL% (absolute path) corresponding to the `directories.baseURL`, optional', self.baseURL, {
    edit: self.baseURL == '/'
  })
  .then(function(baseURL) {
    self.baseURL = baseURL;

    return ui.input('Enter the module %format% of your package - `ESM` (ES2015 module), `CJS` or `AMD`', self.format || 'esm', {
      completions: ['esm', 'cjs', 'amd', 'global', 'system', 'systemjs', 'register', 'ESM', 'CJS', 'AMD', 'Global', 'System', 'SystemJS', 'Register']
    })
    .then(function(format) {
      format = format.toLowerCase();
      if (format == 'system' || format == 'systemjs')
        format = 'register';
      if (['esm', 'cjs', 'amd', 'global', 'register'].indexOf(format) == -1) {
        ui.log('info', '%' + format + '% is not a vaild module format. Defaulting to `esm`.');
        return 'esm';
      }
      return format;
    })
    .then(function(format) {
      self.format = format;
      return ui.input('Enter the %main% entry point of your package within %' + (self.isDist ? self.dist : self.lib || self.dist) + '%', self.main || self.name + '.js');
    })
    .then(function(main) {
      self.main = main;
    });
  });

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
};
