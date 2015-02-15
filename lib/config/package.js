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

var config = require('../config');
var PackageName = require('./package-name');
var path = require('path');
var extend = require('../common').extend;
var hasProperties = require('../common').hasProperties;
var registryCache = require('../package').registryCache;
var Promise = require('rsvp').Promise;
var ui = require('../ui');
var fs = require('graceful-fs');
var asp = require('rsvp').denodeify;
var readJSON = require('../common').readJSON;
var alphabetize = require('../common').alphabetize;
var globalConfig = require('../global-config');
var processDeps = require('../package').processDeps;

var isWindows = process.platform.match(/^win/);
var winRegEx = /\\/g;
function winPath(path) {
  if (!isWindows)
    return path;
  return path.replace(winRegEx, '/');
}

/*
 * Package.json Configuration Class
 *
 * main
 * registry
 * dependencies
 * configFile
 * baseURL
 * lib
 * dist
 * packages
 * format
 * map
 * buildConfig
 *
 */
function PackageJSON(fileName) {
  this.fileName = fileName;
}

PackageJSON.prototype.read = function(prompts) {
  if (this.read_)
    throw "Package.json file already read";

  this.read_ = true;
  var self = this;
  var pjson;

  return readJSON(this.fileName)
  .then(function(_pjson) {
    self.originalPjson = _pjson;
    
    self.jspmPrefix = true;
    if (_pjson.registry && !_pjson.jspm)
      self.jspmPrefix = false;
    
    // derive the jspm config from the 'jspm' property in the package.json
    // also sets the registry property if dependencies are jspm-prefixed
    pjson = config.derivePackageConfig(_pjson);

    self.pjson = pjson;

    prompts = prompts || (!_pjson.jspm && !_pjson.registry);

    if (prompts)
      return doInitPrompts(pjson, self.fileName, self.jspmPrefix)
      .then(function(prefixed) {
        self.jspmPrefix = prefixed;
      });
  })
  .then(function() {
    self.dir = path.dirname(self.fileName);

    // populate defaults as we go
    var defaults = self.defaults = {};

    self.registry = pjson.registry || globalConfig.config.registry;
    self.dependencies = {};
    // only read dependencies when combined with a registry property
    self.dependencies = processDeps(pjson.dependencies, self.registry);

    defaults.baseURL = self.dir;
    self.baseURL = pjson.directories && pjson.directories.baseURL && path.resolve(self.dir, pjson.directories.baseURL) || defaults.baseURL;

    defaults.packages = path.resolve(self.baseURL, 'jspm_packages');

    defaults.main = path.join(self.baseURL, 'index');
    self.main = pjson.main || defaults.main;

    // NB can remove jspmPackages suport in time
    self.packages = pjson.directories && pjson.directories.packages && path.resolve(self.dir, pjson.directories.packages)
      || pjson.directories && pjson.directories.jspmPackages && path.resolve(self.dir, pjson.directories.jspmPackages) || defaults.packages;

    defaults.configFile = path.resolve(self.baseURL, 'config.js');
    self.configFile = pjson.configFile && path.resolve(self.dir, pjson.configFile) || defaults.configFile;
    
    self.format = pjson.format;
    self.map = extend({}, pjson.map || {});

    // NB remove when nodelibs no longer built this way
    self.useJSExtensions = pjson.useJSExtensions;

    self.buildConfig = extend({}, pjson.buildConfig || {});
    
    return prompts;
  });
}

PackageJSON.prototype.write = function() {
  var pjson = this.jspmPrefix ? {} : this.originalPjson;

  if (!this.jspmPrefix) {
    delete pjson.jspm;
    pjson.registry = this.registry || globalConfig.config.registry;
  }
  else if (this.registry != 'jspm') {
    pjson.registry = this.registry;
  }

  var defaults = this.defaults;

  // only set properties that differ from the defaults
  if (this.main != defaults.main)
    pjson.main = this.main;

  if (this.format)
    pjson.format = this.format;

  var directories = {};
  if (this.baseURL != defaults.baseURL)
    directories.baseURL = this.baseURL;
  if (this.packages != defaults.packages)
    directories.packages = this.packages;

  if (hasProperties(directories)) {
    for (var d in directories) {
      directories[d] = winPath(path.relative(this.dir, directories[d]));
      if (!directories[d])
        directories[d] = '.';
    }
  }
  pjson.directories = extend(pjson.directories || {}, this.pjson.directories || {});
  pjson.directories = alphabetize(pjson.directories);

  if (!hasProperties(pjson.directories))
    delete pjson.directories;

  if (this.configFile != defaults.configFile)
    pjson.configFile = winPath(path.relative(this.dir, this.configFile));

  pjson.map = alphabetize(this.map);
  if (!hasProperties(pjson.map))
    delete pjson.map;

  pjson.dependencies = {};
  var depValue;
  for (var d in this.dependencies) {
    var dep = this.dependencies[d];
    if (!dep)
      continue;
    if (dep.endpoint == 'jspm') {
      if (d == dep.package)
        depValue = dep.version;
      else
        depValue = dep.exactPackage;
    }
    // name is exactly as in registry
    else if (registryCache[d] == dep.name)
        depValue = dep.version;
    else
      depValue = dep.exactName;
    
    pjson.dependencies[d] = depValue;
  }
  pjson.dependencies = alphabetize(pjson.dependencies);
  if (!hasProperties(pjson.dependencies))
    delete pjson.dependencies;

  pjson.buildConfig = this.buildConfig;
  if (!hasProperties(pjson.buildConfig))
    delete pjson.buildConfig;

  // dedupe jspm properties against base properties
  if (this.jspmPrefix) {
    for (var p in pjson) {
      if (this.originalPjson[p] === pjson[p])
        delete pjson[p];
    }
    this.originalPjson.jspm = pjson;
  }

  // NB check that the file hasn't changed since we opened it and if so, prompt
  return asp(fs.writeFile)(this.fileName, JSON.stringify(this.originalPjson, null, 2) + '\n');
}

// can take an existing non-jspm package.json
function doInitPrompts(pjson, pjsonPath, prefixed) {
  var baseDir = path.dirname(pjsonPath);
  var base;

  pjson.directories = pjson.directories || {};

  return Promise.resolve()
  .then(function() {
    return ui.confirm('Would you like jspm to prefix the jspm package.json properties under %jspm%?', prefixed);
  })
  .then(function(prefix) {
    prefixed = prefix;
    return ui.input('Enter server baseURL (public folder path)', pjson.directories.baseURL || './');
  })
  .then(function(baseURL) {
    base = path.relative(process.cwd(), path.resolve(baseURL));
    baseURL = path.relative(baseDir, path.resolve(baseURL));
    if (!base)
      base = '.';
    base += path.sep;
    if (baseURL)
      pjson.directories.baseURL = baseURL;
    return ui.input('Enter project code folder', pjson.directories.lib || base);
  })
  .then(function(lib) {
    pjson.directories.lib = path.relative(baseDir, path.resolve(lib));
    if (!pjson.directories.lib)
      pjson.directories.lib = '.';
    return ui.input('Enter jspm packages folder', pjson.directories.packages || base + 'jspm_packages');
  })
  .then(function(packages) {
    pjson.directories.packages = path.relative(baseDir, path.resolve(packages));
    return ui.input('Enter config file path', pjson.configFile || base + 'config.js');
  })
  .then(function(configFile) {
    pjson.configFile = path.relative(baseDir, path.resolve(configFile))
    return prefixed;
  });
}

module.exports = PackageJSON;
