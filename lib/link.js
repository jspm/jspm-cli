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
var PackageName = require('./config/package-name');
var Promise = require('rsvp').Promise;
var asp = require('rsvp').denodeify;
var path = require('path');
var ui = require('./ui');
var rimraf = require('rimraf');
var mkdirp = require('mkdirp');
var fs = require('graceful-fs');
var install = require('./install');
var config = require('./config');

exports.link = function(dir, name, options) {
  var pkg = new PackageName(name || '');

  // first check the target dir exists
  return Promise.resolve()
  .then(function() {
    return new Promise(function(resolve) {
      fs.exists(dir, resolve);
    });
  })
  .then(function(exists) {
    if (!exists)
      throw 'Target directory %' + dir + '% doesn\'t exist.';

    return config.load();
  })

  // work out the link package target
  .then(function() {
    // NB if directories.lib is deprecated for installs (which may well be a great idea) then we
    // can continue to support it at the "publish" level and implement it in the symlinking here
    if (pkg.version && pkg.registry)
      return;

    return readJSON(path.resolve(dir, 'package.json'))
    .then(function(pjson) {
      if (!pkg.version)
        pkg.setVersion(pjson.version || 'link');
      if (!pkg.registry)
        pkg.setRegistry(pjson.registry != 'jspm' && pjson.registry || 'local');
      if (!pkg.package)
        pkg.setPackage(pjson.name || dir.split(path.sep).pop());
    });
  })
  // create the symlink
  .then(function() {
    dir = path.resolve(dir);
    var linkPath = pkg.getPath();

    return asp(fs.readlink)(pkg.getPath())
    .then(function(linkString) {
      if (path.resolve(path.dirname(linkPath), linkString) === dir)
        return asp(fs.unlink)(linkPath);

      return Promise.resolve(ui.confirm('`' + pkg.exactName + '` is already linked, are you sure you want to link over it?', true))
      .then(function(remove) {
        if (!remove)
          throw 'Aborted.';
        return asp(fs.unlink)(linkPath);
      });
    }, function(err) {
      if (err.code === 'ENOENT')
        return;
      if (err.code !== 'EINVAL' && err.code !== 'UNKNOWN')
        throw err;

      return Promise.resolve(ui.confirm('`' + pkg.exactName + '` is already installed, are you sure you want to link over it?', true))
      .then(function(remove) {
        if (!remove)
          throw 'Aborted.';
        return asp(rimraf)(linkPath);
      });
    })
    .then(function() {
      return asp(mkdirp)(path.dirname(linkPath));
    })
    .then(function() {
      return asp(fs.symlink)(path.relative(path.dirname(linkPath), dir), linkPath, 'junction');
    });
  })
  // now that we have linked the package, install it over itself to setup the config and install dependencies
  // package downloads pick up linked folder package.json files and reprocess them each time
  .then(function() {
    return install.install(pkg.package.split('/').pop(), pkg.exactName, { lock: true, quick: options.quick, force: options.force });
  })
  .then(function(aborted) {
    if (!aborted)
      ui.log('info', 'Run link again or %jspm install ' + pkg.exactName + '% to relink updates to the package configuration file.');
    else
      ui.log('info', 'Link operation aborted.');
  }, function(err) {
    ui.log('err', err.stack || err);
  });
};

