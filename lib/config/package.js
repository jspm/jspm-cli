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
var path = require('path');
var ui = require('../ui');
var processDeps = require('../common').processDeps;
var hasProperties = require('../common').hasProperties;

/*
 * Package.json Configuration Class
 *
 * Public Properties
 * - name
 * - packages
 * - baseURL
 * - lib
 * - dist
 * - configFile
 * - configFileBrowser
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
  this.file = new ConfigFile(fileName, [
    'name',
    ['directories', [
      'baseURL',
      'packages',
      'lib',
      'dist'
    ]],
    'configFile',
    ['configFiles', [
      'jspm',
      'jspm:browser'
    ]],
    'registry',
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'overrides',
    ['jspm', [
      'name',
      ['directories', [
        'baseURL',
        'packages',
        'lib',
        'dist'
      ]],
      'configFile',
      ['configFiles', [
        'jspm',
        'jspm:browser'
      ]],
      'registry',
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'overrides'
    ]]
  ]);

  this.dir = path.dirname(path.resolve(fileName));

  this.name = prefixedGetValue.call(this, ['name'], 'string') || '';

  this.jspmPrefix = this.file.has(['jspm']);
  this.jspmAware = this.jspmPrefix || this.file.has(['registry']);

  // jspm: true is allowed
  try {
    if (this.file.getValue(['jspm']))
      this.jspmPrefix = false;
  }
  catch(e) {}

  if (!this.jspmAware)
    this.file.setObject(['jspm'], {});

  var baseURLValue = prefixedGetValue.call(this, ['directories', 'baseURL'], 'string') || '';
  if (baseURLValue[0] == '/' || baseURLValue.indexOf('//') != -1 || baseURLValue.indexOf('\\\\') != -1 || baseURLValue.indexOf(':') != -1) {
    ui.log('warn', 'Server baseURL should be a relative file path. Reverting to current project folder.');
    baseURLValue = '';
  }
  
  this.baseURL = path.resolve(this.dir, baseURLValue);

  this.populateDefaultPaths();

  this.overrides = prefixedGetObject.call(this, ['overrides'], true) || {};

  var depsBase = [];
  if (this.file.has(['jspm', 'dependencies']) || 
      this.file.has(['jspm', 'peerDependencies']) || 
      this.file.has(['jspm', 'devDependencies']))
    depsBase.push('jspm');

  var registry = prefixedGetValue.call(this, ['registry'], 'string');

  // only read dependences if package.json is "jspm aware"
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

PackageConfig.prototype.populateDefaultPaths = function() {
  var packagesValue = prefixedGetValue.call(this, ['directories', 'packages'], 'string');
  this.packages = packagesValue ? path.resolve(this.dir, packagesValue) : path.resolve(this.baseURL, 'jspm_packages');

  var libValue = prefixedGetValue.call(this, ['directories', 'lib'], 'string');
  this.lib = libValue ? path.resolve(this.dir, libValue) : path.resolve(this.baseURL, 'lib');

  var distValue = prefixedGetValue.call(this, ['directories', 'dist'], 'string');
  this.dist = distValue ? path.resolve(this.dir, distValue) : path.resolve(this.baseURL, 'dist');

  if (path.relative(this.baseURL, this.packages)[0] == '.')
    ui.log('warn', '%directories.packages% in the package.json must be within the baseURL for paths to resolve correctly.');

  var configFileValue = prefixedGetValue.call(this, ['configFiles', 'jspm'], 'string') || prefixedGetValue.call(this, ['configFile'], 'string');
  this.configFile = configFileValue ? path.resolve(this.dir, configFileValue) : path.resolve(this.baseURL, 'jspm.js');
  this.configFileBrowser = prefixedGetValue.call(this, ['configFiles', 'browser'], 'string') || path.resolve(path.dirname(this.configFile), 'jspm.browser.js');
};

PackageConfig.prototype.write = function() {
  // sync public properties with underlying file representation
  var depsBase = [];
  if (this.file.has(['jspm', 'dependencies']) || 
      this.file.has(['jspm', 'peerDependencies']) || 
      this.file.has(['jspm', 'devDependencies']))
    depsBase.push('jspm');

  var registry = prefixedGetValue.call(this, ['registry'], 'string');
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

  prefixedSetValue.call(this, ['name'], this.name, '');

  if (hasProperties(this.dependencies))
    this.file.setObject(depsBase.concat('dependencies'), writeDependencies(this.dependencies));
  this.file.setObject(depsBase.concat('peerDependencies'), writeDependencies(this.peerDependencies), true);
  this.file.setObject(depsBase.concat('devDependencies'), writeDependencies(this.devDependencies), true);

  prefixedSetObject.call(this, ['overrides'], this.overrides, true);

  var baseURL = toRelativePath.call(this, this.baseURL);
  var baseURLPath = baseURL + (baseURL ? '/' : '');

  prefixedSetValue.call(this, ['directories', 'baseURL'], baseURL || '.', '.');
  prefixedSetValue.call(this, ['directories', 'packages'], toRelativePath.call(this, this.packages), baseURLPath + 'jspm_packages');
  prefixedSetValue.call(this, ['directories', 'lib'], toRelativePath.call(this, this.lib), baseURLPath + 'lib');
  prefixedSetValue.call(this, ['directories', 'dist'], toRelativePath.call(this, this.dist), baseURLPath + 'dist');

  prefixedSetValue.call(this, ['configFiles', 'jspm'], toRelativePath.call(this, this.configFile), baseURLPath + 'jspm.js');
  prefixedSetValue.call(this, ['configFiles', 'jspm:browser'], toRelativePath.call(this, this.configFileBrowser), baseURLPath + 'jspm.browser.js');

  return this.file.write();
};

function prefixedSetObject(memberArray, object, clearIfEmpty) {
  var prefixed = ['jspm'].concat(memberArray);

  if (this.file.has(prefixed))
    this.file.setObject(prefixed, object, clearIfEmpty);
  else if (this.file.has(memberArray))
    this.file.setObject(memberArray, object, clearIfEmpty);
  else if (this.jspmPrefix)
    this.file.setObject(prefixed, object, clearIfEmpty);
  else
    this.file.setObject(memberArray, object, clearIfEmpty);
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

function prefixedGetValue(memberArray, type) {
  return this.file.getValue(memberArray, type) || this.jspmPrefix && this.file.getValue(['jspm'].concat(memberArray), type);
}

function prefixedGetObject(memberArray, nested) {
  return this.file.getObject(memberArray, nested) || this.jspmPrefix && this.file.getObject(['jspm'].concat(memberArray), nested);
}

function toRelativePath(absPath) {
  return path.relative(this.dir, absPath).replace(/\\/g, '/');
}