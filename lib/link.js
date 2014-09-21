var glob = require('glob');
var crypto = require('crypto');

var package = require('./package');
var Package = package.Package;

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
  var pkg = name && new Package(name);

  var linkDir;

  return Promise.resolve()
  .then(function() {
    // try to get endpoint, package
    if (!pkg || !pkg.endpoint || !pkg.version)
      return package.readJSON(path.resolve(dir, 'package.json'));
  })
  .then(function(pjson) {
    if (!pjson)
      return;

    // set the endpoint, name or version from the package.json if necessary
    var fullName;
    var needRegistry, needName, needVersion;

    if (!pkg) {
      needRegistry = needName = needVersion = true;
      fullName = pjson.registry + ':' + pjson.name + '@' + pjson.version;
    }
    else {
      if (!pkg.endpoint) {
        needRegistry = true;
        pkg.endpoint = pjson.registry;
        pkg.exactName = pjson.registry + ':' + pkg.exactName;
        pkg.name = pjson.registry + ':' + pkg.name;
      }
      if (!pkg.version) {
        needVersion = true;
        pkg.setVersion(pjson.version);
      }
    }

    if (needRegistry && !pjson.registry)
      throw 'Please provide an endpoint name to link into.';
    if (needName && !pjson.name)
      throw 'Please provide a package name to link into.';
    if (needVersion && !pjson.version)
      throw 'Please provide a package version to link into.';

    pkg = new Package(fullName);
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

    return asp(rimraf)(linkDir)
    // create it
    .then(function() {
      return asp(mkdirp)(linkDir);
    })
    // copy the files to the local cache folder
    .then(function() {
      return asp(ncp)(dir, linkDir);
    })
    // run the jspm operations on the folder to process it
    .then(function() {
      return package.processPackage(pkg, linkDir);
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
      versions[file.substr(file.lastIndexOf('@') + 1)] = 'hash';
    });

    if (!hasVersions)
      throw 'No version match found for `' + pkg.exactName + '`';

    return package.getVersionMatch(pkg, versions);
  }, function(err) {
    if (err.code == 'ENOENT')
      return;
    throw err;
  })
  .then(function(lookupObj) {
    var lookup = new Package(pkg.name + '@' + lookupObj.version);
    lookup.hash = lookupObj.hash;
    return lookup;
  });
}

exports.symlink = function(pkg, jspmPackages, options, preLoad) {
  var linkDir = path.resolve(config.HOME, '.jspm', 'linked', pkg.endpoint, pkg.exactPackage);
  var dir = path.resolve(jspmPackages, pkg.endpoint, pkg.exactPackage);
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
    return package.readJSON(path.resolve(dir, 'package.json'));
  })
  .then(function(_pjson) {
    pjson = _pjson;
    if (pkg.fresh)
      return;
    return package.createMain(pkg, pjson, dir);
  })
  .then(function() {
    return pjson;
  });
}

