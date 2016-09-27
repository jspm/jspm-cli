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
require('core-js/es6/string');

var ConfigFile = require('./config-file');
var PackageName = require('../package-name');
var registry = require('../registry');
var config = require('./index');
var path = require('path');
var hasProperties = require('../common').hasProperties;
var prepend = require('../common').prepend;
var extend = require('../common').extend;
var isPlain = require('../common').isPlain;
var ui = require('../ui');
var extendSystemConfig = require('../common').extendSystemConfig;
var fs = require('fs');

/*
 * jspm loader configuration class
 * - baseMap
 * - depMap
 * - upgrade16
 * - transpiler
 * - package for local package
 *
 * - browserBaseURL
 * - nodeRegistryPaths
 * - browserRegistryPaths
 * - browserLibURL
 * - nodeLibURL
 *
 * Public methods:
 * - ensureRegistry(registryName)
 *
 * Getters / Setters:
 * - browserPackagesURL
 * - nodePackagesURL
 */
exports.JspmSystemConfig = JspmSystemConfig;
function JspmSystemConfig(fileName) {
  var self = this;

  // primary jspm.config.js file
  this.file = new SystemConfigFile(fileName);

  // we effectively serialize into two separate configurations
  // the user-config and the jspm-managed config
  // this is done by "extracting" the jspm-managed config out
  // based on tracing the package.json dependencies through the config file
  this.file.serialize = jspmManagedConfigSerialize;

  this.emptyConfig = this.file.properties.length == 0;

  // having created the separate configuration files, we then manage their config centrally through
  // the main config file by extending them into it
  // if the config file is not provided in the package.json we still check for it at the default
  // location of package.json configFiles.x to see if it exists in the file system
  this.createConfigFile('dev');
  if (this.devFile.timestamp == -1) {
    this.devFile = null;
  }
  else {
    // there is some risk with this setProperties getProperties approach due to mutability
    // since it creates a binding between the objects as the getProperties aren't cloned
    // we don't hit those cases due to the nature of this separation not being a clone,
    // and by using change event forwarding, but it needs to be noted
    if (this.file.has(['devConfig']))
      this.file.setObject(['devConfig'], extendSystemConfig(this.file.getObject(['devConfig'], true), this.devFile.getObject([], true)));
    else
      this.file.setProperties(['devConfig'], this.devFile.getProperties([]));
  }

  this.createConfigFile('browser');
  if (this.browserFile.timestamp == -1) {
    this.browserFile = null;
  }
  else {
    if (this.file.has(['browserConfig']))
      this.file.setObject(['browserConfig'], extendSystemConfig(this.file.getObject(['browserConfig'], true), this.browserFile.getObject([], true)));
    else
      this.file.setProperties(['browserConfig'], this.browserFile.getProperties([]));
  }

  this.createConfigFile('node');
  if (this.nodeFile.timestamp == -1) {
    this.nodeFile = null;
  }
  else {
    if (this.file.has(['nodeConfig']))
      this.file.setObject(['nodeConfig'], extendSystemConfig(this.file.getObject(['nodeConfig'], true), this.nodeFile.getObject([], true)));
    else
      this.file.setProperties(['nodeConfig'], this.nodeFile.getProperties([]));
  }

  this.file.changed = false;

  // forward change events when using separate files for these objects
  this.file.changeEvents.push(function(memberArray) {
    if (['devConfig', 'browserConfig', 'nodeConfig'].indexOf(memberArray[0]) != -1) {
      var fileName = memberArray[0].substr(0, memberArray[0].length - 6) + 'File';
      if (self[fileName]) {
        self[fileName].changed = true;
        return true;
      }
    }
  });

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
      curMap[key] = new PackageName(packageObj[key], true);
    });
    self.depMap[prop.key] = curMap;
  });

  // copy in development tree

  // if a dev config map or packages entry is already in the main config or an override,
  // it gets added to "mapOverrides" and "packageOverrides" for dev instead of main config
  this.devMapOverrides = {};
  this.devPackageOverrides = {};

  // copy config into main configuration
  // it will be re-extracted on save
  map = this.file.getObject(['devConfig', 'map']) || {};
  Object.keys(map).forEach(function(key) {
    var pkgName = new PackageName(map[key], true);
    if (self.baseMap[key])
      self.devMapOverrides[key] = map[key];
    else
      self.baseMap[key] = pkgName;
  });
  (this.file.getProperties(['devConfig', 'packages']) || []).forEach(function(prop) {
    if (prop.key.indexOf(':') == -1 || self.depMap[prop] || !self.file.has(['devConfig', 'packages', prop.key, 'map'])) {
      self.devPackageOverrides[prop] = self.file.getObject(['packages', prop.key]);
      return;
    }

    var curMap = {};
    var packageObj = self.file.getObject(['devConfig', 'packages', prop.key, 'map'], true);
    Object.keys(packageObj).forEach(function(key) {
      if (typeof packageObj[key] != 'string')
        return;
      var pkgName = new PackageName(packageObj[key], true);
      curMap[key] = pkgName;
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

  this.browserBaseURL = this.file.getValue(['browserConfig', 'baseURL'], 'string') || this.file.getValue(['baseURL'], 'string');

  this.browserRegistryPaths = {};
  this.nodeRegistryPaths = {};

  var paths = readAndSanitizePaths(['paths']) || {};
  var browserPaths = readAndSanitizePaths(['browserConfig', 'paths']) || {};
  var nodePaths = readAndSanitizePaths(['nodeConfig', 'paths']) || {};

  function readAndSanitizePaths(pathsProp) {
    var paths = self.file.getObject(pathsProp);
    if (paths)
      Object.keys(paths).forEach(function(path) {
        var value = paths[path] + '';
        if (self.browserBaseURL && !isPlain(self.browserBaseURL) && value.startsWith(self.browserBaseURL)) {
          value = value.substr(self.browserBaseURL.length);
          self.file.setValue(pathsProp.concat([path]), value);
          paths[path] = value;
        }
        // path.length > 1 check is to retain "*": ... wildcard case
        if (path.endsWith('*') && value.endsWith('*') && value[value.length - 2] == '/' && path.length > 1) {
          self.file.remove(pathsProp.concat([path]));
          delete paths[path];
          path = path.substr(0, path.length - 1);
          value = value.substr(0, value.length - 1);
          self.file.setValue(pathsProp.concat([path]), value);
          paths[path] = value;
        }
      });
    return paths;
  }

  Object.keys(paths).forEach(function(path) {
    if (!getRegistryPath(path, paths[path]))
      return;
    self.browserRegistryPaths[path] = paths[path];
    self.nodeRegistryPaths[path] = paths[path];
  });

  Object.keys(browserPaths).forEach(function(path) {
    if (!getRegistryPath(path, browserPaths[path]))
      return;
    self.browserRegistryPaths[path] = browserPaths[path];
  });

  Object.keys(nodePaths).forEach(function(path) {
    if (!getRegistryPath(path, nodePaths[path]))
      return;
    self.nodeRegistryPaths[path] = nodePaths[path];
  });

  // if nodeConfig.paths has been explicitly opted out of via deletion, we respect that
  if (hasProperties(this.browserRegistryPaths) && !hasProperties(this.nodeRegistryPaths))
    this.nodeRegistryPaths = null;

  this.browserLibURL = paths[this.packageName + '/'];
  if (typeof this.browserLibURL != 'string')
    this.browserLibURL = browserPaths[this.packageName + '/'];
  this.nodeLibURL = paths[this.packageName + '/'];
  if (typeof this.nodeLibURL != 'string')
    this.nodeLibURL = nodePaths[this.packageName + '/'];

  if (typeof this.nodeLibURL == 'string' && !isPlain(this.nodeLibURL)) {
    ui.log('warn', 'Paths configuration "' + this.packageName + '/" -> "' + this.nodeLibURL + '" is not valid in Node, falling back to %directories.lib% default value.');
    this.nodeLibURL = null;
  }

  // node paths are treated as absolute file system paths
  if (typeof this.nodeLibURL == 'string')
    this.nodeLibURL = path.resolve(isPlain(this.nodeLibURL) ? config.pjson.baseURL : config.pjson.dir, this.nodeLibURL) + path.sep;
  if (this.nodeRegistryPaths)
    Object.keys(this.nodeRegistryPaths).forEach(function(p) {
      var value = self.nodeRegistryPaths[p];
      self.nodeRegistryPaths[p] = path.resolve(isPlain(value) ? config.pjson.baseURL : config.pjson.dir, value) + path.sep;
    });

  // we default the nodeLibURL and browserLibURL only in the case where the package exists
  if (this.package) {
    if (typeof this.nodeLibURL != 'string')
      this.nodeLibURL = config.pjson.lib;
    if (typeof this.browserLibURL != 'string')
      this.browserLibURL = path.relative(config.pjson.baseURL, config.pjson.lib);
  }

  // browser paths have the baseURL added back here, now that browser paths have been separated out
  if (this.browserBaseURL) {
    if (typeof this.browserLibURL == 'string' && isPlain(this.browserLibURL))
      this.browserLibURL = this.browserBaseURL + this.browserLibURL;
    if (this.browserRegistryPaths)
      Object.keys(this.browserRegistryPaths).forEach(function(p) {
        var value = self.browserRegistryPaths[p];
        if (isPlain(value))
          self.browserRegistryPaths[p] = self.browserBaseURL + value;
      });
  }
}
JspmSystemConfig.prototype.createConfigFile = function(type) {
  if (!this[type + 'File'])
    this[type + 'File'] = new SystemConfigFile(config.pjson['configFile' + type[0].toUpperCase() + type.substr(1)]);
};
JspmSystemConfig.prototype.removeConfigFile = function(type) {
  if (this[type + 'File']) {
    fs.unlinkSync(this[type + 'File'].fileName);
    this[type + 'File'] = null;
    // note as changed as we are now inlining the external file
    this.file.changed = true;
  }
};
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

  // add to browser and Node paths
  if (!this.browserRegistryPaths[registryName + ':'])
    this.browserRegistryPaths[registryName + ':'] = this.browserPackagesURL + registryName + '/';
  if (this.nodeRegistryPaths && !this.nodeRegistryPaths[registryName + ':'])
    this.nodeRegistryPaths[registryName + ':'] = this.nodePackagesURL + registryName + path.sep;
};

Object.defineProperty(JspmSystemConfig.prototype, 'browserBaseURL', {
  get: function() {
    return this._browserBaseURL;
  },
  set: function(baseURL) {
    if (baseURL === '')
      baseURL = '.';
    if (baseURL && baseURL[baseURL.length - 1] != '/')
      baseURL += '/';
    this._browserBaseURL = baseURL;
  }
});

Object.defineProperty(JspmSystemConfig.prototype, 'browserLibURL', {
  get: function() {
    return this._browserLibURL;
  },
  set: function(libURL) {
    if (libURL && libURL[libURL.length - 1] != '/')
      libURL += '/';
    this._browserLibURL = libURL;
  }
});

Object.defineProperty(JspmSystemConfig.prototype, 'nodeLibURL', {
  get: function() {
    return this._nodeLibURL;
  },
  set: function(libURL) {
    if (libURL && libURL[libURL.length - 1] != path.sep)
      libURL += path.sep;
    this._nodeLibURL = libURL;
  }
});

Object.defineProperty(JspmSystemConfig.prototype, 'browserPackagesURL', {
  get: function() {
    this._defaultBrowserPackagesURL = this._defaultBrowserPackagesURL || (this.browserBaseURL ? '' : '/') + path.relative(config.pjson.baseURL, config.pjson.packages) + '/';
    return getPackagesURL(this.browserRegistryPaths, '/') || this._defaultBrowserPackagesURL;
  },
  set: function(packagesURL) {
    var self = this;
    var curPackagesURL = this.browserPackagesURL;

    if (packagesURL[packagesURL.length - 1] != '/')
      packagesURL += '/';

    Object.keys(this.browserRegistryPaths).forEach(function(path) {
      var registryPath = getRegistryPath(path, self.browserRegistryPaths[path]);
      if (registryPath && registryPath.packagesURL + '/' == curPackagesURL)
        self.browserRegistryPaths[path] = packagesURL + registryPath.name + '/';
    });

    this._defaultBrowserPackagesURL = packagesURL;
  }
});

Object.defineProperty(JspmSystemConfig.prototype, 'nodePackagesURL', {
  get: function() {
    this._defaultNodePackagesURL = this._defaultNodePackagesURL || config.pjson.packages + path.sep;
    return this.nodeRegistryPaths && getPackagesURL(this.nodeRegistryPaths, path.sep) || this._defaultNodePackagesURL;
  },
  set: function(packagesURL) {
    var self = this;

    if (packagesURL[packagesURL.length - 1] != path.sep)
      packagesURL += path.sep;

    // if node registry paths was null, bring it back
    this.nodeRegistryPaths = this.nodeRegistryPaths || {};
    Object.keys(this.nodeRegistryPaths).forEach(function(p) {
      var registryPath = getRegistryPath(p, self.nodeRegistryPaths[p]);
      if (registryPath)
        self.nodeRegistryPaths[p] = packagesURL + registryPath.name + path.sep;
    });
    // ensure all packageConfig registry paths
    var packageConfigPaths = this.file.getValue(['packageConfigPaths'], 'array');

    packageConfigPaths.forEach(function(configPath) {
      var cfgPathMatch = configPath.match(/([^\:]+):/);
      if (cfgPathMatch)
        self.ensureRegistry(cfgPathMatch[1]);
    });

    this._defaultNodePackagesURL = packagesURL;
  }
});

function getPackagesURL(paths, sep) {
  var packagesURL;
  Object.keys(paths).some(function(path) {
    var registryPath = getRegistryPath(path, paths[path]);
    if (registryPath) {
      packagesURL = registryPath.packagesURL + sep;
      return true;
    }
  });
  return packagesURL;
}

function getRegistryPath(fromPath, toPath) {
  var registryMatch = fromPath.match(/^([^:]+):$/);
  if (!registryMatch)
    return;

  var registryName = registryMatch[1];

  var packagesMatch = toPath.match(new RegExp('^(.+)\\/' + registryName + '\\/$'));
  if (!packagesMatch)
    return;

  return {
    name: registryName,
    packagesURL: packagesMatch[1]
  };
}

JspmSystemConfig.prototype.removePackage = function(exactName) {
  delete this.depMap[exactName];
  this.file.remove(['packages', exactName]);
};

// ensure properties are synced to file config
JspmSystemConfig.prototype.syncFile = function() {
  var self = this;

  // extract the serialized depConfig
  var depConfig = {
    map: {},
    packages: {}
  };
  Object.keys(this.baseMap).forEach(function(name) {
    depConfig.map[name] = self.baseMap[name].toString();
  });
  Object.keys(this.depMap).forEach(function(parentName) {
    depConfig.packages[parentName] = { map: {} };
    Object.keys(self.depMap[parentName]).forEach(function(name) {
      depConfig.packages[parentName].map[name] = self.depMap[parentName][name].toString();
    });
  });

  // include peerDependencies and dependencies trees
  var coreConfig = {};
  moveTree(Object.keys(config.pjson.dependencies).concat(Object.keys(config.pjson.peerDependencies)), depConfig, coreConfig);
  // filter out devDependencies
  var devConfig = {};
  moveTree(Object.keys(config.pjson.devDependencies), depConfig, devConfig);
  // we then extend with our dev overrides
  // uninstalls have the ability to bump overrides if deps become dev-only again
  prepend(devConfig.map, this.devMapOverrides);
  prepend(devConfig.packages, this.devPackageOverrides);

  // then include what is left
  extend(coreConfig.map, depConfig.map);
  extend(coreConfig.packages, depConfig.packages);

  this.file.setObject(['map'], coreConfig.map);
  Object.keys(coreConfig.packages).forEach(function(pkgName) {
    self.file.setObject(['packages', pkgName, 'map'], coreConfig.packages[pkgName].map);
  });

  this.file.setObject(['devConfig', 'map'], devConfig.map, true, true);
  if (hasProperties(devConfig.packages))
    this.file.setObject(['devConfig', 'packages'], devConfig.packages, true, true);
  else
    this.file.remove(['devConfig', 'packages']);

  // any devPackages in this config, must move to the dev config
  // any non dev packages in the dev config, must move to this config
  Object.keys(devConfig.packages).forEach(function(devPkg) {
    if (self.file.has(['packages', devPkg])) {
      var pkgObj = self.file.getObject(['packages', devPkg], true);
      self.file.setObject(['devConfig', 'packages', devPkg], pkgObj);
      self.file.remove(['packages', devPkg]);
    }
  });
  Object.keys(coreConfig.packages).forEach(function(corePkg) {
    if (self.file.has(['devConfig', 'packages', corePkg])) {
      var pkgObj = self.file.getObject(['devConfig', 'packages', corePkg], true);
      self.file.setObject(['packages', corePkg], pkgObj);
      self.file.remove(['devConfig', 'packages', corePkg]);
    }
  });

  if (config.pjson.name && this.package) {
    if (this.packageName != config.pjson.name) {
      this.file.remove(['packages', this.packageName]);
      this.file.remove(['browserConfig', 'paths', this.packageName + '/']);
      this.file.remove(['nodeConfig', 'paths', this.packageName + '/']);
      this.file.remove(['paths', this.packageName + '/']);
      this.packageName = config.pjson.name;
    }

    this.file.setObject(['packages', this.packageName], this.package);
    // ensure the local package is the first in the package list
    this.file.orderFirst(['packages', this.packageName]);
  }

  if (this.transpiler)
    this.file.setValue(['transpiler'], this.transpiler != 'none' ? this.transpiler : false);

  if (this.browserBaseURL) {
    if (!this.file.has(['browserConfig', 'baseURL']) && this.file.has(['baseURL']))
      this.file.setValue(['baseURL'], this.browserBaseURL == '/' ? '/' : this.browserBaseURL.substr(0, this.browserBaseURL.length - 1));
    else
      this.file.setValue(['browserConfig', 'baseURL'], this.browserBaseURL == '/' ? '/' : this.browserBaseURL.substr(0, this.browserBaseURL.length - 1));
  }
  else {
    this.file.remove(['browserConfig', 'baseURL']);
    this.file.remove(['baseURL']);
  }

  var registryPaths = Object.keys(this.browserRegistryPaths);
  if (this.nodeRegistryPaths)
    Object.keys(this.nodeRegistryPaths).forEach(function(registryPath) {
      if (registryPaths.indexOf(registryPath) == -1)
        registryPaths.push(registryPath);
    });

  registryPaths.forEach(function(registryPath) {
    setPathsConfig(registryPath, self.browserRegistryPaths[registryPath], self.nodeRegistryPaths && self.nodeRegistryPaths[registryPath], false);
  });
  setPathsConfig(this.packageName + '/', this.browserLibURL, this.nodeLibURL, true);

  // set paths with consolidation across browser / node cases
  function setPathsConfig(name, browserPath, nodePath, orderLast) {
    // remove baseURL from browserPath and nodePath converting them into relative URLs
    if (typeof browserPath == 'string' && browserPath.startsWith(self.browserBaseURL))
      browserPath = browserPath.substr(self.browserBaseURL.length);
    if (typeof nodePath == 'string') {
      if (nodePath.startsWith(config.pjson.baseURL))
        nodePath = nodePath.substr(config.pjson.baseURL.length + 1);
      nodePath = nodePath.replace(/\\/g, '/');
    }


    if (!self.browserFile && typeof nodePath == 'string' && typeof browserPath == 'string' &&
        isPlain(browserPath) && browserPath == nodePath) {
      // path collapse when browser = node path and we're not using a separate browser config file
      self.file.remove(['browserConfig', 'paths', name], true);
      self.file.remove(['nodeConfig', 'paths', name], true);
      self.file.setValue(['paths', name], browserPath);
      if (orderLast)
        self.file.orderLast(['paths', name]);
    }
    else {
      // separation case
      if (typeof nodePath == 'string') {
        self.file.setValue(['nodeConfig', 'paths', name], nodePath);
        if (orderLast)
          self.file.orderLast(['nodeConfig', 'paths', name]);
      }
      if (typeof browserPath == 'string') {
        self.file.setValue(['browserConfig', 'paths', name], browserPath);
        if (orderLast)
          self.file.orderLast(['browserConfig', 'paths', name]);
      }
      // when we have both a node and a browser entry, clear the base-level path
      if (typeof nodePath == 'string' && typeof browserPath == 'string')
        self.file.remove(['paths', name], true);
    }
  }

  this.file.clearIfEmpty(['devConfig']);
  this.file.clearIfEmpty(['browserConfig']);
  this.file.clearIfEmpty(['nodeConfig']);
};

// extracts the config dependencies from one config object to another
function moveTree(depsList, sourceConfig, targetConfig) {
  targetConfig.map = targetConfig.map || {};
  targetConfig.packages = targetConfig.packages || {};

  if (sourceConfig.map) {
    Object.keys(sourceConfig.map).forEach(function(dep) {
      if (depsList.indexOf(dep) != -1) {
        targetConfig.map[dep] = sourceConfig.map[dep];
        delete sourceConfig.map[dep];
      }
    });

    if (!hasProperties(sourceConfig.map))
      delete sourceConfig.map;
  }

  if (sourceConfig.packages && targetConfig.map) {
    var relatedPkgs = [];
    function addRelatedPackage(pkg) {
      if (relatedPkgs.indexOf(pkg) != -1 || !sourceConfig.packages[pkg])
        return;

      relatedPkgs.push(pkg);

      var curPkg = sourceConfig.packages[pkg];
      if (curPkg.map)
        Object.keys(curPkg.map).forEach(function(dep) {
          addRelatedPackage(curPkg.map[dep]);
        });
    }
    Object.keys(targetConfig.map).forEach(function(dep) {
      addRelatedPackage(targetConfig.map[dep]);
    });
    Object.keys(sourceConfig.packages).forEach(function(pkg) {
      if (relatedPkgs.indexOf(pkg) == -1)
        return;

      var curPkg = sourceConfig.packages[pkg];
      targetConfig.packages[pkg] = curPkg;
      delete sourceConfig.packages[pkg];
    });

    if (!hasProperties(sourceConfig.packages))
      delete sourceConfig.packages;
  }
}

function jspmManagedConfigSerialize(obj) {
  var managedCfg = {};

  if (obj.packageConfigPaths) {
    managedCfg.packageConfigPaths = obj.packageConfigPaths;
    delete obj.packageConfigPaths;
  }

  moveTree(Object.keys(config.pjson.dependencies).concat(Object.keys(config.pjson.peerDependencies)), obj, managedCfg);

  //if (!hasProperties(managedCfg.map))
  //  delete managedCfg.map;

  var newline = this.style.newline;
  var trailingNewline = this.style.trailingNewline;

  return SystemConfigFile.prototype.serialize.call(this, obj) + newline + (trailingNewline ? '' : newline) +
    SystemConfigFile.prototype.serialize.call(this, managedCfg);
}

JspmSystemConfig.prototype.write = function() {
  this.syncFile();

  // sync with pjson config file names as default write targets
  if (config.pjson.configFile != this.file.fileName)
    this.file.rename(config.pjson.configFile);

  var devProperties, browserProperties, nodeProperties;
  var changed = this.file.changed;

  if (this.devFile) {
    if (config.pjson.configFileDev != this.devFile.fileName)
      this.devFile.rename(config.pjson.configFileDev);
    devProperties = this.file.getProperties(['devConfig']) || [];
    this.devFile.setProperties([], devProperties);
    this.file.remove(['devConfig']);
    this.devFile.write();
  }

  if (this.browserFile) {
    if (config.pjson.configFileBrowser != this.browserFile.fileName)
      this.browserFile.rename(config.pjson.configFileBrowser);
    browserProperties = this.file.getProperties(['browserConfig']) || [];
    this.browserFile.setProperties([], browserProperties);
    this.file.remove(['browserConfig']);
    this.browserFile.write();
  }

  if (this.nodeFile) {
    if (config.pjson.configFileNode != this.nodeFile.fileName)
      this.nodeFile.rename(config.pjson.configFileNode);
    nodeProperties = this.file.getProperties(['nodeConfig']) || [];
    this.nodeFile.setProperties([], nodeProperties);
    this.file.remove(['nodeConfig']);
    this.nodeFile.write();
  }

  this.file.changed = changed;

  this.file.write();

  if (devProperties)
    this.file.setProperties(['devConfig'], devProperties);
  if (browserProperties)
    this.file.setProperties(['browserConfig'], browserProperties);
  if (nodeProperties)
    this.file.setProperties(['nodeConfig'], nodeProperties);
  this.file.changed = false;
};
JspmSystemConfig.prototype.getConfig = function() {
  this.syncFile();

  return this.file.getObject([], true);
};

/*
 * SystemConfigFile
 * Extends ConfigFile, implementing specific jspm config serialization and deserialization
 */
function SystemConfigFile(fileName) {
  ConfigFile.call(this, fileName, [
    'baseURL',
    'production',
    'packageConfigPaths',
    'paths',
    ['browserConfig', [
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
    ]],
    ['nodeConfig', [
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
    ]],
    ['productionConfig', [
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
    ]],
    ['devConfig', [
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
    ]],
    'warnings',
    'transpiler',
    'meta',
    'map',
    'packages',
    'depCache',
    'bundles'
  ]);
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
      extendSystemConfig(cfg, _cfg);
    },
    paths: {},
    map: {}
  };
  var SystemJS = System;
  eval(configString.toString());
  return cfg;
};
