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

var path = require('path');
var nodeSemver = require('semver');
var ui = require('./ui');
var config = require('./config');
var registry = require('./registry');
var PackageName = require('./package-name');
var fs = require('graceful-fs');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var asp = require('bluebird').Promise.promisify;
var System = require('systemjs');
var HOME = require('./common').HOME;
var Promise = require('bluebird');


var core = module.exports;

// we always download the latest semver compatible version
var systemVersion = require('../package.json').dependencies.systemjs;

if (systemVersion.match(/^systemjs\/systemjs\#/))
  systemVersion = systemVersion.substr(systemVersion.indexOf('#') + 1);

exports.run = function(moduleName, view, production) {
  return config.load(false, true)
  .then(function() {
    System.config(config.getLoaderConfig());
    if (production)
      System.config({ production: true });
    return System.import(moduleName)
    .then(function(m) {
      if (view)
        console.log(m);
    });
  })
  .catch(function(e) {
    ui.log('err', e.stack || e);
  });
};

// check and download module loader files
exports.checkDlLoader = function() {
  return config.load()
  .then(function() {
    return asp(fs.readFile)(path.resolve(config.pjson.packages, '.loaderversions'));
  })
  .catch(function(err) {
    if (err.code === 'ENOENT')
      return '';
    throw err;
  })
  .then(function(cacheVersions) {
    if (cacheVersions.toString() !== systemVersion)
      return exports.dlLoader();

    // even if version file is fresh, still check files exist
    return asp(fs.readdir)(config.pjson.packages)
    .catch(function(err) {
      if (err.code === 'ENOENT')
        return [];
      throw err;
    })
    .then(function(files) {
      if (files.indexOf('system.js') === -1)
        return exports.dlLoader();
    });
  });
};

// mini registry API usage implementation
var loaderFilesCacheDir = path.join(HOME, '.jspm', 'loader-files');

function dl(name, repo, version) {
  var pkg = new PackageName(repo);
  var endpoint = registry.load(pkg.registry);
  var vMatch, vMatchLookup;
  var dlDir = path.resolve(loaderFilesCacheDir, name);

  return endpoint.lookup(pkg.package)
  .then(function(lookup) {
    if (!(nodeSemver.validRange(version)))
      vMatch = version;
    else
      vMatch = Object.keys(lookup.versions)
      .filter(nodeSemver.valid)
      .sort(nodeSemver.compare).reverse()
      .filter(function(v) {
        return nodeSemver.satisfies(v, version);
      })[0];

    vMatchLookup = lookup.versions[vMatch];

    return asp(fs.readFile)(path.resolve(dlDir, '.hash'))
    .then(function(_hash) {
      return _hash.toString() === vMatchLookup.hash;
    }, function (e) {
      if (e.code === 'ENOENT')
        return;
      throw e;
    });
  })
  .then(function(cached) {
    if (cached)
      return;

    return endpoint.download(pkg.package, vMatch, vMatchLookup.hash, vMatchLookup.meta, dlDir)
    .then(function() {
      return fs.writeFile(path.resolve(dlDir, '.hash'), vMatchLookup.hash);
    });
  })
  .then(function() {
    return vMatch;
  });
}

// file copy implementation
function cp(file, name, transform) {
  return asp(fs.readFile)(path.resolve(loaderFilesCacheDir, file)).then(function(source) {
    if (transform)
      source = transform(source.toString());
    ui.log('info', '  `' + name + '`');
    return asp(fs.writeFile)(path.resolve(config.pjson.packages, name), source);
  });
}

exports.dlLoader = function(unminified, edge, latest) {
  ui.log('info', 'Looking up loader files...');
  var min = unminified ? '.src' : '';

  var using = {};

  return config.load()
  .then(function() {
    return asp(mkdirp)(config.pjson.packages);
  })
  .then(function() {
    // delete old versions
    return asp(fs.readdir)(config.pjson.packages);
  })
  .then(function(files) {
    return Promise.all(files.filter(function(file) {
      return file.match(/^(system-csp|system-csp-production|system|es6-module-loader|system-polyfills)/);
    }).map(function(file) {
      return asp(fs.unlink)(path.resolve(config.pjson.packages, file));
    }));
  })
  .then(function() {
    return dl('systemjs', 'github:systemjs/systemjs', !edge ? (!latest ? systemVersion : '^' + systemVersion) : 'master')
    .then(function(version) {
      using.system = version;
      return Promise.all([
        cp('systemjs/dist/system' + min + '.js', 'system.js'),
        unminified || cp('systemjs/dist/system.src.js', 'system.src.js'),
        unminified || cp('systemjs/dist/system.js.map', 'system.js.map'),
        // cp('systemjs/dist/system-csp-production' + min + '.js', 'system-csp-production.js'),
        // unminified || cp('systemjs/dist/system-csp-production.src.js', 'system-csp-production.src.js'),
        // unminified || cp('systemjs/dist/system-csp-production.js.map', 'system-csp-production.js.map'),
        cp('systemjs/dist/system-polyfills' + min + '.js', 'system-polyfills.js'),
        unminified || cp('systemjs/dist/system-polyfills.src.js', 'system-polyfills.src.js'),
        unminified || cp('systemjs/dist/system-polyfills.js.map', 'system-polyfills.js.map')
      ]);
    });
  })
  .then(function() {
    ui.log('info', '\nUsing loader versions:');
    ui.log('info', '  `systemjs@' + using.system + '`');

    return asp(fs.writeFile)(path.resolve(config.pjson.packages, '.loaderversions'), systemVersion);
  })
  .then(function() {
    ui.log('ok', 'Loader files downloaded successfully');
  }, function(err) {
    ui.log('err', err);
    ui.log('err', 'Error downloading loader files.');
    throw err;
  });
};

exports.init = function init(basePath, ask) {
  if (basePath)
    process.env.jspmConfigPath = path.resolve(basePath, 'package.json');
  var relBase = path.relative(process.cwd(), path.dirname(process.env.jspmConfigPath));
  if (relBase !== '')
    ui.log('info', 'Initializing package at `' + relBase + '/`\nUse %jspm init .% to intialize into the current folder.');
  return config.load(ask)
  .then(config.save)
  .then(function() {
    ui.log('info', '');
    ui.log('ok', 'Verified package.json at %' + path.relative(process.cwd(), config.pjsonPath) + '%\nVerified config files at %' + path.relative(process.cwd(), config.pjson.configFile) + '% and %' + path.relative(process.cwd(), config.pjson.configFileBrowser) + '%');
  })
  .then(function() {
    return core.checkDlLoader();
  })
  .catch(function(err) {
    ui.log('err', err && err.stack || err);
  });
};

exports.cacheClear = function() {
  var jspmDir = path.resolve(HOME, '.jspm'),
      packagesCacheDir = path.join(jspmDir, 'packages'),
      loaderCacheDir = path.join(jspmDir, 'loader-files'),
      files, filesLength, fileName, i;

  // Clear loader files
  if (fs.existsSync(loaderCacheDir))
    rimraf.sync(loaderCacheDir);
  ui.log('ok', 'Loader file cache cleared.');

  // Clear packages cache folder
  if (fs.existsSync(packagesCacheDir))
    rimraf.sync(packagesCacheDir);
  ui.log('ok', 'Package cache cleared.');

  // Clear registry cache folders
  files = fs.readdirSync(jspmDir);
  filesLength = files.length;
  for (i = 0; i < filesLength; i++) {
    fileName = files[i];
    if (fileName.endsWith('-cache')) {
      rimraf.sync(path.join(jspmDir, fileName));
      ui.log('ok', '%' + fileName.substr(0, fileName.length - '-cache'.length) + '% cache cleared.');
    }
  }

  ui.log('warn', 'All caches cleared.');
  ui.log('info', 'Please post an issue if you suspect the cache isn\'t invalidating properly.');
  ui.log('info', '%jspm install -f% is equivalent to running a cache clear for that specific package tree.');
};
