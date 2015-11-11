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
var ConfigFile = require('./config-file');
var PackageName = require('../package-name');
var registry = require('../registry');
var config = require('./index');

/*
 * jspm loader configuration class
 * - baseMap
 * - depMap
 * - upgrade16
 * - package for local package
 * 
 * Public methods:
 * - ensureRegistry(registryName)
 * 
 */
exports.JspmSystemConfig = JspmSystemConfig;
function JspmSystemConfig(fileName) {
  SystemConfig.call(this, fileName);

  var self = this;

  var emptyConfig = this.file.properties.length == 0;

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

  if (!this.file.has(['globalEvaluationScope']))
    this.file.setValue(['globalEvaluationScope'], false);

  // NB handle case where there is no package name
  this.packageName = config.pjson.name;
  this.package = this.file.getObject(['packages', config.pjson.name]) || {};
}
JspmSystemConfig.prototype = Object.create(SystemConfig.prototype);
JspmSystemConfig.prototype.ensureRegistry = function(registryName) {
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
JspmSystemConfig.prototype.removePackage = function(exactName) {
  delete this.depMap[exactName];
  this.file.remove(['packages', exactName]);
};
// ensure baseMap and depMap are synced to file config
JspmSystemConfig.prototype.syncFile = function() {
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

  if (this.packageName != config.pjson.name)
    this.file.remove(['packages', this.packageName = config.pjson.name]);
  this.file.setObject(['packages', this.packageName], this.package);
  // ensure the local package is the first in the package list
  this.file.orderFirst(['packages', this.packageName]);
};

/*
 * Jspm System Browser configuration class
 * 
 * Public Methods:
 * - ensureRegistry(registryName)
 * - setPackageURL(packageURL)
 * - setPackagesURL(packagesURL)
 * - setBaseURL(baseURL)
 * 
 */
exports.JspmBrowserConfig = JspmBrowserConfig;
function JspmBrowserConfig(fileName) {
  SystemConfig.call(this, fileName);

  this.baseURL = this.file.getValue(['baseURL'], 'string');
  if (this.baseURL === '')
    this.baseURL = '.';

  // detect packages URL
  // when paths are baseURL-relative (baseURL + paths relying on baseURL)
  //  we then set the packagesURL to be relative implying it is baseURL-relative
  // otherwise the packagesURL is an absolute-style URL
  // we infer the value based on the first registry path present
  // if there are no values present, it remains undefined
  // this.packagesURL = 
}
JspmBrowserConfig.prototype = Object.create(SystemConfig.prototype);
JspmBrowserConfig.prototype.setPackagesURL = function(packagesURL) {
  // updates paths that correspond to the current packagesURL to the new packagesURL
  // including if the paths are baseURL relative to the packages URL
  // when this URL is relative it is assumed relative to the baseURL
  // TODO
  return packagesURL;
};
JspmBrowserConfig.prototype.setPackageURL = function(packageURL) {
  // sets the URL of the local package project
  // always assumed absolute
  // this corresponds to paths['package-name/*'] = packageURL/*
  // TODO
  return packageURL;
};
JspmBrowserConfig.prototype.setBaseURL = function(baseURL) {
  if (!baseURL) {
    this.baseURL = undefined;
    this.file.remove(['baseURL']);
    return;
  }

  // updates the baseURL to the given value
  var curBaseURL = this.file.getValue(['baseURL'], 'string');

  if (baseURL == '.' && (!curBaseURL || curBaseURL == '.'))
    return;

  this.file.setValue(['baseURL'], this.baseURL = baseURL);
};
JspmBrowserConfig.prototype.ensureRegistry = function(registryName) {
  // ensures the paths contain an entry for the given registry name
  // based on the packagesURL and baseURL
  // if packagesURL is not set, it is set to the default of path.relative(pjson.baseURL, pjson.packages)
  // TODO
  return registryName;
};


/*
 * System configuration class
 *
 * Public Methods:
 * - getConfig
 * - prompt
 * - write
 */
exports.SystemConfig = SystemConfig;
function SystemConfig(fileName) {
  this.file = new SystemConfigFile(fileName, [
    'baseURL',
    'packageConfigPaths',
    'paths',
    'globalEvaluationScope',
    'warnings',
    'meta',
    'map',
    'packages',
    'depCache',
    'bundles'
  ]);
}
SystemConfig.prototype.syncFile = function() {};
SystemConfig.prototype.write = function() {
  this.syncFile();
  this.file.write();
};
SystemConfig.prototype.getConfig = function() {
  this.syncFile();
  return this.file.getObject([], true);
};

/*
 * SystemConfigFile
 * Extends ConfigFile, implementing specific jspm config serialization and deserialization
 */
function SystemConfigFile(fileName, ordering) {
  ConfigFile.call(this, fileName, ordering);
}
SystemConfigFile.prototype = Object.create(ConfigFile.prototype);
SystemConfigFile.prototype.serialize = function(obj) {
  // base class serialize is JSON serialization of properties
  var serializedString = ConfigFile.prototype.serialize.call(this, obj);

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
SystemConfigFile.prototype.deserialize = function(configString) {
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
