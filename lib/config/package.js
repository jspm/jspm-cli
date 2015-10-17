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
  this.configFile = configFileValue ? path.resolve(this.dir, configFileValue) : path.resolve(this.baseURL, config.loader.upgrade16 ? 'config.js' : 'jspm.js');

  // deprecate config file property for configFiles.jspm
  this.file.remove(['configFile']);

  var overrides = this.overrides = [];
  (prefixedGetProperties.call(this, ['overrides']) || []).forEach(function(prop) {
    overrides[prop.key] = prop.value;
  });

  var depsBase = [];
  if (this.file.has(['jspm', 'dependencies']) 
      || this.file.has(['jspm', 'peerDependencies']) 
      || this.file.has(['jspm', 'devDependencies']))
    depsBase.push('jspm');

  var registry = prefixedGetValue.call(this, ['registry']);

  // only read dependences if package.json is "jspm aware"
  var jspmAware = this.jspmPrefix || this.file.has(['registry']);
  if (jspmAware) {
    this.dependencies = processDeps(this.file.getObject(depBase.concat(['dependencies'])), registry);
    this.peerDependencies = processDeps(this.file.getObject(depBase.concat(['peerDependencies'])), registry);
    this.devDependencies = processDeps(this.file.getObject(depBase.concat(['devDependencies'])), registry);
  }
  else {
    this.dependencies = {};
    this.peerDependencies = {};
    this.devDependencies = {};
  }

  if (!jspmAware || prompts)
    return doPrompts()

  /* if (prompts) {
    if (sync)
      throw 'Package.json file has not been initialized by jspm before. Run jspm init first.';
    return doInitPrompts(pjson, self.fileName, self.jspmPrefix)
    .then(function(prefixed) {
      self.jspmPrefix = prefixed;
      setDefaults();
      return true;
    });
  } */
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
  }

  this.file.setObject(depsBase.concat('dependencies'), writeDependencies(this.dependencies));
  this.file.setObject(depsBase.concat('peerDependencies'), writeDependencies(this.peerDependencies), true);
  this.file.setObject(depsBase.concat('devDependencies'), writeDependencies(this.devDependencies), true);

  prefixedSetObject.call(this, ['overrides'], this.overrides, true);

  var baseURL = toRelativePath.call(this, this.baseURL);

  prefixedSetValue.call(this, ['directories', 'baseURL'], baseURL, '');
  prefixedSetValue.call(this, ['directories', 'packages'], toRelativePath.call(this, this.packages), baseURL + (baseURL ? '/' : '') + 'jspm_packages');
  prefixedSetValue.call(this, ['configFiles', 'jspm'], toRelativePath.call(this, this.configFile), baseURL + (baseURL ? '/' : '') + 'jspm.js');

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

function prefixedGetProperties(memberArray) {
  return this.file.getProperties(memberArray) || this.file.getProperties(['jspm'].concat(memberArray));
}

function toRelativePath(absPath) {
  return path.relative(this.dir, absPath).replace(/\\/g, '/');
}

PackageConfig.prototype.prompt = function() {
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
    return ui.input('Enter jspm packages folder', pjson.directories.packages || base + 'jspm_packages');
  })
  .then(function(packages) {
    pjson.directories.packages = path.relative(baseDir, path.resolve(packages));
    return ui.input('Enter config file path', pjson.configFile || base + 'config.js');
  })
  .then(function(configFile) {
    pjson.configFile = path.relative(baseDir, path.resolve(configFile));

    return ui.confirm('Create a package configuration for this project?', true);
  })
  .then(function(createPkg) {
    if (!createPkg)
      return;

    return ui.input('Enter a name for the current package', pjson.name || 'app')
    .then(function(appName) {
      pjson.name = appName;
      return ui.input('Enter the path to the folder containing the current package source code', pjson.directories.lib || base + 'src');
    })
    .then(function(libDir) {
      pjson.directories.lib = path.relative(baseDir, path.resolve(libDir));

      function configureFormat() {
        return ui.input('Enter the module format of the package - ESM (ES2015 module), CJS or AMD', pjson.format || 'esm')
        .then(function(format) {
          format = format.toLowerCase();
          if (format == 'system')
            format = 'register';
          if (['esm', 'cjs', 'amd', 'global', 'register'].indexOf(format) == -1)
            return configureFormat();
          return format;
        });
      }

      return configureFormat();
    })
    .then(function(format) {
      pjson.format = format;
      return ui.input('Enter the main entry point of the package within %' + pjson.directories.lib + '%', pjson.main || pjson.name + '.js');
    })
    .then(function(main) {
      pjson.main = main;
    });
  })
  .then(function() {
    return prefixed;
  });
}