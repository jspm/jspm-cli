/*
 *   Copyright 2014 Guy Bedford (http://guybedford.com)
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

/*
 * Package.json Configuration Class
 *
 * name
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

PackageJSON.prototype.read = function() {
  if (this.read_)
    throw "Package.json file already read";

  this.read_ = true;
  var self = this;

  return readJSON(this.fileName)
  .then(function(pjson) {
    return checkCreatePackageJSON(pjson);
  })
  .then(function(pjson) {
    self.originalPjson = pjson;

    // derive the jspm config from the 'jspm' property in the package.json
    // sets the registry property if dependencies are jspm-prefixed
    self.jspmPrefix = !!pjson.jspm;
    pjson = config.derivePackageConfig(pjson);

    self.dir = path.dirname(self.fileName);

    // populate defaults as we go
    var defaults = self.defaults = {};

    // create structured configuration with defaults
    defaults.name = 'app';
    self.name = pjson.name || defaults.name;

    defaults.main = self.name;
    self.main = pjson.main || defaults.main;

    self.registry = pjson.registry;
    self.dependencies = {};
    // only read dependencies when combined with a registry property
    if (pjson.dependencies && pjson.registry) {
      for (var d in pjson.dependencies) {
        var dep = pjson.dependencies[d];

        // version only
        if (dep.indexOf(':') == -1 && dep.indexOf('@') == -1)
          dep = d + '@' + dep;

        // convert into package objects
        self.dependencies[d] = new PackageName(dep);
      }
    }

    defaults.baseURL = self.dir;
    self.baseURL = pjson.directories && pjson.directories.baseURL && path.resolve(self.dir, pjson.directories.baseURL) || defaults.baseURL;

    defaults.lib = path.resolve(self.baseURL, 'lib');
    defaults.dist = path.resolve(self.baseURL, 'dist');
    defaults.packages = path.resolve(self.baseURL, 'jspm_packages');

    self.lib = pjson.directories && pjson.directories.lib && path.resolve(self.dir, pjson.directories.lib) || defaults.lib;
    self.dist = pjson.directories && pjson.directories.dist && path.resolve(self.dir, pjson.directories.dist) || defaults.dist;
    // NB can remove jspmPackages suport in time
    self.packages = pjson.directories && pjson.directories.packages && path.resolve(self.dir, pjson.directories.packages)
      || pjson.directories && pjson.directories.jspmPackages && path.resolve(self.dir, pjson.directories.jspmPackages) || defaults.packages;

    defaults.configFile = path.resolve(self.baseURL, 'config.js');
    self.configFile = pjson.configFile && path.resolve(self.dir, pjson.configFile) || defaults.configFile;
    
    self.format = pjson.format;
    self.map = extend({}, pjson.map || {});

    self.buildConfig = extend({}, pjson.buildConfig || {});
  });
}

PackageJSON.prototype.write = function() {
  var pjson = this.jspmPrefix ? {} : this.originalPjson;
  if (this.jspmPrefix)
    this.originalPjson.jspm = pjson;

  var defaults = this.defaults;

  // only set properties that differ from the defaults
  if (this.name != defaults.name)
    pjson.name = this.name;
  if (this.main != defaults.main)
    pjson.main = this.main;

  if (this.format)
    pjson.format = this.format;

  var directories = {};
  if (this.baseURL != defaults.baseURL)
    directories.baseURL = this.baseURL;
  if (this.lib != defaults.lib)
    directories.lib = this.lib;
  if (this.dist != defaults.dist)
    directories.dist = this.dist;
  if (this.packages != defaults.packages)
    directories.packages = this.packages;

  if (hasProperties(directories)) {
    for (var d in directories)
      directories[d] = path.relative(this.dir, directories[d]);
    pjson.directories = extend(pjson.directories || {}, directories);
  }

  if (this.configFile != defaults.configFile)
    pjson.configFile = path.relative(this.dir, this.configFile);

  pjson.map = this.map;
  if (!hasProperties(pjson.map))
    delete pjson.map;

  // reuse existing package.json dependencies if possible to maintain ordering
  pjson.dependencies = {};
  var depValue;
  for (var d in this.dependencies) {
    var dep = this.dependencies[d];
    var regName;
    // github:some/thing: x.y.z
    if (d == dep.name)
      depValue = dep.version;
    // name is exactly as in registry 
    // jquery: github:components/jquery@^x.y.z -> jquery: ^x.y.z
    else if (registryCache[d + '@' + dep.version] == dep.exactName || registryCache[d] == dep.name)
        depValue = dep.version;
    else
      depValue = this.dependencies[d].exactName;
    
    pjson.dependencies[d] = depValue;
  }
  if (!hasProperties(pjson.dependencies))
    delete pjson.dependencies;

  pjson.buildConfig = this.buildConfig;
  if (!hasProperties(pjson.buildConfig))
    delete pjson.buildConfig;

  // NB check that the file hasn't changed since we opened it and if so, prompt
  return asp(fs.writeFile)(this.fileName, JSON.stringify(this.originalPjson, null, 2) + '\n');
}

// can take an existing non-jspm package.json
function checkCreatePackageJSON(initialPjson) {
  initialPjson = initialPjson || {};

  // already jspm-optimized
  if (initialPjson.jspm || initialPjson.registry)
    return initialPjson;

  var pjson = initialPjson;
  var base;

  return Promise.resolve()
  .then(function() {
    return ui.confirm('Would you like jspm to prefix the jspm package.json properties under %jspm%?', true);
  })
  .then(function(prefix) {
    if (prefix)
      initialPjson.jspm = pjson = {};
    return ui.input('Enter a name for the project (optional)', initialPjson.name);
  })
  .then(function(name) {
    pjson.name = name;
    return ui.input('Enter baseURL path', '.');
  })
  .then(function(baseURL) {
    base = baseURL + path.sep;
    pjson.baseURL = baseURL;
    return ui.input('Enter project source folder', base + 'lib');
  })
  .then(function(lib) {
    pjson.directories = pjson.directories || {};
    pjson.directories.lib = lib;
    return ui.input('Enter project built folder (optional)');
  })
  .then(function(dist) {
    pjson.directories.dist = dist;
    return ui.input('Enter packages folder', base + 'jspm_packages');
  })
  .then(function(packages) {
    pjson.directories.packages = packages;
    return ui.input('Enter config file path', base + 'config.js');
  })
  .then(function(configFile) {
    pjson.configFile = configFile;
    return initialPjson;
  });
}

module.exports = PackageJSON;
