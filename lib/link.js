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
var readJSON = require('./common').readJSON;
var package = require('./package');
var PackageName = require('./config/package-name');
var Promise = require('rsvp').Promise;
var asp = require('rsvp').denodeify;
var config = require('./config');
var ncp = require('ncp');
var path = require('path');
var ui = require('./ui');
var rimraf = require('rimraf');
var mkdirp = require('mkdirp');
var fs = require('graceful-fs');

exports.link = function(name, dir, force) {
  var pjson, linkDir, pkg;

  return Promise.resolve()
  .then(function() {
    // try to get registry, package
    return readJSON(path.resolve(dir, 'package.json'));
  })
  .then(function(_pjson) {
    try {
      pkg = new PackageName(name);
    }
    catch(e) {
      pkg = {};
    }

    var packageName = pkg.package || _pjson.jspm && _pjson.jspm.name || _pjson.name;
    var registry = pkg.registry || _pjson.jspm && _pjson.jspm.registry || _pjson.registry;
    var version = pkg.version || _pjson.jspm && _pjson.jspm.version || _pjson.version;

    if (!packageName)
      throw 'Package name not specified.';
    if (!registry)
      throw 'Package registry not specified.';
    if (!version)
      throw 'Package version not specified.';

    pkg = new PackageName(registry + ':' + packageName + '@' + version);

    return package.derivePackageConfig(pkg, _pjson);
  })
  .then(function(_pjson) {
    pjson = _pjson;

    linkDir = path.resolve(config.HOME, '.jspm', 'linked', pkg.registry, pkg.exactPackage);
    try {
      if (fs.existsSync(linkDir)) {
        return (force ? Promise.resolve(true) : ui.confirm('`' + pkg.exactName + '` is already linked, are you sure you want to override it (use -y to skip this prompt in future)?', true))
        .then(function(override) {
          return !override;
        });
      }
    }
    catch(e) {}
  })
  // clear the directory
  .then(function(abort) {
    if (abort)
      return true;

    return asp(rimraf)(linkDir)
    // create it
    .then(function() {
      if (pjson.directories) {
        if (pjson.directories.lib) {
          dir = path.resolve(dir, pjson.directories.lib);
          delete pjson.directories.lib;
        }
        if (pjson.directories.dist) {
          dir = path.resolve(dir, pjson.directories.dist);
          delete pjson.directories.dist;
        }
      }

      return asp(mkdirp)(linkDir);
    })
    // copy the files to the local cache folder
    .then(function() {
      return asp(ncp)(dir, linkDir);
    })
    // run the jspm operations on the folder to process it
    .then(function() {
      return package.processPackage(pkg, linkDir, pjson, function() {});
    })
    .then(function() {
      return asp(fs.writeFile)(path.resolve(linkDir, '.jspm.json'), JSON.stringify(pjson, null, 2));
    });
  })
  .then(function(aborted) {
    if (!aborted)
      ui.log('ok', 'Package linked as `' + pkg.exactName + '`');
    else
      ui.log('info', 'Link operation aborted.');
  }, function(err) {
    ui.log('err', err.stack || err);
  });
};

exports.lookup = function(pkg, edge) {
  var packageParts = pkg.package.split('/');
  var packagePart = packageParts.pop();
  var linkFolder = path.resolve(config.HOME, '.jspm', 'linked', pkg.registry, packageParts.join('/'));

  return asp(fs.readdir)(linkFolder)
  .then(function(files) {
    var versions = {};
    var hasVersions;
    files
    .filter(function(file) {
      return file.substr(0, file.lastIndexOf('@')) === packagePart;
    })
    .forEach(function(file) {
      hasVersions = true;
      versions[file.substr(file.lastIndexOf('@') + 1)] = { hash: 'hash' };
    });

    if (!hasVersions)
      throw 'No version match found for `' + pkg.exactName + '`';

    return function(version) {
      var lookupObj = package.getVersionMatch(version, versions, {edge: edge});
      if (!lookupObj)
        return;

      return pkg.copy().setVersion(lookupObj.version);
    };
  }, function(err) {
    if (err.code === 'ENOENT')
      throw 'No linked versions found for `' + pkg.name + '`';
    throw err;
  });
};

exports.symlink = function(pkg, downloadDeps) {
  var linkDir = path.resolve(config.HOME, '.jspm', 'linked', pkg.registry, pkg.exactPackage);
  var dir = path.resolve(config.pjson.packages, pkg.registry, pkg.exactPackage);
  var pjson;

  var fresh = false;

  return asp(fs.readlink)(dir)
  .then(function(linkString) {
    if (linkString === linkDir)
      return asp(fs.unlink)(dir);

    return Promise.resolve(ui.confirm('`' + pkg.exactName + '` already linked, are you sure you want to link over it?', true))
    .then(function(remove) {
      if (!remove)
        throw 'Aborted.';
      return asp(fs.unlink)(dir);
    });

  }, function(err) {
    if (err.code === 'ENOENT')
      return;
    if (err.code !== 'EINVAL' && err.code !== 'UNKNOWN')
      throw err;

    return Promise.resolve(ui.confirm('`' + pkg.exactName + '` already installed, are you sure you want to link over it?', true))
    .then(function(remove) {
      if (!remove)
        throw 'Aborted.';
      return asp(rimraf)(dir);
    });
  })
  .then(function() {
    return asp(mkdirp)(path.resolve(dir, '..'))
    .then(function() {
      return asp(fs.symlink)(linkDir, dir, 'junction');
    })
    .then(function() {
      return readJSON(path.resolve(dir, '.jspm.json'));
    })
    .then(function(_pjson) {
      pjson = config.derivePackageConfig(_pjson);
      return package.createMain(pkg, pjson, dir);
    });
  })
  .then(function() {
    downloadDeps(package.processDeps(pjson.dependencies, pjson.registry));
    return fresh;
  });
};
