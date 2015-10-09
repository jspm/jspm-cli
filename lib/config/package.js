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
var path = require('path');
var extend = require('../common').extend;
var hasProperties = require('../common').hasProperties;
var Promise = require('rsvp').Promise;
var ui = require('../ui');
var fs = require('graceful-fs');
var asp = require('rsvp').denodeify;
var readJSONSync = require('../common').readJSONSync;
var alphabetize = require('../common').alphabetize;
var processDeps = require('../common').processDeps;
var stringify = require('../common').stringify;

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
 * peerDependencies
 * devDependencies
 * configFile
 * baseURL
 * packages
 * format
 * map
 * overrides
 *
 */
function PackageJSON(fileName) {
  this.fileName = fileName;
}

PackageJSON.prototype.read = function(prompts, sync) {
  if (this.__read)
    throw 'Package.json file already read';

  this.__read = true;
  var self = this;
  var pjson;

  var _pjson = readJSONSync(this.fileName);
  self.originalPjson = _pjson;

  self.jspmPrefix = true;
  if ((_pjson.registry || _pjson.jspm === true) && typeof _pjson.jspm != 'object')
    self.jspmPrefix = false;

  // if we have any dependencies in `jspm` prefix, assume other types are too
  if (_pjson.jspm && (_pjson.jspm.dependencies || _pjson.jspm.peerDependencies || _pjson.jspm.devDependencies)) {
    _pjson.jspm.dependencies = _pjson.jspm.dependencies || {};
    _pjson.jspm.peerDependencies = _pjson.jspm.peerDependencies || {};
    _pjson.jspm.devDependencies = _pjson.jspm.devDependencies || {};
  }

  // derive the jspm config from the 'jspm' property in the package.json
  // also sets the registry property if dependencies are jspm-prefixed
  pjson = config.derivePackageConfig(_pjson);

  self.pjson = pjson;

  // not already jspm-configured
  if (!_pjson.jspm && !_pjson.registry) {
    prompts = true;
    // dont read dependencies or devDependencies in this case
    delete pjson.dependencies;
    delete pjson.peerDependencies;
    delete pjson.devDependencies;
    // if dependencies already existing, override with empty dependencies
    if (self.originalPjson.dependencies)
      pjson.dependencies = {};
    if (self.originalPjson.peerDependencies)
      pjson.peerDependencies = {};
    if (self.originalPjson.devDependencies) 
      pjson.devDependencies = {};
  }

  prompts = prompts || (!_pjson.jspm && !_pjson.registry);

  if (prompts) {
    if (sync)
      throw 'Package.json file has not been initialized by jspm before. Run jspm init first.';
    return doInitPrompts(pjson, self.fileName, self.jspmPrefix)
    .then(function(prefixed) {
      self.jspmPrefix = prefixed;
      setDefaults();
      return true;
    });
  }

  setDefaults();

  function setDefaults() {
    self.dir = path.dirname(self.fileName);

    // populate defaults as we go
    var defaults = self.defaults = {};

    self.registry = pjson.registry;

    // only read dependencies when combined with a registry property
    self.dependencies = processDeps(pjson.dependencies, self.registry);
    self.peerDependencies = processDeps(pjson.peerDependencies, self.registry);
    self.devDependencies = processDeps(pjson.devDependencies, self.registry);

    defaults.baseURL = self.dir;
    self.baseURL = pjson.directories && pjson.directories.baseURL && path.resolve(self.dir, pjson.directories.baseURL) || defaults.baseURL;
    if (self.baseURL === path.resolve('/')) {
      ui.log('warn', 'Server baseURL should be a relative file path, reverting to `.`');
      self.baseURL = self.dir;
    }

    defaults.packages = path.resolve(self.baseURL, 'jspm_packages');

    defaults.main = path.join(self.baseURL, 'index');
    self.main = pjson.main || defaults.main;

    // NB can remove jspmPackages suport in time
    self.packages = pjson.directories && pjson.directories.packages && path.resolve(self.dir, pjson.directories.packages) ||
      pjson.directories && pjson.directories.jspmPackages && path.resolve(self.dir, pjson.directories.jspmPackages) || defaults.packages;

    defaults.configFile = path.resolve(self.baseURL, 'config.js');
    self.configFile = pjson.configFile && path.resolve(self.dir, pjson.configFile) || defaults.configFile;

    self.format = pjson.format;
    self.map = extend({}, pjson.map || {});

    self.overrides = extend({}, pjson.overrides || {});
  }

  // warn on invalid configs
  if (path.relative(self.baseURL, self.packages)[0] == '.')
    ui.log('warn', 'jspm_packages must be specified in the package.json within the baseURL for paths to resolve correctly.');
};

PackageJSON.prototype.write = function() {
  var self = this;
  var pjson = this.jspmPrefix ? {} : this.originalPjson;

  if (!this.jspmPrefix && self.registry !== 'jspm')
    pjson.jspm = true;

  // set the registry property
  if (this.jspmPrefix && this.registry !== 'jspm' || this.originalPjson.jspm && this.originalPjson.jspm.registry === 'jspm')
    pjson.registry = this.registry;

  var defaults = this.defaults;

  function set(property, value, setValue) {
    if (property in defaults && defaults[property] === value)
      delete pjson[property];
    else if (setValue !== undefined)
      pjson[property] = setValue;
    else if (value !== undefined)
      pjson[property] = value;
  }

  // only set properties that differ from the defaults
  // we set what we want the "derived" pjson to be first
  set('main', this.main);
  set('format', this.format);

  var directories = extend({}, this.pjson.directories);
  if (this.baseURL !== defaults.baseURL)
    directories.baseURL = winPath(path.relative(this.dir, this.baseURL)) || '.';
  else
    delete directories.baseURL;
  if (this.packages !== defaults.packages)
    directories.packages = winPath(path.relative(this.dir, this.packages)) || '.';
  else
    delete directories.packages;

  pjson.directories = alphabetize(directories);

  set('configFile', this.configFile, winPath(path.relative(this.dir, this.configFile)));    

  pjson.map = alphabetize(this.map);

  pjson.dependencies = writeDependencies(this.dependencies, this.registry);
  pjson.peerDependencies = writeDependencies(this.peerDependencies, this.registry);
  pjson.devDependencies = writeDependencies(this.devDependencies, this.registry);

  pjson.buildConfig = this.buildConfig;
  pjson.overrides = this.overrides;

  // remove empty overrides (nulling out for installed is assumed)
  Object.keys(pjson.overrides).forEach(function(key) {
    if (!hasProperties(pjson.overrides[key]))
      delete pjson.overrides[key];
  });

  // remove any empty object properties that aren't nulling a base property
  Object.keys(pjson).forEach(function(key) {
    var val = pjson[key];
    if (typeof val !== 'object' || hasProperties(val))
      return;
    if (!self.jspmPrefix || !(key in self.originalPjson))
      delete pjson[key];
  });

  // for jspm prefixing, work out what we need to get desired package.json
  if (this.jspmPrefix) {
    for (var p in pjson) {
      if (this.originalPjson[p] === pjson[p])
        delete pjson[p];
    }
    this.originalPjson.jspm = pjson;
  }

  // NB check that the file hasn't changed since we opened it and if so, prompt
  return asp(fs.writeFile)(this.fileName, stringify(this.originalPjson) + config.newLine);
};

function writeDependencies(dependencies, registry) {
  var outDependencies = {};
  var depValue;
  for (var dkey in dependencies) {
    if (!dependencies.hasOwnProperty(dkey))
      continue;
    var dep = dependencies[dkey];
    if (!dep)
      continue;
    if (dep.registry === registry) {
      if (dkey === dep.package)
        depValue = dep.version || '*';
      else
        depValue = dep.exactPackage;
    }
    else
      depValue = dep.exactName;

    outDependencies[dkey] = depValue;
  }
  return alphabetize(outDependencies);
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

module.exports = PackageJSON;
