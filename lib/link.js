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
    // try to get endpoint, package
    return readJSON(path.resolve(dir, 'package.json'));
  })
  .then(function(_pjson) {
    pjson = _pjson || {};

    try {
      pkg = new PackageName(name);
    }
    catch(e) {
      throw 'Invalid package name to link into'
    }

    // set the endpoint, name or version from the package.json if necessary
    if (!pkg.name || !pkg.version || !pkg.endpoint)
      throw 'Linked name must include an endpoint and version, like github:some/package@version';
  })
  .then(function() {
    linkDir = path.resolve(config.HOME, '.jspm', 'linked', pkg.endpoint, pkg.exactPackage);
    try {
      if (fs.existsSync(linkDir)) {
        return (force ? Promise.resolve(true) : ui.confirm('`' + pkg.exactName + '` is already linked, are you sure you want to override it?', true))
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

    pjson = config.derivePackageConfig(pjson);

    return asp(rimraf)(linkDir)
    // create it
    .then(function() {
      if (pjson.directories) {
        if (pjson.directories.dist) {
          linkDir = path.resolve(linkDir, pjson.directories.dist);
          dir = path.resolve(dir, pjson.directories.dist);
        } 
        else if (pjson.directories.lib) {
          linkDir = path.resolve(linkDir, pjson.directories.lib);
          dir = path.resolve(dir, pjson.directories.lib);
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
      return package.processPackage(pkg, linkDir, pjson);
    })
    .then(function() {
      return;
    });
  })
  .then(function(aborted) {
    if (!aborted)
      ui.log('ok', 'Package linked.');
    else
      ui.log('info', 'Link operation aborted.');
  }, function(err) {
    ui.log('err', err.stack || err);
  });
}

exports.lookup = function(pkg) {
  var packageParts = pkg.package.split('/');
  var packagePart = packageParts.pop();
  var linkFolder = path.resolve(config.HOME, '.jspm', 'linked', pkg.endpoint, packageParts.join('/'));

  return asp(fs.readdir)(linkFolder)
  .then(function(files) {
    var versions = {};
    var hasVersions;
    files
    .filter(function(file) {
      return file.substr(0, file.lastIndexOf('@')) == packagePart;
    })
    .forEach(function(file) {
      hasVersions = true;
      versions[file.substr(file.lastIndexOf('@') + 1)] = { hash: 'hash' };
    });

    if (!hasVersions)
      throw 'No version match found for `' + pkg.exactName + '`';

    return function(version) {
      var lookupObj = package.getVersionMatch(version, versions);
      if (!lookupObj)
        return;

      return pkg.copy().setVersion(lookupObj.version);
    }
  }, function(err) {
    if (err.code == 'ENOENT')
      return;
    throw err;
  });
}

exports.symlink = function(pkg) {
  console.log('symlinking');
  var linkDir = path.resolve(config.HOME, '.jspm', 'linked', pkg.endpoint, pkg.exactPackage);
  var dir = path.resolve(config.pjson.packages, pkg.endpoint, pkg.exactPackage);
  var pjson;

  return asp(fs.readlink)(dir)
  .then(function(linkString) {
    if (linkString == linkDir)
      pkg.fresh = true;
  }, function(err) {
    if (err.code === 'ENOENT')
      return;
    if (err.code === 'EINVAL')
      return Promise.resolve(ui.confirm('`' + pkg.exactName + '` already installed, are you sure you want to link over it?', true))
      .then(function(remove) {
        if (!remove)
          throw 'Aborted.';
      })
      .then(function() {
        return asp(rimraf)(dir);
      });
    throw err;
  })
  .then(function() {
    if (pkg.fresh)
      return;
    return asp(mkdirp)(path.resolve(dir, '..'));
  })
  .then(function() {
    if (pkg.fresh)
      return;
    return asp(fs.symlink)(linkDir, dir, 'dir');
  })
  .then(function() {
    return readJSON(path.resolve(dir, 'package.json'));
  })
  .then(function(_pjson) {
    pjson = _pjson;
    if (pkg.fresh)
      return;
    return package.createMain(pkg, pjson, dir);
  })
  .then(function() {
    return package.processDeps(pjson.dependencies, pjson.registry);
  });
}

