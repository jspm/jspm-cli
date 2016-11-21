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
var path = require('path');
var ui = require('../ui');
var processDeps = require('../common').processDeps;
var hasProperties = require('../common').hasProperties;
var config = require('./index');

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
 * - configFileDev
 * - configFileBrowser
 * - configFileNode
 * - dependencies
 * - peerDependencies
 * - devDependencies
 * - overrides
 * - hooks
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
    'main',
    ['directories', [
      'lib',
      'dist',
      'baseURL',
      'packages'
    ]],
    ['configFiles', [
      'jspm',
      'jspm:dev',
      'jspm:browser',
      'jspm:node'
    ]],
    'configFile',
    'registry',
    'dependencies',
    'devDependencies',
    'peerDependencies',
    ['jspm', [
      'name',
      'main',
      ['directories', [
        'lib',
        'dist',
        'baseURL',
        'packages'
      ]],
      ['configFiles', [
        'jspm',
        'jspm:dev',
        'jspm:browser',
        'jspm:node'
      ]],
      'configFile',
      'registry',
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'overrides',
      ['hooks', [
        'preinstall',
        'postinstall'
      ]]
    ]],
    'overrides',
    ['hooks', [
        'preinstall',
        'postinstall'
    ]]
  ]);

  this.dir = path.dirname(path.resolve(fileName));

  this.jspmPrefix = this.file.has(['jspm']);
  this.jspmAware = this.jspmPrefix || this.file.has(['registry']);

  // jspm: true is allowed
  try {
    if (this.file.getValue(['jspm']))
      this.jspmPrefix = false;
  }
  catch(e) {}

  if (!this.jspmAware)
    this.jspmPrefix = true;

  this.name = prefixedGetValue.call(this, ['name'], 'string') || !this.jspmAware && 'app';
  this.hooks = prefixedGetObject.call(this, ['hooks'], true);

  var baseURLValue = prefixedGetValue.call(this, ['directories', 'baseURL'], 'string') || '';
  if (baseURLValue[0] == '/' || baseURLValue.indexOf('//') != -1 || baseURLValue.indexOf('\\\\') != -1 || baseURLValue.indexOf(':') != -1) {
    ui.log('warn', 'Server baseURL should be a relative file path. Reverting to current project folder.');
    baseURLValue = '';
  }

  this.baseURL = path.resolve(this.dir, baseURLValue);

  this.populateDefaultPaths();

  this.overrides = prefixedGetObject.call(this, ['overrides'], true) || {};

  this.depsPrefixed = this.jspmPrefix;
  if (this.jspmAware &&
      !this.file.has(['jspm', 'dependencies']) &&
      !this.file.has(['jspm', 'peerDependencies']) &&
      !this.file.has(['jspm', 'devDependencies']) &&
      (this.file.has(['dependencies']) ||
      this.file.has(['peerDependencies']) ||
      this.file.has(['devDependencies'])))
    this.depsPrefixed = false;

  var depsBase = this.depsPrefixed ? ['jspm'] : [];

  var registry = prefixedGetValue.call(this, ['registry'], 'string');

  // only read dependences if package.json is "jspm aware"
  if (this.jspmAware) {
    this.dependencies = processDeps(this.file.getObject(depsBase.concat(['dependencies'])), registry);
    this.peerDependencies = processDeps(this.file.getObject(depsBase.concat(['peerDependencies'])), registry);
    this.devDependencies = processDeps(this.file.getObject(depsBase.concat(['devDependencies'])), registry);

    // dedupe deps - must be either a devDependency, dependency or peerDependency
    var self = this;
    Object.keys(this.devDependencies).forEach(function(dep) {
      if (self.peerDependencies && self.peerDependencies[dep] || self.dependencies && self.dependencies[dep])
        delete self.devDependencies[dep];
    });
    Object.keys(this.dependencies).forEach(function(dep) {
      if (self.peerDependencies && self.peerDependencies[dep])
        delete self.dependencies[dep];
    });
}
  else {
    this.dependencies = {};
    this.peerDependencies = {};
    this.devDependencies = {};
  }
}

PackageConfig.prototype.populateDefaultPaths = function() {
  var self = this;
  function populateDefaultPath(name, prop, defaultPath) {
    var p = prefixedGetValue.call(self, prop, 'string');
    self[name] = typeof p == 'string' ? path.resolve(self.dir, p) : defaultPath;
  }

  populateDefaultPath('lib', ['directories', 'lib'], path.resolve(this.baseURL, 'src'));
  populateDefaultPath('dist', ['directories', 'dist'], path.resolve(this.baseURL, 'dist'));
  populateDefaultPath('packages', ['directories', 'packages'], path.resolve(this.baseURL, 'jspm_packages'));

  // backwards compat for configFile: 'config.js' property
  var configFileValue = prefixedGetValue.call(this, ['configFile'], 'string');
  populateDefaultPath('configFile', ['configFiles', 'jspm'], configFileValue ? path.resolve(this.dir, configFileValue) : path.resolve(this.baseURL, 'jspm.config.js'));
  populateDefaultPath('configFileDev', ['configFiles', 'jspm:dev'], path.dirname(this.configFile) + path.sep + 'jspm.dev.js');
  populateDefaultPath('configFileBrowser', ['configFiles', 'jspm:browser'], path.dirname(this.configFile) + path.sep + 'jspm.browser.js');
  populateDefaultPath('configFileNode', ['configFiles', 'jspm:node'], path.dirname(this.configFile) + path.sep + 'jspm.node.js');

  if (config.loader)
    config.loader.file.rename(this.configFile);
};

PackageConfig.prototype.setPrefix = function(jspmPrefix) {
  // removes the "jspm" property in the package.json
  // flattening it down the to base-level
  if (this.jspmPrefix && this.file.has(['jspm']) && !jspmPrefix) {
    var jspmProperties = this.file.getProperties(['jspm']);
    var baseProperties = this.file.getProperties([]);

    var depsPrefixed = this.depsPrefixed;
    if (depsPrefixed) {
      this.file.remove(['dependencies']);
      this.file.remove(['peerDependencies']);
      this.file.remove(['devDependencies']);
    }

    var self = this;

    jspmProperties.forEach(function(prop) {
      self.file.remove([prop.key]);
      baseProperties.push(prop);
    });

    this.file.remove(['jspm']);

    this.file.changed = true;
  }
  else if (!this.jspmPrefix && jspmPrefix) {
    if (this.file.getValue(['jspm']))
      this.file.remove(['jspm']);
  }
  this.jspmPrefix = this.depsPrefixed = jspmPrefix;
};

PackageConfig.prototype.write = function() {
  // sync public properties with underlying file representation
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

  if (this.name) {
    prefixedSetValue.call(this, ['name'], this.name);
  }
  else {
    this.file.remove(['name']);
    this.file.remove(['jspm', 'name']);
  }

  var depsBase = this.depsPrefixed ? ['jspm'] : [];

  if (this.main)
    prefixedSetValue.call(this, ['main'], this.main);

  this.file.setObject(depsBase.concat('dependencies'), writeDependencies(this.dependencies), !this.file.has(['dependencies']) && !this.file.has(['jspm', 'dependencies']));
  this.file.setObject(depsBase.concat('peerDependencies'), writeDependencies(this.peerDependencies), !this.file.has(['peerDependencies']) && !this.file.has(['jspm', 'peerDependencies']));
  this.file.setObject(depsBase.concat('devDependencies'), writeDependencies(this.devDependencies), !this.file.has(['devDependencies']) && !this.file.has(['jspm', 'devDependencies']));

  var self = this;
  Object.keys(this.overrides).forEach(function(o) {
    if (!hasProperties(self.overrides[o]))
      delete self.overrides[o];
  });
  prefixedSetObject.call(this, ['overrides'], this.overrides, true);

  var baseURL = toRelativePath.call(this, this.baseURL);
  var baseURLPath = baseURL + (baseURL ? '/' : '');

  prefixedSetValue.call(this, ['directories', 'baseURL'], baseURL || '.', '.');
  prefixedSetValue.call(this, ['directories', 'packages'], toRelativePath.call(this, this.packages), baseURLPath + 'jspm_packages');
  prefixedSetValue.call(this, ['directories', 'lib'], toRelativePath.call(this, this.lib) || '.', baseURLPath + 'src');
  prefixedSetValue.call(this, ['directories', 'dist'], toRelativePath.call(this, this.dist), baseURLPath + 'dist');

  prefixedSetValue.call(this, ['configFiles', 'jspm'], toRelativePath.call(this, this.configFile), baseURLPath + 'jspm.config.js');

  var configDir = toRelativePath.call(this, path.dirname(this.configFile));
  configDir = configDir + (configDir ? '/' : '');

  if (this.configFileDev)
    prefixedSetValue.call(this, ['configFiles', 'jspm:dev'], toRelativePath.call(this, this.configFileDev), configDir + 'jspm.dev.js');
  else
    this.file.remove(['jspm', 'configFiles', 'jspm:dev']) && this.file.remove(['configFiles', 'jspm:dev']);

  if (this.configFileBrowser)
    prefixedSetValue.call(this, ['configFiles', 'jspm:browser'], toRelativePath.call(this, this.configFileBrowser), configDir + 'jspm.browser.js');
  else
    this.file.remove(['jspm', 'configFiles', 'jspm:browser']) && this.file.remove(['configFiles', 'jspm:browser']);

  if (this.configFileNode)
    prefixedSetValue.call(this, ['configFiles', 'jspm:node'], toRelativePath.call(this, this.configFileNode), configDir + 'jspm.node.js');
  else
    this.file.remove(['jspm', 'configFiles', 'jspm:node']) && this.file.remove(['configFiles', 'jspm:node']);

  // always ensure we save as jspm aware
  if (!this.file.has(['jspm']) && !this.file.has(['registry'])) {
    if (this.jspmPrefix)
      this.file.setObject(['jspm'], {});
    else
      this.file.setValue(['jspm'], true);
  }

  return this.file.write();
};

function prefixedSetObject(memberArray, object, clearIfEmpty) {
  var prefixed = ['jspm'].concat(memberArray);

  var newPrefixed = this.jspmPrefix && !this.jspmAware;

  if (!newPrefixed && this.file.has(prefixed))
    this.file.setObject(prefixed, object, clearIfEmpty);
  else if (!newPrefixed && this.file.has(memberArray))
    this.file.setObject(memberArray, object, clearIfEmpty);
  else if (this.jspmPrefix)
    this.file.setObject(prefixed, object, clearIfEmpty);
  else
    this.file.setObject(memberArray, object, clearIfEmpty);
}

function prefixedSetValue(memberArray, value, defaultValue) {
  var prefixed = ['jspm'].concat(memberArray);

  var newPrefixed = this.jspmPrefix && !this.jspmAware;

  // if already specified, continue to specify
  if (!newPrefixed && this.file.has(prefixed))
    this.file.setValue(prefixed, value);
  else if (!newPrefixed && this.file.has(memberArray))
    this.file.setValue(memberArray, value);

  // otherwise only specify if not default
  else if (this.jspmPrefix && value !== defaultValue)
    this.file.setValue(prefixed, value);
  else if (value !== defaultValue)
    this.file.setValue(memberArray, value);
}

function prefixedGetValue(memberArray, type) {
  var value;
  if (this.jspmPrefix)
    value = this.file.getValue(['jspm'].concat(memberArray), type);
  if (typeof value == 'undefined')
    value = this.file.getValue(memberArray, type);
  return value;
}

function prefixedGetObject(memberArray, nested) {
  return this.jspmPrefix && this.file.getObject(['jspm'].concat(memberArray), nested) || this.file.getObject(memberArray, nested);
}

function toRelativePath(absPath) {
  return path.relative(this.dir, absPath).replace(/\\/g, '/');
}
