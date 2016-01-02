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
var readJSON = require('./common').readJSON;
var PackageName = require('./package-name');
var asp = require('bluebird').Promise.promisify;
var path = require('path');
var ui = require('./ui');
var rimraf = require('rimraf');
var mkdirp = require('mkdirp');
var fs = require('graceful-fs');
var install = require('./install');
var config = require('./config');
var Promise = require('bluebird');
var registry = require('./registry');

exports.link = function(dir, name, options) {
  var pkg = new PackageName(name || '');
  var pjson;

  dir = path.resolve(dir);

  // first check the target dir exists
  return Promise.resolve()
  .then(function() {
    return new Promise(function(resolve) {
      fs.exists(dir, resolve);
    });
  })
  .then(function(exists) {
    if (!exists)
      throw 'Link target directory %' + dir + '% doesn\'t exist.';

    return config.load();
  })
  .then(function() {
    return readJSON(path.resolve(dir, 'package.json'))
    .then(function(_pjson) {
      pjson = _pjson;
    });
  })

  // work out the link package target
  .then(function() {
    if (!pkg.registry)
      pkg.setRegistry(pjson.registry != 'jspm' && pjson.registry || 'local');

    // the name is taken as the pjson name property or the directory name
    if (!pkg.package)
      pkg.setPackage(pjson.name || dir.split(path.sep).pop());

    // ensure the name abides by the registry package name conventions
    if (!registry.load(pkg.registry).constructor.packageNameFormats.some(function(format) {
      var formatRegEx = new RegExp('^' + format.replace(/\*/g, '[^\/]+') + '$');
      return pkg.package.match(formatRegEx);
    }))
      throw 'Error linking `' + pkg.name + '`. The %' + pkg.registry + '% registry doesn\'t support package names of this form. Make sure to enter a valid package name as the second argument to %jspm link% or in the package.json %name% field of the package being linked.';

    if (pkg.version)
      return;

    if (pjson.version) {
      pkg.setVersion(pjson.version);
      return;
    }

    // when there is no version given, we infer the version from any git HEAD of the linked project
    return asp(fs.readFile)(path.resolve(dir, '.git', 'HEAD'))
    .then(function(headSource) {
      headSource = headSource.toString();
      if (headSource.substr(0, 16) == 'ref: refs/heads/')
        pkg.setVersion(headSource.substr(16).replace(/\s*$/, ''));
      else
        pkg.setVersion('master');
    }, function() {
      pkg.setVersion('master');
    });
  })
  // create the symlink
  .then(function() {
    var libDir = pjson.directories && (pjson.directories.dist || pjson.directories.lib);
    if (libDir)
      dir = path.resolve(dir, libDir);

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
    var installName = pkg.package.split('/').pop();
    config.loader.baseMap[installName] = pkg;
    // NB options.quick for linked should still link, but just not do more than dependency checks
    return install.install(installName, pkg.exactName, { quick: options.quick, force: options.force });
  })
  .then(function(aborted) {
    if (!aborted)
      ui.log('info',
        '\nRun this link command again or %jspm install ' + pkg.exactName + '% to relink changes in the package.json file.\n' + 
        'Run %jspm install --unlink% to unlink and install all original packages. Linked packages can also be uninstalled normally.');
    else
      ui.log('info', 'Link operation aborted.');
  }, function(err) {
    ui.log('err', err.stack || err);
  });
};

