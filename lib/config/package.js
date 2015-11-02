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
var ConfigFile = require('./file-base');
var path = require('path');
var Promise = require('rsvp').Promise;
var ui = require('../ui');
var processDeps = require('../common').processDeps;
var config = require('./index');

/*
 * Package.json Configuration Class
 *
 * Public Properties
 * - packages
 * - baseURL
 * - lib
 * - dist
 * - configFile
 * - dependencies
 * - peerDependencies
 * - devDependencies
 * - overrides
 *
 * Public Methods
 * - write
 * - prompt
 *
 */
module.exports = PackageConfig;
function PackageConfig(fileName) {
  this.file = new ConfigFile(fileName);

  this.dir = path.dirname(path.resolve(fileName));

  this.jspmPrefix = this.file.has(['jspm']);

  var baseURLValue = prefixedGetValue.call(this, ['directories', 'baseURL']) || '';
  if (baseURLValue[0] == '/' || baseURLValue.indexOf('//') != -1 || baseURLValue.indexOf('\\\\') != -1 || baseURLValue.indexOf(':') != -1) {
    ui.log('warn', 'Server baseURL should be a relative file path. Reverting to current project folder.');
    baseURLValue = '';
  }
  
  this.baseURL = path.resolve(this.dir, baseURLValue);

  var packagesValue = prefixedGetValue.call(this, ['directories', 'packages']);
  this.packages = packagesValue ? path.resolve(this.dir, packagesValue) : path.resolve(this.baseURL, 'jspm_packages');

  if (path.relative(this.baseURL, this.packages)[0] == '.')
    ui.log('warn', '%jspm_packages% must be specified in the package.json within the baseURL for paths to resolve correctly.');

  var configFileValue = prefixedGetValue.call(this, ['configFiles', 'jspm']) || prefixedGetValue.call(this, ['configFile']);
  this.configFiles = {};
  this.configFiles.jspm = configFileValue ? path.resolve(this.dir, configFileValue) : path.resolve(this.baseURL, 'jspm.js');

  this.overrides = prefixedGetObject.call(this, ['overrides'], true);

  var depsBase = [];
  if (this.file.has(['jspm', 'dependencies']) 
      || this.file.has(['jspm', 'peerDependencies']) 
      || this.file.has(['jspm', 'devDependencies']))
    depsBase.push('jspm');

  var registry = prefixedGetValue.call(this, ['registry']);

  // only read dependences if package.json is "jspm aware"
  this.jspmAware = this.jspmPrefix || this.file.has(['registry']);
  if (this.jspmAware) {
    this.dependencies = processDeps(this.file.getObject(depsBase.concat(['dependencies'])), registry);
    this.peerDependencies = processDeps(this.file.getObject(depsBase.concat(['peerDependencies'])), registry);
    this.devDependencies = processDeps(this.file.getObject(depsBase.concat(['devDependencies'])), registry);
  }
  else {
    this.dependencies = {};
    this.peerDependencies = {};
    this.devDependencies = {};
  }
}

PackageConfig.prototype.write = function() {
  // sync public properties with underlying file representation
  var depsBase = [];
  if (this.file.has(['jspm', 'dependencies']) 
      || this.file.has(['jspm', 'peerDependencies']) 
      || this.file.has(['jspm', 'devDependencies']))
    depsBase.push('jspm');

  var registry = prefixedGetValue.call(this, ['registry']);
  function writeDependencies(dependencies) {
    var outDependencies = {};

    Object.keys(dependencies).forEach(function(depName) {
      var dep = dependencies[depName];

      if (!dep)
        return;

      var depValue;

      if (dep.registry == registry) {
        if (depName == dep.package)
          depValue = dep.version || '*';
        else
          depValue = dep.exactPackage;
      }
      else {
        depValue = dep.exactName;
      }

      outDependencies[depName] = depValue;
    });

    return outDependencies;
  }

  this.file.setObject(depsBase.concat('dependencies'), writeDependencies(this.dependencies));
  this.file.setObject(depsBase.concat('peerDependencies'), writeDependencies(this.peerDependencies), true);
  this.file.setObject(depsBase.concat('devDependencies'), writeDependencies(this.devDependencies), true);

  prefixedSetObject.call(this, ['overrides'], this.overrides, true);

  var baseURL = toRelativePath.call(this, this.baseURL);

  prefixedSetValue.call(this, ['directories', 'baseURL'], baseURL, '');
  prefixedSetValue.call(this, ['directories', 'packages'], toRelativePath.call(this, this.packages), baseURL + (baseURL ? '/' : '') + 'jspm_packages');
  prefixedSetValue.call(this, ['configFiles', 'jspm'], toRelativePath.call(this, this.configFiles.jspm), baseURL + (baseURL ? '/' : '') + 'jspm.js');

  return this.file.write();
};

function prefixedSetObject(memberArray, object, clearIfEmpty) {
  var prefixed = ['jspm'].concat(memberArray);

  if (this.file.has(prefixed))
    this.file.setObject(prefixed, object);
  else if (this.file.has(memberArray))
    this.file.setObject(memberArray, object);
  else if (this.jspmPrefix)
    this.file.setObject(prefixed, object);
  else
    this.file.setObject(memberArray, object);
}

function prefixedSetValue(memberArray, value, defaultValue) {
  var prefixed = ['jspm'].concat(memberArray);

  // if already specified, continue to specify
  if (this.file.has(prefixed))
    this.file.setValue(prefixed, value);
  else if (this.file.has(memberArray))
    this.file.setValue(memberArray, value);

  // otherwise only specify if not default
  else if (this.jspmPrefix && value !== defaultValue)
    this.file.setValue(prefixed, value);
  else if (value !== defaultValue)
    this.file.setValue(memberArray, value);
}

function prefixedGetValue(memberArray) {
  return this.file.getValue(memberArray) || this.file.getValue(['jspm'].concat(memberArray));
}

function prefixedGetObject(memberArray, nested) {
  return this.file.getObject(memberArray, nested) || this.file.getObject(['jspm'].concat(memberArray), nested);
}

function toRelativePath(absPath) {
  return path.relative(this.dir, absPath).replace(/\\/g, '/');
}

PackageConfig.prototype.prompt = function() {
  var baseDir = path.dirname(this.file.fileName);
  var base;

  pjson.directories = pjson.directories || {};

  return Promise.resolve()
  .then(function() {
    return ui.input('Enter a %name% for the package (the name your package will be required as)', pjson.name || 'app');
  })
  .then(function() {
    return ui.input('Enter the %directories.baseURL% public server path (all modules need to be within this folder)', pjson.directories.baseURL || './');
  })
  .then(function(baseURL) {
    base = path.relative(process.cwd(), path.resolve(baseURL));
    baseURL = path.relative(baseDir, path.resolve(baseURL));
    if (!base)
      base = '.';
    base += path.sep;
    if (baseURL)
      pjson.directories.baseURL = baseURL;

    // directories.lib and directories.src are synonymous

    // NB list folders in baseURL, suggesting `dist`, `lib`, `src` and `app` if found, in that order (including directories.src as a guess)
    // if we are referencing right now in the config file the dist, then we should prompt the dist
    // if we have a lib and a dist, then prompt both (dist normally only gets prompted on compile)
    return ui.input('Enter the local package folder (%directories.lib% containing your package application code)', pjson.directories.lib || base + 'lib');
  })
  .then(function(appDir) {
    pjson.directories.lib = lib;
    return ui.input('Enter an optional custom %directories.jspmPackages% jspm packages folder (within %directories.baseURL%)', pjson.directories.packages || base + 'jspm_packages');
  })
  .then(function(packages) {
    pjson.directories.packages = path.relative(baseDir, path.resolve(packages));
    return ui.input('Enter an optional custom %configFiles.jspm% config file path', pjson.configFiles.jspm || base + 'config.js');
  })
  .then(function(configFile) {
    pjson.configFiles.jspm = path.relative(baseDir, path.resolve(configFile));
  })
  .then(function() {
    return prefixed;
  });
}