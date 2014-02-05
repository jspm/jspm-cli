#!/usr/bin/env node
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

var Promise = require('rsvp').Promise;

var path = require('path');
var semver = require('./semver');
var nodeSemver = require('semver');
var cli = require('./cli');
var config = require('./config');

var pkg = require('./package');
var build = require('./build');
var Package = pkg.Package;

var https = require('https');

var fs = require('graceful-fs');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var ncp = require('ncp');

var core = module.exports;


// convert a Node function into a promise
// asp(mkdirp)(dirname).then(...)
var asp = function(fn) {
  return function() {
    var self = this;
    var args = Array.prototype.splice.call(arguments, 0);
    return new Promise(function(resolve, reject) {
      args.push(function(err, val) {
        if (err)
          return reject(err);
        resolve(val);
      });
      fn.apply(self, args);
    });    
  }
}


var uninstall = exports.uninstall = function(name) {
  var removed = false;
  return config.load()
  .then(function() {
    if (name instanceof Array) {
      for (var i = 0; i < name.length; i++) {
        var deprecated = removePackage(name[i]);
        removed = removed || !!deprecated;
      }
    }
    else {
      var deprecated = removePackage(name);
      removed = removed || !!deprecated;
    }

    // log deprecations
    for (var i = 0; i < deprecated.length; i++)
      cli.log('info', 'Deprecated `' + deprecated[i] + '`');
  })
  .then(function() {
    return config.save()
    .then(function() {
      return removed;
    });
  });
}

// attempt to deprecate a given dependency name and range
// in turn checks if any of its dependencies should also be deprecated
// assumes that the dependency is not in baseMap, and its parent map is removed (if not can't be deprecated)
// returns true or false whether it did something
function deprecate(name, versionRange) {
  var deprecated = [];
  var orphanDeps = [];

  var versionList = config.versions[name] || [];
  for (var i = 0; i < versionList.length; i++) {
    // only do deprecation on versions within the range we're removing
    if (!semver.match(versionRange, versionList[i]))
      continue;

    // get critical ranges for each version
    var ranges = getCriticalRanges(name, versionList[i]);

    if (ranges.length)
      continue;

    // whoever has no critical ranges now gets deprecated
    var deprecateName = name + '@' + versionList[i];
    deprecated.push(deprecateName);
    var deps = config.depMap[deprecateName];
    for (var d in deps)
      orphanDeps.push(deps[d]);

    delete config.depMap[deprecateName];
    versionList.splice(i--, 1);
  }

  for (var i = 0; i < orphanDeps.length; i++)
    deprecate(orphanDeps[i].name, orphanDeps[i].version);

  return deprecated;
}

// removes from config.baseMap, pruning orphaned dependencies
// also removes from config.dependencies
function removePackage(name) {
  var removed = false;

  // remove from config.dependencies
  if (config.dependencies[name] && (removed = true))
    delete config.dependencies[name];

  if (!config.baseMap[name])
    return removed;

  var removeName = config.baseMap[name].name;
  var removeVersion = config.baseMap[name].version;

  // now remove it
  delete config.baseMap[name];

  // deprecate the given dependency (and any sub dependencies)
  return deprecate(removeName, removeVersion, false);
}


/* 
  config.baseMap = {
    jquery: new Package('npm:thing@1.2')
  };
  config.depMap = {
    'npm:thing@1.2.1': {
      dep: new Package('github:some/dep@2.3')
    }
  };
  config.versions = {
    'npm:thing': ['1.2.1', '3.3.3'],
    'github:some/dep': ['2.3.4']
  };
  config.dependencies = {
    'thing': 'npm:thing@1.2',
    'some': '@2.3'
  };
*/

/*
  Given a package and version, find all the ranges that this version matches
  Then for each of those ranges, check them against the other versions of this package
  The ranges that are only satisfied by this version are the critical ranges

  We run the entire algorithm on the dep tree after removing the dependency, excludeName

*/
function getCriticalRanges(name, version) {
  var versionList = config.versions[name];
  var ranges = [];

  // get all ranges for this version
  for (var d in config.depMap) {
    var curDepMap = config.depMap[d];
    for (var n in curDepMap) {
      var module = curDepMap[n];
      if (module.name != name)
        continue;
      if (ranges.indexOf(module.version) == -1)
        ranges.push(module.version);
    }
  }
  for (var n in config.baseMap) {
    var module = config.baseMap[n];
    if (module.name != name)
      continue;
    if (ranges.indexOf(module.version) == -1)
      ranges.push(module.version);
  }

  // filter to ranges that don't have another version match
  return ranges.filter(function(range) {

    for (var i = 0; i < versionList.length; i++) {
      if (versionList[i] == version)
        continue;

      if (semver.match(range, versionList[i]))
        return false;
    }

    return true;
  });
}
// Primary install function, forms of arguments are documented in first four comments
var installs = [];
var install = exports.install = function(name, target, options) {
  if (!name)
    return Promise.resolve();
  var args = arguments;
  if (!config.loaded)
    return config.load().then(function() {
      return install.apply(this, args);
    });

  // install('jquery')
  if (arguments.length == 1) {
    options = {};
    target = '';
  }

  // install(true, options) - from package.json
  if (name === true)
    name = config.dependencies;
  
  // install('jquery', options)
  if (!options && typeof target == 'object') {
    options = target;
    target = '';
  }

  // install({ jquery: '1.5' }, options)
  if (typeof name == 'object') {
    var promises = [];
    for (var d in name)
      promises.push(install(d, name[d], options));
    return Promise.all(promises);
  }

  // set default options
  if (!('primary' in options))
    options.primary = true;

  if (!(target instanceof Package)) {
    // convert shortcut version-only form
    if (target.indexOf('@') == -1 && target.indexOf(':') == -1)
      target = name + '@' + (target == '*' || !target ? '' : target);


    target = new Package(target);
  }

  // our lookup match - general information
  // extra info - lookup.alreadyDownloading, lookup.skipDeps, lookup.fresh (added by download)
  var lookup;
  var initialTarget = target;

  // when installing over an existing dep, need to check against the old config
  // to be sure we're not overriding something important
  var oldDep, oldMap, oldVersions;

  return pkg.locate(target)

  // if not a primary install, and we have something that satisfies this already, then use that
  // otherwise do the full lookup
  .then(function(_target) {
    target = _target;

    if (options.primary)
      return;

    var versionList = config.versions[target.name];
    if (!versionList)
      return;

    versionList.sort(semver.compare);

    // if not primary, and there is an existing compatible match, use it rather
    if (!options.force)
      for (var i = versionList.length - 1; i >= 0; i--) {
        var curVersion = versionList[i];
        if (!semver.match(target.version, versionList[i]))
          continue;

        var _lookup = new Package(target.exactName);
        _lookup.setVersion(curVersion);
        _lookup.skipDeps = true;

        return _lookup;
      }
  })

  .then(function(_lookup) {
    return _lookup || pkg.lookup(target);
  })

  .then(function(_lookup) {
    lookup = _lookup;

    // store these, as about to be removed
    oldDep = config.dependencies[name];
    oldMap = config.baseMap[name];
    oldVersions = (oldMap && config.versions[oldMap.name] || []).concat([]);

    // prune out the old name from the tree if there is one
    // acts only on config
    return removePackage(name);
  })
  .then(function(deprecated) {
    var versionList = config.versions[lookup.name] || [];

    // check to see if any old versions of this package can be replaced for all dependencies by this lookup version
    var useExisting = false;
    check: for (var i = 0; i < versionList.length; i++) {
      var curVersion = versionList[i];

      // find the critical ranges this version is in (the ranges only it can support)
      var ranges = getCriticalRanges(target.name, curVersion);

      // if this version satisfies all of the ranges, then we can replace with this version
      for (var j = 0; j < ranges.length; j++)
        if (!semver.match(ranges[j], lookup.version))
          continue check;

      // if the version is not equal to our target, deprecate the old version
      if (lookup.version != curVersion) {
        var oldName = lookup.name + '@' + curVersion;

        if (ranges.length) {
          useExisting = true;
          cli.log('info', (nodeSemver.gt(lookup.version, curVersion) ? 'Upgrading' : 'Downgrading') + ' `' + oldName + '` to `' + lookup.version + '`');
        }
        else {
          // wasn't critical anyway - just remove
          deprecated.push(oldName);
        }
        
        // remove all traces, but leave the package in the file system for cache value
        delete config.depMap[oldName];
        versionList.splice(i--, 1);
      }
    }

    // otherwise see if this target is supported by any of the existing dependencies
    // if so, change lookup to the existing dependency, and note if it is actually a change
    // this is the same check we did for secondary above, but we do it here after trying an upgrade for primary versions
    if (!useExisting)
      for (var i = versionList.length - 1; i >= 0; i--) {
        var curVersion = versionList[i];
        if (target.version && !semver.match(target.version, curVersion))
          continue;

        useExisting = true;

        if (lookup.version != curVersion) {
          cli.log('info', 'Using existing version `' + lookup.name + '@' + curVersion + '`, even though the latest is `' + lookup.version + '` as the tree can\'t be upgraded without forking');
          lookup.setVersion(curVersion);
        }

        break;
      }

    // now log deprecations (as we're about to ask a question)
    for (var i = 0; i < deprecated.length; i++) {
      if (deprecated[i] != lookup.exactName)
        cli.log('info', 'Deprecating `' + deprecated[i] + '`');
    }

    // we let this all the way down here as deprecation logging was only just above
    if (!versionList || !versionList.length)
      return;

    // if the fork version was actually already in our list of versions previously, then don't ask again
    if (oldVersions.indexOf(lookup.version) != -1)
      useExisting = true;

    // finally, we are now forking, so note the fork and ask for confirmation
    if (!useExisting)
      return options.force ? Promise.resolve(true) : cli.confirm('`' + lookup.name + '` already has version' + (versionList.length > 1 ? 's `' : ' `') + versionList.join('`, `') + 
        '` installed, which can\'t upgrade to `' + lookup.version + '`. Are you sure you want to install a version fork?', true)
      .then(function(confirm) {
        if (!confirm)
          throw 'Operation cancelled';
      })
  })

  // ensure we're happy overriding any map or dependencies
  // then write in our new config.baseMap and config.dependencies
  .then(function() {
    if (!options.primary)
      return;

    // set dependency version range to semver-compatible when none provided
    if (!target.version) {
      if (lookup.version.match(semver.semverRegEx))
        target.setVersion('^' + lookup.version);
      else
        target.setVersion(lookup.version);
    }

    return Promise.resolve()
    .then(function() {
      // now check we are happy to override dep
      if (!oldDep)
        return;

      // fill in the oldDep endpoint if it matches our target for replacement prompts
      if (!oldDep.endpoint && !initialTarget.endpoint && oldDep.name == initialTarget.name) {
        var v = oldDep.version;
        oldDep = new Package(target.name);
        oldDep.setVersion(v);
      }

      if (oldDep.exactName == target.exactName)
        return;

      return options.force ? Promise.resolve(true) : cli.confirm('%' + name + '% installed as `' + oldDep.exactName + '`, are you sure you want to install this to `' + target.exactName + '`?', true)
      .then(function(confirm) {
        if (!confirm)
          throw 'Operation cancelled';
      })
    })
    .then(function() {
      // check we are happy to override map
      if (!oldMap)
        return;

      if (oldMap.exactName == target.exactName)
        return;

      if (oldMap.exactName == oldDep.exactName)
        return;

      return options.force ? Promise.resolve(true) : cli.confirm('%' + name + '% is configured to `' + oldMap.exactName + '`, are you sure you want to change this to `' + target.exactName + '`?', true)
      .then(function(confirm) {
        if (!confirm)
          throw 'Operation cancelled';
      });
    })
    .then(function() {
      // add the version
      var versionList = config.versions[lookup.name] = config.versions[lookup.name] || [];
      if (versionList.indexOf(lookup.version) == -1)
        versionList.push(lookup.version);

      config.dependencies[name] = target;
      config.baseMap[name] = target;
    })
    
  })

  .then(function() {
    // before going ahead with install ensure we haven't already downloaded this already in this session
    if ((lookup.alreadyInstalling = installs.indexOf(lookup.exactName) != -1))
      return;

    installs.push(lookup.exactName);

    if (options.inject)
      return pkg.inject(lookup, options.override);
    else
      return pkg.download(lookup, config.jspmPackages, options.override, options.force);
  })

  .then(function(depMap) {
    if (!depMap || lookup.skipDeps)
      return;

    // convert depMap into package objects
    for (var d in depMap)
      depMap[d] = new Package(depMap[d]);

    // add deps into our depMap, asking about changes where necessary
    if (!config.depMap[lookup.exactName])
      return config.depMap[lookup.exactName] = depMap;

    var curDepMap = config.depMap[lookup.exactName];
    var changePromises = [];
    for (var d in depMap) (function(d) {
      if (!curDepMap[d])
        curDepMap[d] = depMap[d];
      if (curDepMap[d].exactName != depMap[d].exactName)
        changePromises.push(options.force && false ? Promise.resolve(true) : cli.confirm('`' + lookup.exactName + '` currently has dependency %' + d + '% set to `' + curDepMap[d].exactName + '`, but the new package expects `' + depMap[d].exactName + '`. Update?', true)
        .then(function(confirm) {
          if (confirm)
            curDepMap[d] = depMap[d];
        }));
    })(d);

    for (var d in curDepMap) (function(d) {
      if (!depMap[d])
        changePromises.push(options.force ? Promise.resolve(true) : cli.confirm('`' + lookup.exactName + '` currently has a dependency %' + d + '%, which is not in the new package. Remove?', true)
        .then(function(confirm) {
          if (confirm)
            delete curDepMap[d];
        }));
    })(d);

    return Promise.all(changePromises).then(function() {
      return curDepMap;
    });
  })

  .then(function(depMap) {
    if (!depMap || lookup.skipDeps)
      return;

    return install(depMap, {
      force: options.force,
      inject: options.inject,
      primary: false
    });
  })

  // save the changes only for primary installs once we're sure the full tree has worked out
  .then(function() {
    if (!options.primary)
      return;

    return config.save();
  })

  .then(function() {
    if (lookup.alreadyInstalling)
      return;
    if (options.primary)
      cli.log('ok', (!lookup.fresh ? (options.inject ? 'Injected' : 'Installed') : 'Up to date -') + ' %' + name + '% as `' + target.exactName + '` (' + lookup.version + ')');
    else if (lookup.hash && !lookup.fresh)
      cli.log('ok', '`' + target.exactName + '` (' + lookup.version + ')');
    else
      cli.log('ok', '`' + target.exactName + '` (' + lookup.version + ')');
  });
}



exports.build = function() {
  var pjson;

  return config.load()
  .then(function() {
    return asp(fs.readFile)(path.resolve(config.dir, 'package.json'));
  })
  .then(function(_pjson) {
    pjson = JSON.parse(_pjson);
  })
  .then(function() {
    return asp(rimraf)(config.dist)
  })
  .then(function() {
    return asp(ncp)(config.lib, config.dist);
  })
  .then(function() {
    return build.compileDir(config.dist, {
      format: pjson.format,
      shim: pjson.shim,
      dependencies: pjson.dependencies && config.parseDependencies(pjson.dependencies, pjson.registry),
      map: pjson.map,
      transpile: pjson.buildConfig && pjson.buildConfig.transpile,
      minify: pjson.buildConfig && (pjson.buildConfig.uglify || pjson.buildConfig.minify)
    });
  })
  .then(function(compileErrors) {
    if (compileErrors)
      cli.log('warn', 'Compile Errors:\n' + compileErrors);
    else
      cli.log('ok', 'Build Completed');
  }, function(err) {
    cli.log('err', err.stack || err);
  });
}

exports.setMode = function(mode) {
  if (['local', 'remote', 'production', 'dev'].indexOf(mode) == -1)
    return Promise.resolve(cli.log('warn', 'Invalid mode'));

  var msg = '';
  var jspmPackages;

  return config.load()
  .then(function() {
    var jspmPackages = path.relative(config.dir, config.jspmPackages);
    if (mode != 'local')
      return;
    
    // set local
    config.endpoints.forEach(function(e) {
      config.paths[e + ':*'] = jspmPackages + '/' + e + '/*.js';
    });

    msg = 'Loader set to local library sources';
  })
  .then(function() {
    if (mode != 'remote')
      return;

    // set remote
    config.endpoints.forEach(function(e) {
      delete config.paths[e + ':*'];
    });

    msg = 'Loader set to CDN library sources';
  })
  .then(function() {
    if (mode != 'production')
      return;

    // set production
    config.paths[config.name + '/*'] = path.relative(config.dir, config.dist) + '/*.js';
    msg = 'Local package URL set to %' + path.relative(config.dir, config.dist) + '%.';
  })
  .then(function() {
    if (mode != 'dev')
      return;

    // set dev
    config.paths[config.name + '/*'] = path.relative(config.dir, config.lib) + '/*.js';
    msg = 'Local package URL set to %' + path.relative(config.dir, config.lib) + '%.';
  })
  .then(config.save)
  .then(function() {
    cli.log('ok', msg);
  }, function(err) {
    cli.log('err', err.stack || err);
  });
}

exports.dlLoader = function() {
  return config.load()
  .then(function() {
    cli.log('info', 'Downloading loader files to %' + path.relative(config.dir, config.jspmPackages) + '%');
    return asp(mkdirp)(config.jspmPackages);
  })
  .then(function() {
    return new Promise(function(resolve, reject) {
      // first get latest versions
      https.get({
        hostname: 'jspm.io',
        path: '/versions',
        rejectUnauthorized: false
      }, function(res) {
        var chunks = [];
        res.on('data', function(chunk) { chunks.push(chunk); })
        res.on('end', function() {
          try {
            resolve(JSON.parse(chunks.join('')));
          }
          catch (e) {
            reject();
          }
        });
        res.on('error', reject);
      });
    })
  })
  .then(function(versions) {
    // delete old versions
    return asp(fs.readdir)(config.jspmPackages)
    .then(function(files) {
      return Promise.all(files.filter(function(file) {
        return file.match(/^(system@|es6-module-loader@|traceur@)/);
      }).map(function(file) {
        return asp(fs.unlink)(path.resolve(config.jspmPackages, file));
      }))
      .then(function() {
        return versions;
      });
    })
  })
  .then(function(versions) {
    return Promise.all(['system@' + versions[0] + '.js', 'es6-module-loader@' + versions[1] + '.js', 'traceur@' + versions[2] + '.js', 'traceur-runtime@' + versions[2] + '.js']
    .map(function(file) {
      return new Promise(function(resolve, reject) {
        https.get({
          hostname: 'jspm.io',
          path: '/' + file,
          rejectUnauthorized: false
        }, function(res) {
          res.pipe(
            fs.createWriteStream(path.resolve(config.jspmPackages, file))
              .on('finish', function() {
                cli.log('info', '  `' + file + '`');
                resolve();
              })
              .on('error', reject)
          )
          .on('error', reject);
        });
      });
    }));
  })
  .then(function() {
    cli.log('ok', 'Loader files downloaded successfully');
  }, function(err) {
    cli.log('err', 'Error downloading loader files \n' + err.stack || err);
  });
}


exports.clean = function clean() {
  // ensure baseMap and dependencies match
  // ensure every baseMap target has a matching version
  // ensure every baseMap target version has a depMap
  // ensure all of these depMap items have a corresponding version
  // etc, basically ensure integrity of the whole tree, removing unused versions at the end
  // finally delete all folders in jspm_packages not matching something we had in this verified tree
}


exports.init = function init() {
  return core.dlLoader()
  .then(config.save)
  .then(function() {
    cli.log('ok', 'Verified package.json at %' + path.relative(process.cwd(), path.resolve(config.dir, 'package.json')) + '%\nVerified config file at %' + path.relative(process.cwd(), config.configFile) + '%');
  })
  .catch(function(err) {
    cli.log('err', err.stack || err);
  });
}
