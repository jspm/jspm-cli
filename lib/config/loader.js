/*
 *   Copyright 2014-2016 Guy Bedford (http://guybedford.com)
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
var path = require('path');
var hasProperties = require('../common').hasProperties;

/*
 * jspm loader configuration class
 * - baseMap
 * - depMap
 * - upgrade16
 * - transpiler
 * - package for local package
 * 
 * Public methods:
 * - ensureRegistry(registryName)
 * 
 */
exports.JspmSystemConfig = JspmSystemConfig;
function JspmSystemConfig(fileName) {
  SystemConfig.call(this, fileName);

  // we effectively serialize into two separate configurations
  // the user-config and the jspm-managed config
  // this is done by "extracting" the jspm-managed config out
  // based on tracing the package.json dependencies through the config file
  this.file.serialize = jspmManagedConfigSerialize;

  var self = this;

  this.emptyConfig = this.file.properties.length == 0;

  // the base install map is the global map config
  this.baseMap = {};
  // the dep map is the package contextual map
  this.depMap = {};
  var map = this.file.getObject(['map'], true) || {};
  Object.keys(map).forEach(function(key) {
    // upgrade path
    if (typeof map[key] == 'object') {
      var curDepMap = self.depMap[key] = map[key];
      Object.keys(curDepMap).forEach(function(key) {
        curDepMap[key] = new PackageName(curDepMap[key], true);
      });
      return;
    }
    self.baseMap[key] = new PackageName(map[key], true);
  });
  
  (this.file.getProperties(['packages']) || []).forEach(function(prop) {
    if (!self.file.has(['packages', prop.key, 'map']))
      return;
    // only parse packages with ':' in the name
    if (prop.key.indexOf(':') == -1)
      return;

    var curMap = {};
    var packageObj = self.file.getObject(['packages', prop.key, 'map'], true);
    Object.keys(packageObj).forEach(function(key) {
      if (typeof packageObj[key] != 'string')
        return;
      curMap[key] = new PackageName(packageObj[key]);
    });
    self.depMap[prop.key] = curMap;
  });

  // downgrade back to jspm 0.16 then upgrade can mess packageConfigPaths
  this.upgrade16 = false;

  // packageConfigPaths is the indicator property in the config to know if the project is jspm 0.17-ready
  // if the config file doesn't exist, then we assume the project is jspm 0.17-ready
  var packageConfigPaths;
  try {
    packageConfigPaths = this.file.getValue(['packageConfigPaths'], 'array');
  }
  catch(e) {}

  if (!packageConfigPaths) {
    if (this.file.getValue(['defaultJSExtensions'], 'boolean'))
      this.upgrade16 = true;
    this.file.setValue(['packageConfigPaths'], Object.keys(packageConfigPaths || {}).map(function(path) {
      return packageConfigPaths[path];
    }));
  }

  // NB deprecate with beta
  if (this.file.has(['globalEvaluationScope']))
    this.file.remove(['globalEvaluationScope']);

  if (this.file.has(['defaultJSExtensions']))
    this.file.remove(['defaultJSExtensions']);

  this.transpiler = this.file.getValue(['transpiler']);
  if (this.transpiler === false || this.transpiler && typeof this.transpiler != 'string')
    this.transpiler = 'none';

  this.packageName = config.pjson.name;
  this.package = config.pjson.name && this.file.getObject(['packages', config.pjson.name], true);
}
JspmSystemConfig.prototype = Object.create(SystemConfig.prototype);
JspmSystemConfig.prototype.ensureRegistry = function(registryName) {
  // ensure packageNameFormats are present as packageConfigPaths in the right order
  var packageConfigPaths = this.file.getValue(['packageConfigPaths'], 'array');

  if (!packageConfigPaths)
    this.file.setValue(['packageConfigPaths'], packageConfigPaths = []);

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
// ensure properties are synced to file config
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

  if (config.pjson.name && this.package) {
    if (this.packageName != config.pjson.name) {
      this.file.remove(['packages', this.packageName]);
      this.packageName = config.pjson.name;
    }

    this.file.setObject(['packages', this.packageName], this.package);
    // ensure the local package is the first in the package list
    this.file.orderFirst(['packages', this.packageName]);
  }

  if (this.transpiler)
    this.file.setValue(['transpiler'], this.transpiler != 'none' ? this.transpiler : false);
};
function jspmManagedConfigSerialize(obj) {
  var managedCfg = {};

  if (obj.packageConfigPaths) {
    managedCfg.packageConfigPaths = obj.packageConfigPaths;
    delete obj.packageConfigPaths;
  }

  if (obj.map) {
    managedCfg.map = {};
    var depsList = Object.keys(config.pjson.dependencies).concat(Object.keys(config.pjson.devDependencies)).concat(Object.keys(config.pjson.peerDependencies));
    Object.keys(obj.map).forEach(function(dep) {
      if (depsList.indexOf(dep) != -1) {
        managedCfg.map[dep] = obj.map[dep];
        delete obj.map[dep];
      }
    });

    if (!hasProperties(obj.map))
      delete obj.map;
    if (!hasProperties(managedCfg.map))
      delete managedCfg.map;
  }

  if (obj.packages && managedCfg.map) {
    managedCfg.packages = {};

    var managedPkgs = [];
    function addManagedPackage(pkg) {
      if (managedPkgs.indexOf(pkg) != -1 || !obj.packages[pkg])
        return;

      managedPkgs.push(pkg);

      var curPkg = obj.packages[pkg];
      if (curPkg.map)
        Object.keys(curPkg.map).forEach(function(dep) {
          addManagedPackage(curPkg.map[dep]);
        });
    }
    Object.keys(managedCfg.map).forEach(function(dep) {
      addManagedPackage(managedCfg.map[dep]);
    });
    Object.keys(obj.packages).forEach(function(pkg) {
      if (managedPkgs.indexOf(pkg) == -1)
        return;

      var curPkg = obj.packages[pkg];
      managedCfg.packages[pkg] = curPkg;
      delete obj.packages[pkg];
    });
  }

  var newline = this.style.newline;
  var trailingNewline = this.style.trailingNewline;

  return SystemConfigFile.prototype.serialize.call(this, obj) + newline + (trailingNewline ? '' : newline) + 
    SystemConfigFile.prototype.serialize.call(this, managedCfg);
}

/*
 * Jspm System Browser configuration class
 *
 * Public Getter/Setter Properties:
 * - baseURL
 * - libURL
 * - packagesURL
 * 
 * Public Methods:
 * - ensureRegistry(registryName)
 */
exports.JspmBrowserConfig = JspmBrowserConfig;
function JspmBrowserConfig(fileName) {
  SystemConfig.call(this, fileName);

  this.packageName = config.pjson.name;
}
JspmBrowserConfig.prototype = Object.create(SystemConfig.prototype);

Object.defineProperty(JspmBrowserConfig.prototype, 'baseURL', {
  get: function() {
    return this.file.getValue(['baseURL'], 'string');
  },
  set: function(baseURL) {
    if (!baseURL) {
      this.file.remove(['baseURL']);
      return;
    }
    this.file.setValue(['baseURL'], baseURL);
  }
});

Object.defineProperty(JspmBrowserConfig.prototype, 'libURL', {
  get: function() {
    var packagePath = this.file.getValue(['paths', this.packageName + '/'], 'string');
    if (packagePath && packagePath[packagePath.length - 1] == '/')
      packagePath = packagePath.substr(0, packagePath.length - 1);
    else
      packagePath = undefined;
    return packagePath;
  },
  set: function(libURL) {
    if (!libURL || this.packageName != config.pjson.name) {
      this.file.remove(['paths', this.packageName + '/']);
      this.packageName = config.pjson.name;
    }
    if (libURL) {
      this.file.setValue(['paths', config.pjson.name + '/'], libURL + '/');
      this.file.orderLast(['paths', config.pjson.name + '/']);
    }
  }
});

function getRegistryPath(fromPath, toPath) {
  var registryMatch = fromPath.match(/^([^:]+):\*$/);
  if (!registryMatch)
    return;

  var registryName = registryMatch[1];

  var packagesMatch = toPath.match(new RegExp('^(.+)\\/' + registryName + '\\/\\*$'));
  if (!packagesMatch)
    return;

  return {
    name: registryName,
    packagesURL: packagesMatch[1]
  };
}

Object.defineProperty(JspmBrowserConfig.prototype, 'packagesURL', {
  get: function() {
    var paths = this.file.getObject(['paths']) || {};
    var packagesURL;

    Object.keys(paths).some(function(path) {
      var registryPath = getRegistryPath(path, paths[path]);
      if (registryPath) {
        packagesURL = registryPath.packagesURL;
        return true;
      }
    });
    return packagesURL || this.intendedPackagesURL;
  },
  set: function(packagesURL) {
    var curPackagesURL = this.packagesURL;
    var paths = this.file.getObject(['paths']) || {};

    Object.keys(paths).forEach(function(path) {
      var registryPath = getRegistryPath(path, paths[path]);
      if (registryPath && registryPath.packagesURL == curPackagesURL)
        paths[path] = packagesURL + '/' + registryPath.name + '/*';
    });

    if (Object.keys(paths).length) {
      this.file.setObject(['paths'], paths);
      this.file.orderLast(['paths', config.pjson.name + '/']);
    }
    else
      this.intendedPackagesURL = packagesURL;
  }
});

JspmBrowserConfig.prototype.ensureRegistry = function(registryName) {
  var packagesURL = this.packagesURL || (this.baseURL ? '' : '/') + path.relative(config.pjson.baseURL, config.pjson.packages);

  var curRegistryPath = this.file.getValue(['paths', registryName + ':*'], 'string');
  if (!curRegistryPath)
    this.file.setValue(['paths', registryName + ':*'], packagesURL + '/' + registryName + '/*');

  this.file.orderLast(['paths', config.pjson.name + '/']);

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
    'warnings',
    'transpiler',
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

  return ('SystemJS.config(' + serializedString.trim() + ');' + (trailingNewline ? newline : ''))
      // add a newline before "meta", "depCache", "map" blocks, removing quotes
      // .replace(new RegExp('^' + tab + quote + '(meta|depCache|map|packages)' + quote, 'mg'), newline + tab + '$1')
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
  var SystemJS = System;
  eval(configString.toString());
  return cfg;
};
