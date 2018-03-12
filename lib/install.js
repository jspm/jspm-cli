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

var Promise = require('bluebird');

var config = require('./config');
var asp = require('bluebird').Promise.promisify;
var pkg = require('./package');
var semver = require('./semver');
var PackageName = require('./package-name');
var ui = require('./ui');
var path = require('path');
var globalConfig = require('./config/global-config');

var rimraf = require('rimraf');

var alphabetize = require('./common').alphabetize;
var cascadeDelete = require('./common').cascadeDelete;
var hasProperties = require('./common').hasProperties;
var processDeps = require('./common').processDeps;
var extend = require('./common').extend;

var Loader = require('../api').Loader;

var fs = require('graceful-fs');

var primaryRanges = {};
var secondaryRanges;

var installedResolves = {};
var installingResolves = {};

var installed;
var installing = {
  baseMap: {},
  depMap: {}
};

function runHook(name) {
  var hooks = config.pjson.hooks;
  if (hooks && hooks[name]) {
    return new Loader().import(hooks[name])
      .then(function (m) {
        if (m.default && typeof m.default === 'function') {
          ui.log('info', 'Running ' + name + ' hook...');
          return Promise.resolve(m.default());
        }
      })
      .catch(function (error) {
        ui.log('err', 'Error during ' + name + ' hook');
        if (error) {
          ui.log('err', error);
        }
      });
  }
}

/*
 * Main install API wrapper
 *
 * install('jquery')
 * install('jquery', {options})
 * install('jquery', 'github:components/jquery')
 * install('jquery', 'github:components/jquery', {options})
 * install(true) - from package.json
 * install(true, {options}) - from package.json
 *
 * options.force - skip cache
 * options.inject
 * options.lock - lock existing tree dependencies
 * options.latest - new install tree has all deps installed to latest - no rollback deduping
 * options.unlink - if linked, unlink and install from registry source
 * options.quick - lock and skip hash checks
 * options.dev - store in devDependencies
 * options.production - only install dependencies, not devDependencies
 * options.peer - store in peerDependencies
 * options.update - we're updating the targets
 *
 * options.summary - show fork and resolution summary
 */
exports.install = function(targets, options) {
  if (targets === undefined)
    targets = true;
  if (typeof targets === 'string') {
    var name = targets;
    targets = {};
    targets[name] = typeof options === 'string' ? options : '';
    options = typeof options === 'object' ? options : arguments[2];
  }
  options = options || {};

  return config.load()
  .then(function () {
    return runHook('preinstall');
  })
  .then(function() {
    installed = installed || config.loader;
    secondaryRanges = secondaryRanges || config.deps;

    if (options.force)
      config.force = true;

    if (options.quick)
      options.lock = true;

    var d, existingTargets = {};

    if (!options.production) {
      for (d in config.pjson.devDependencies)
        existingTargets[d] = config.pjson.devDependencies[d];
    }

    for (d in config.pjson.devDependencies)
      existingTargets[d] = config.pjson.devDependencies[d];
    for (d in config.pjson.dependencies)
      existingTargets[d] = config.pjson.dependencies[d];
    for (d in config.pjson.peerDependencies)
      existingTargets[d] = config.pjson.peerDependencies[d];

    var bulk = targets === true;
    if (bulk ) {
      targets = existingTargets;
      if (!options.update) {
        options.lock = true;
        // cant bullk assign dev or peer
        options.dev = options.peer = false;
      }
    }
    // check and set targets for update
    else if (targets && options.update) {
      for (d in targets) {
        if (!existingTargets[d])
          throw '%' + d + '% is not an existing dependency to update.';
        targets[d] = existingTargets[d];
      }
    }

    targets = processDeps(targets, globalConfig.config.defaultRegistry);

    return Promise.all(Object.keys(targets).map(function(name) {
      var opts = extend({}, options);

      // set config.peer / config.dev per package
      if (bulk || options.update) {
        if (config.pjson.peerDependencies[name])
          opts.peer = true;
        else if (config.pjson.devDependencies[name])
          opts.dev = true;
      }

      return install(name, targets[name], opts);
    }))
    .then(function() {
      return saveInstall();
    })
    .then(function () {
      return runHook('postinstall');
    })
    .then(function() {
      // after every install, show fork and resolution summary
      if (options.summary !== false)
        showVersions(true);
    });
  });
};

/*
 * install('jquery', 'jquery', { latest, lock, parent, inject, unlink, override, peer } [, seen])
 *
 * Install modes:
 *  - Default  a. The new install tree is set to use exact latest versions of primaries,
 *                including for existing primaries.
 *                Secondaries tend to their latest ideal version.
 *             b. Forks within the new tree are deduped for secondaries by checking for
 *                rollback of the higher version.
 *             c. Forks against the existing tree are handled by upgrading the existing
 *                tree, at both primary and secondary levels, with the secondary fork
 *                potentially rolling back as well.
 *             (this is `jspm install package`)
 *
 *  - Lock     No existing dependencies are altered.
 *             New installs otherwise follow default behaviour for secondary deduping.
 *             (this is reproducible installs, `jspm install` without arguments)
 *
 *  - Latest   Secondaries set exactly to latest.
 *             Forks against existing tree follow default behaviour.
 *             (this is `jspm update`)
 *
 * Lock and Latest can be combined, which won't do anything for existing
 * installs but will give latest secondaries on new installs.
 *
 * Secondary installs are those with a parent.
 *
 * Seen allows correct completion with circular package installs
 *
 */

/*
 * jspm.install('jquery')
 * jspm.install('jquery', 'github:components/jquery@^2.0.0')
 * jspm.install('jquery', '2')
 * jspm.install('jquery', 'github:components/jquery')
 * jspm.install('jquery', { force: true });
 * jspm.install({ jquery: '1.2.3' }, { force: true })
 */
function install(name, target, options, seen) {
  // we install a target range, to an exact version resolution
  var resolution;

  var dependencyDownloads, dependencyDownloadsError;

  var linked;
  var alreadyInstalled;

  return Promise.resolve()
  .then(function() {
    return pkg.locate(target);
  })
  .then(function(located) {
    target = located;

    // peerDependencies are dependencies which are installed as primary dependencies
    // even though they are not represented in the package.json install ranges
    // these will conflict as its a single namespace, so when they do we must resolve that
    if (!options.peer || !options.parent)
      return;

    var existing = installing.baseMap[name] || installed.baseMap[name];

    // when no existing version, do a normal lookup thing
    if (!existing)
      return;

    if (options.peerResolved)
      return;
    return (options.lock ? Promise.resolve() : resolvePeerConflicts(name, options.parent, target, existing))
    .then(function(targetRange) {
      if (targetRange) {
        target = targetRange;
        return;
      }

      // continue to use exsiting version
      target = config.pjson.peerDependencies[name] || config.pjson.devDependencies[name] || config.pjson.dependencies[name] || target;
      return existing;
    });
  })
  .then(function(peerResolution) {

    // get the natural installed match before doing any network lookups
    var installedResolution = peerResolution || getInstalledMatch(target, options.parent, name);

    if (!installedResolution || options.unlink)
      return;

    // check if it is linked (linked packages aren't updated and lock by default)
    return asp(fs.lstat)(installedResolution.getPath())
    .then(function(stats) {
      return stats.isSymbolicLink();
    }, function(err) {
      if (err.code == 'ENOENT')
        return false;
      throw err;
    })
    .then(function(isLinked) {
      // are linked -> note we are linked, and use lock to it
      if (isLinked) {
        linked = true;
        return installedResolution;
      }

      // not linked -> only use installedResolution if options.lock or peerResolution
      if (options.lock || peerResolution) {
        return installedResolution;
      }
    });
  })
  .then(function(lockResolution) {
    if (lockResolution) {
      resolution = lockResolution;
      return;
    }

    // perform a full version lookup
    return pkg.lookup(target, options.edge);
  })
  .then(function(getLatestMatch) {
    if (!getLatestMatch)
      return storeResolution();

    // --- version constraint solving ---

    // a. The new install tree is set to use exact latest versions of primaries, including for existing primaries.
    //    Secondaries tend to their latest ideal version.
    resolution = getLatestMatch(target.version);

    if (!resolution) {
      if (options.parent)
        throw 'Installing `' + options.parent + '`, no version match for `' + target.exactName + '`';
      else
        throw 'No version match found for `' + target.exactName + '`';
    }

    if (options.exact) {
      target.setVersion(resolution.version);
    }
    // if no version range was specified on install, install to semver-compatible with the latest
    else if (!options.parent && !target.version) {
      if (resolution.version.match(semver.semverRegEx))
        target.setVersion('^' + resolution.version);
      else
        target.setVersion(resolution.version);
    }
    else if (options.edge && !options.parent) {
      // use strictest compatible semver range if installing --edge without target, or
      // with a range that does not include the resolved version
      if (!target.version || !semver.match(target.version, resolution.version)) {
        target.setVersion('^' + resolution.version);
      }
    }

    var forkVersions = [];

    // load our fork ranges to do a resolution
    return loadExistingForkRanges(resolution, name, options.parent, options.inject)
    .then(function() {
      // here, alter means upgrade or rollback

      // if we've consolidated with another resolution, we don't do altering
      var consolidated = false;

      // b. Forks within the new tree are deduped for secondaries by checking for rollback of the higher version
      if (!options.latest)
        resolveForks(installing, installed, name, options.parent, resolution, function(forkVersion, forkRanges, allSecondary) {
          forkVersions.push(forkVersion);

          // alter the other secondaries to this primary or secondary
          if (allSecondary && forkRanges.every(function(forkRange) {
            return semver.match(forkRange, resolution.version);
          })) {
            consolidated = true;
            return resolution.version;
          }

          // alter this secondary install to the other primary or secondary
          if (!consolidated && options.parent && semver.match(target.version, forkVersion)) {
            consolidated = true;
            if (forkVersion !== resolution.version) {
              var newResolution = resolution.copy().setVersion(forkVersion);
              logResolution(installingResolves, resolution, newResolution);
              resolution = newResolution;
            }
          }
        });

      // c. Forks against the existing tree are handled by upgrading the existing tree,
      //    at both primary and secondary levels, with the secondary fork potentially rolling back as well.
      resolveForks(installed, installing, name, options.parent, resolution, function(forkVersion, forkRanges) {
        forkVersions.push(forkVersion);

        if (options.latest && semver.compare(forkVersion, resolution.version) === 1)
          return;

        if (forkRanges.every(function(forkRange) {
          return semver.match(forkRange, resolution.version);
        })) {
          consolidated = true;
          return resolution.version;
        }

        // find the best upgrade of all the fork ranges for rollback of secondaries
        if (!consolidated && options.parent && !options.latest) {
          var bestSecondaryRollback = resolution;
          forkRanges.forEach(function(forkRange) {
            var forkLatest = getLatestMatch(forkRange);
            if (semver.compare(bestSecondaryRollback.version, forkLatest.version) === 1)
              bestSecondaryRollback = forkLatest;
          });

          if (semver.compare(bestSecondaryRollback.version, forkVersion) === -1)
            bestSecondaryRollback = getLatestMatch(forkVersion);

          if (semver.match(target.version, bestSecondaryRollback.version)) {
            consolidated = true;
            logResolution(installingResolves, resolution, bestSecondaryRollback);
            resolution = bestSecondaryRollback;
            return bestSecondaryRollback.version;
          }
        }
      });

      // solve and save resolution solution synchronously - this lock avoids solution conflicts
      storeResolution();

      // if we've already installed to the semver range of this dependency
      // then note this "version" is already installed
      return forkVersions.some(function(forkVersion) {
        return semver.match('^' + forkVersion, resolution.version);
      });
    });
  })
  .then(function(_alreadyInstalled) {
    alreadyInstalled = _alreadyInstalled;

    // -- handle circular installs --
    seen = seen || [];
    if (seen.indexOf(resolution.exactName) !== -1)
      return;
    seen.push(resolution.exactName);

    // -- download --
    // we support custom resolution maps to non-registries!
    if (!resolution.registry)
      return;

    config.loader.ensureRegistry(resolution.registry, options.inject);

    return Promise.resolve()
    .then(function() {
      if (options.inject)
        return pkg.inject(resolution, depsCallback);

      return pkg.download(resolution, {
        unlink: options.unlink,
        linked: linked,
        override: options.override,
        quick: options.quick,
        force: options.force
      }, depsCallback);
    })
    .then(function(fresh) {
      resolution.fresh = fresh;
      // log sub-dependencies before child completion for nicer output
      if (options.parent)
        logInstall(name, target, resolution, linked, options);

      return dependencyDownloads;
    })
    .then(function() {
      if (dependencyDownloadsError)
        return Promise.reject(dependencyDownloadsError);

      if (!options.parent)
        logInstall(name, target, resolution, linked, options);
    });
  });

  // store resolution in config
  function storeResolution() {
    // support custom install maps
    if (!resolution.registry)
      return;

    var alreadyInstalled;

    if (options.parent && !options.peer) {
      installing.depMap[options.parent] = installing.depMap[options.parent] || {};

      alreadyInstalled = !!installing.depMap[options.parent][name] && installing.depMap[options.parent][name].exactName == resolution.exactName;
      installing.depMap[options.parent][name] = resolution.copy();
    }
    else {
      alreadyInstalled = installing.baseMap[name] == resolution.exactName;
      installing.baseMap[name] = resolution.copy();
    }

    // update the dependency range tree
    if (!options.parent || options.peer) {
      if (!primaryRanges[name] || primaryRanges[name].exactName !== target.exactName)
        primaryRanges[name] = target.copy();

      // peer dependency of a dev dependency is a dev dependency unless it was already a peer dependency or dependency
      if (options.parent && options.peer && options.dev) {
        if (config.pjson.peerDependencies[name])
          options.dev = false;
        else if (config.pjson.dependencies[name])
          options.peer = options.dev = false;
        else
          options.peer = false;
      }
      // primary install that is a peer dependency remains a peer dependency
      else if (!options.parent && !options.peer && !options.dev) {
        if (config.pjson.peerDependencies[name])
          options.peer = true;
      }

      function replaceDependency(dependencies, name, newPackage) {
        var existingDependency = dependencies[name];
        if (!existingDependency) { //No existing dependency
          dependencies[name] = newPackage;
        } else { //Enforce maximum compatibility version
          var existingMinVersion = semver.rangeToMinSemver(existingDependency.version);
          var matches = semver.match(newPackage.version, existingMinVersion);
          if (!matches) { //Need to update because current min version would not match the criteria set by this package
            dependencies[name] = newPackage;
          }
        }
      }

      if (options.peer)
        replaceDependency(config.pjson.peerDependencies, name, primaryRanges[name]);
      else if (options.dev)
        replaceDependency(config.pjson.devDependencies, name, primaryRanges[name]);
      else
        replaceDependency(config.pjson.dependencies, name, primaryRanges[name]);

      // remove any alternative installs of this dependency
      if (!options.dev)
        delete config.pjson.devDependencies[name];
      if (!options.peer)
        delete config.pjson.peerDependencies[name];
      if (options.dev && !options.parent || options.peer)
        delete config.pjson.dependencies[name];
    }
    else {
      // update the secondary ranges
      secondaryRanges[options.parent] = secondaryRanges[options.parent] || { deps: {}, peerDeps: {} };
      if (!secondaryRanges[options.parent].deps[name])
        secondaryRanges[options.parent].deps[name] = target.copy();
      else
        if (secondaryRanges[options.parent].deps[name] && secondaryRanges[options.parent].deps[name].exactName !== target.exactName)
          ui.log('warn', 'Currently installed dependency ranges of `' + options.parent + '` are not consistent ( %' + secondaryRanges[options.parent].deps[name].exactName + '% should be %' + target.exactName + '%)');
    }

    return alreadyInstalled;
  }

  // trigger dependency downloads
  // this can be triggered twice
  //  - once by initial preload, and once post-build if additional dependencies are discovered
  function depsCallback(depRanges) {
    dependencyDownloads = (dependencyDownloads || Promise.resolve()).then(function() {
      return Promise.all(
        Object.keys(depRanges.deps).map(function(dep) {
          return doInstall(dep, depRanges.deps[dep], false);
        })
        .concat(Object.keys(depRanges.peerDeps).map(function(peerDep) {
          return doInstall(peerDep, depRanges.peerDeps[peerDep], true);
        }))
      )
      .catch(function(e) {
        dependencyDownloadsError = e;
      });
    });

    function doInstall(dep, range, isPeer) {
      return install(dep, range, {
        force: options.force,
        latest: options.latest,
        lock: options.lock,
        parent: resolution.exactNameEncoded,
        inject: options.inject,
        quick: options.quick,
        peer: isPeer,
        peerResolved: isPeer && alreadyInstalled,
        dev: options.dev
      }, seen);
    }
  }
}

function getInstalledMatch(target, parent, name) {
  // use the config lock if provided
  // installing beats installed
  if (parent) {
    if (installing.depMap[parent] && installing.depMap[parent][name])
      return installing.depMap[parent][name];
    if (installed.depMap[parent] && installed.depMap[parent][name])
      return installed.depMap[parent][name];
  }
  else {
    if (installing.baseMap[name])
      return installing.baseMap[name];
    if (installed.baseMap[name])
      return installed.baseMap[name];
  }

  // otherwise seek an installed match
  var match;
  function checkMatch(pkg) {
    if (pkg.name !== target.name)
      return;
    if (semver.match(target.version, pkg.version)) {
      if (!match || match && semver.compare(pkg.version, match.version) === 1)
        match = pkg.copy();
    }
  }
  Object.keys(installed.baseMap).forEach(function(name) {
    checkMatch(installed.baseMap[name]);
  });
  Object.keys(installed.depMap).forEach(function(parent) {
    var depMap = installed.depMap[parent];
    Object.keys(depMap).forEach(function(name) {
      checkMatch(depMap[name]);
    });
  });
  Object.keys(installing.baseMap).forEach(function(name) {
    checkMatch(installing.baseMap[name]);
  });
  Object.keys(installing.depMap).forEach(function(parent) {
    var depMap = installing.depMap[parent];
    Object.keys(depMap).forEach(function(name) {
      checkMatch(depMap[name]);
    });
  });
  return match;
}

// track peer dependency conflicts so we only prompt once
var peerConflicts = {};

// resolve peer dependency conflicts given the target install for a peer dependency
// and the existing dependency
function resolvePeerConflicts(name, parent, target, existing) {
  // wait if there is already a peer dependency conflict for this version
  return (peerConflicts[name] = Promise.resolve(peerConflicts[name])
  .then(function(acceptedRange) {

    if (acceptedRange) {
      // if there is already a new accepted range, then continue to use it if it is compatible
      // NB this can be relaxed to ensure they have the same latest version overlap
      if (acceptedRange.exactName == target.exactName)
        return acceptedRange;
    }
    else {
      // if the existing version matches the peer dependency expectation then continue to use what we have
      if (existing.name == target.name && semver.match(target.version, existing.version))
        return;
    }

    // conflict resolution!
    return ui.confirm('Install the peer %' + name + '% from ' + getUpdateRangeText(acceptedRange || existing, target) + '?', true, {
      info: 'Peer dependency conflict for %' + name + '%:\n' +
        '  Package `' + parent + '` requires `' + target.exactName + '`.\n' +
        '  Currently resolving to `' + (acceptedRange || existing).exactName + '`.\n\n' +
        'Please select how you would like to resolve the version conflict.',
      hideInfo: false
    })
    .then(function(useNew) {
      if (useNew)
        return target;

      var existingTarget = config.pjson.peerDependencies[name] || config.pjson.devDependencies[name] || config.pjson.dependencies[name] || target;

      return ui.confirm('Keep the `' + (acceptedRange || existing).exactName + '` resolution?', true)
      .then(function(useExisting) {
        if (useExisting)
          return acceptedRange || existingTarget;

        return ui.input('Enter any custom package resolution range', (acceptedRange || existingTarget).exactName, {
          edit: true
        })
        .then(function(customRange) {
          return pkg.locate(new PackageName(customRange));
        });
      });
    });
  }));
}

function saveInstall() {
  return Promise.resolve()
  .then(function() {

    // merge the installing tree into the installed
    Object.keys(installing.baseMap).forEach(function(p) {
      installed.baseMap[p] = installing.baseMap[p];
    });

    Object.keys(installing.depMap).forEach(function(p) {
      installed.depMap[p] = installed.depMap[p] || {};
      for (var q in installing.depMap[p])
        installed.depMap[p][q] = installing.depMap[p][q];
    });

    return clean();
  })
  .then(function() {
    if (hasProperties(installedResolves)) {
      ui.log('');
      ui.log('info', 'The following existing package versions were altered by install deduping:');
      ui.log('');
      Object.keys(installedResolves).forEach(function(pkg) {
        var pkgName = new PackageName(pkg);
        ui.log('info', '  %' + pkgName.package + '% ' + getUpdateRangeText(pkgName, new PackageName(installedResolves[pkg])));
      });
      ui.log('');
      installedResolves = {};
      ui.log('info', 'To keep existing dependencies locked during install, use the %--lock% option.');
    }

    if (hasProperties(installingResolves)) {
      ui.log('');
      ui.log('info', 'The following new package versions were substituted by install deduping:');
      ui.log('');
      Object.keys(installingResolves).forEach(function(pkg) {
        var pkgName = new PackageName(pkg);
        ui.log('info', '  %' + pkgName.package + '% ' + getUpdateRangeText(pkgName, new PackageName(installingResolves[pkg])));
      });
      ui.log('') ;
      installingResolves = {};
    }

    // then save
    return config.save();
  });
}

var logged = {};
function logInstall(name, target, resolution, linked, options) {
  if (logged[target.exactName + '=' + resolution.exactName])
    return;

  // don't log secondary fresh
  if (options.parent && resolution.fresh)
    return;

  logged[target.exactName + '=' + resolution.exactName] = true;

  var verb;
  if (options.inject)
    verb = 'Injected ';

  else if (!resolution.fresh) {
    if (!linked)
      verb = 'Installed ';
    else
      verb = 'Symlinked ';
  }
  else {
    if (options.quick)
      return;
    verb = '';
  }

  if (options.dev)
    verb += (verb ? 'd' : 'D') + 'ev dependency ';
  else if (options.peer)
    verb += (verb ? 'p' : 'P') + 'eer ';

  var actual = resolution.version;
  if (resolution.package != target.package)
    actual = resolution.package + (actual ? '@' + actual : '');
  if (resolution.registry != target.registry && resolution.registry)
    actual = resolution.registry + ':' + actual;

  if (options.parent && !options.peer)
    ui.log('ok', verb + '`' + target.exactName + '` (' + actual + ')');
  else
    ui.log('ok', verb + '%' + name + '% ' + (linked ? 'as': 'to') + ' `' + target.exactName + '` (' + actual + ')');
}

function getUpdateRangeText(existing, update) {
  if (existing.name === update.name)
    return '`' + existing.version + '` -> `' + update.version + '`';
  else
    return '`' + existing.exactName + '` -> `' + update.exactName + '`';
}

// go through the baseMap and depMap, changing FROM to TO
// keep a log of what we did in resolveLog
function doResolution(tree, from, to) {
  if (from.exactName === to.exactName)
    return;

  // add this to the resolve log, including deep-updating resolution chains
  logResolution(tree === installed ? installedResolves : installingResolves, from, to);

  Object.keys(tree.baseMap).forEach(function(dep) {
    if (tree.baseMap[dep].exactName === from.exactName)
      tree.baseMap[dep] = to.copy();
  });

  Object.keys(tree.depMap).forEach(function(parent) {
    var curMap = tree.depMap[parent];
    Object.keys(curMap).forEach(function(dep) {
      if (curMap[dep].exactName === from.exactName)
        curMap[dep] = to.copy();
    });
  });
}

function logResolution(resolveLog, from, to) {
  resolveLog[from.exactName] = to.exactName;

  // find re-resolved
  Object.keys(resolveLog).forEach(function(resolveFrom) {
    if (resolveLog[resolveFrom] === from.exactName) {
      // non-circular get updated
      if (resolveFrom !== to.exactName) {
        resolveLog[resolveFrom] = to.exactName;
      }
      // circular get removed
      else {
        delete resolveLog[resolveFrom];
        // remove entirely if it never was an install to begin with
        var tree = resolveLog === installedResolves ? installed : installing;
        var inInstallResolution = Object.keys(tree.baseMap).some(function(dep) {
          return tree.baseMap[dep].exactName === from.exactName;
        }) || Object.keys(tree.depMap).some(function(parent) {
          var curMap = tree.depMap[parent];
          return Object.keys(curMap).some(function(dep) {
            return curMap[dep].exactname == from.exactName;
          });
        });
        if (!inInstallResolution)
          delete resolveLog[from.exactName];
      }
    }
  });
}

// name and parentName are the existing resolution target
// so we only look up forks and not the original as well
function loadExistingForkRanges(resolution, name, parentName, inject) {
  var tree = installed;
  return Promise.all(Object.keys(tree.baseMap).map(function(dep) {
    if (!parentName && dep === name)
      return;

    var primary = tree.baseMap[dep];
    if (primary.name !== resolution.name)
      return;

    return loadExistingRange(dep, null, inject);
  }))
  .then(function() {
    return Promise.all(Object.keys(tree.depMap).map(function(parent) {
      var curDepMap = tree.depMap[parent];

      return Promise.all(Object.keys(curDepMap).map(function(dep) {
        if (parent === parentName && dep === name)
          return;

        var secondary = curDepMap[dep];

        if (secondary.name !== resolution.name)
          return;

        return loadExistingRange(dep, parent, inject);
      }));
    }));
  });
}

function visitForkRanges(tree, resolution, name, parentName, visit) {
  // now that we've got all the version ranges we need for consideration,
  // go through and run resolutions against the fork list
  Object.keys(tree.baseMap).forEach(function(dep) {
    var primary = tree.baseMap[dep];
    if (primary.name !== resolution.name)
      return;

    visit(dep, null, primary, primaryRanges[dep]);
  });

  Object.keys(tree.depMap).forEach(function(parent) {
    var curDepMap = tree.depMap[parent];

    Object.keys(curDepMap).forEach(function(dep) {
      var secondary = curDepMap[dep];

      if (secondary.name !== resolution.name)
        return;

      // its not a fork of itself
      if (dep === name && parent === parentName)
        return;

      // skip if we don't have a range
      var ranges = secondaryRanges[parent];
      if (!ranges || !ranges.deps || !ranges.deps[dep])
        return;

      visit(dep, parent, secondary, ranges.deps[dep]);
    });
  });
}

// find all forks of this resolution in the tree
// calling resolve(forkVersion, forkRanges, allSecondary)
// for each unique fork version
// sync resolution to avoid conflicts
function resolveForks(tree, secondaryTree, name, parentName, resolution, resolve) {
  // forks is a map from fork versions to an object, { ranges, hasPrimary }
  // hasPrimary indicates whether any of these ranges are primary ranges
  var forks = {};
  var forkVersions = [];

  function rangeVisitor(dep, parent, resolved, range) {
    if (!range)
      return;

    // we only work with stuff within it's own matching range
    // not user overrides
    if (range.name !== resolved.name || !semver.match(range.version, resolved.version))
      return;

    var forkObj = forks[resolved.version];
    if (!forkObj) {
      forkObj = forks[resolved.version] = { ranges: [], allSecondary: true };
      forkVersions.push(resolved.version);
    }

    if (!parent)
      forkObj.allSecondary = false;

    forkObj.ranges.push(range.version);
  }

  visitForkRanges(tree, resolution, name, parentName, rangeVisitor);

  // we include the secondary tree ranges as part of the fork ranges (but not fork versions)
  // this is because to break a secondary tree range is still to introduce a fork
  visitForkRanges(secondaryTree, resolution, name, parentName, function(dep, parent, resolved, range) {
    if (forks[resolved.version])
      rangeVisitor(dep, parent, resolved, range);
  });

  // now run through and resolve the forks
  forkVersions.sort(semver.compare).reverse().forEach(function(forkVersion) {
    var forkObj = forks[forkVersion];

    var newVersion = resolve(forkVersion, forkObj.ranges, forkObj.allSecondary);
    if (!newVersion || newVersion === forkVersion)
      return;

    var from = resolution.copy().setVersion(forkVersion);
    var to = resolution.copy().setVersion(newVersion);

    doResolution(tree, from, to);
  });
}

var secondaryDepsPromises = {};
function loadExistingRange(name, parent, inject) {
  if (parent && secondaryRanges[parent])
    return;
  else if (!parent && primaryRanges[name])
    return;

  var _target;

  return Promise.resolve()
  .then(function() {
    if (!parent)
      return config.pjson.dependencies[name] || config.pjson.peerDependencies[name] || config.pjson.devDependencies[name];

    return Promise.resolve()
    .then(function() {
      if (secondaryDepsPromises[parent])
        return secondaryDepsPromises[parent];

      return Promise.resolve()
      .then(function() {
        var parentPkg = new PackageName(parent, true);

        // if the package is installed but not in jspm_packages
        // then we wait on the getPackageConfig or download of the package here
        return (secondaryDepsPromises[parent] = new Promise(function(resolve, reject) {
          if (inject)
            return pkg.inject(parentPkg, resolve).catch(reject);

          pkg.download(parentPkg, {}, resolve).then(resolve, reject);
        })
        .then(function(depMap) {
          if (depMap)
            return depMap;

          return config.deps[new PackageName(parent, true).exactName];
        }));
      });
    })
    .then(function(deps) {
      return deps.deps[name];
    });
  })
  .then(function(target) {
    if (!target) {
      if (parent && installed.depMap[parent] && installed.depMap[parent].name) {
        delete installed.depMap[parent].name;
        ui.log('warn', '%' + parent + '% dependency %' + name + '% was removed from the config file to reflect the installed package.');
      }
      else if (!parent) {
        ui.log('warn', '%' + name + '% is installed in the config file, but is not a dependency in the package.json. It is advisable to add it to the package.json file.');
      }
      return;
    }

    _target = target.copy();
    // locate the target
    return pkg.locate(_target)
    .then(function(located) {
      if (parent) {
        secondaryRanges[parent] = secondaryRanges[parent] || { deps: {}, peerDeps: {} };
        secondaryRanges[parent].deps[name] = located;
      }
      else {
        primaryRanges[name] = located;
      }
    });
  });
}


// given an exact package, find all the forks, and display the ranges
function showInstallGraph(pkg) {
  installed = installed || config.loader;
  secondaryRanges = secondaryRanges || config.deps;
  pkg = new PackageName(pkg);
  var lastParent;
  var found;
  return loadExistingForkRanges(pkg, config.loader.local)
  .then(function() {
    ui.log('info', '\nInstalled versions of %' + pkg.name + '%');
    visitForkRanges(installed, pkg, null, null, function(name, parent, resolved, range) {
      found = true;
      var rangeVersion;
      if (range) {
        if (range.version === '') {
          range.version = '*';
        }
        rangeVersion = range.name === resolved.name ? range.version : range.exactName;
        if (range.version === '*') {
          range.version = '';
        }
      }
      if (!parent) {
        ui.log('info', '\n       %' + name + '% `' + resolved.version + '`' + (range ? ' (' + rangeVersion + ')' : ''));
      }
      else {
        if (lastParent !== parent) {
          ui.log('info', '\n  ' + parent);
          lastParent = parent;
        }
        ui.log('info', '    ' + name + ' `' + resolved.version + '`' + (range ? ' (' + rangeVersion + ')' : ''));
      }
    });
    if (!found)
      ui.log('warn', 'Package `' + pkg.name + '` not found.');
    ui.log('');
  });
}
exports.showInstallGraph = showInstallGraph;


function showVersions(forks) {
  installed = installed || config.loader;

  var versions = {};
  var haveLinked = false;
  var linkedVersions = {};

  function addDep(dep) {
    var vList = versions[dep.name] = versions[dep.name] || [];
    var version = dep.version;
    try {
      if (fs.readlinkSync(dep.getPath()))
        linkedVersions[dep.exactName] = true;
    }
    catch(e) {}
    if (vList.indexOf(version) === -1)
      vList.push(version);
  }

  Object.keys(installed.baseMap).forEach(function(dep) {
    addDep(installed.baseMap[dep]);
  });
  Object.keys(installed.depMap).forEach(function(parent) {
    var curMap = installed.depMap[parent];
    Object.keys(curMap).forEach(function(dep) {
      addDep(curMap[dep]);
    });
  });

  versions = alphabetize(versions);

  var vLen = 0;

  var shownIntro = false;

  var logLines = [];

  Object.keys(versions).forEach(function(dep) {
    var vList = versions[dep].sort(semver.compare).map(function(version) {
      if (linkedVersions[dep + '@' + version]) {
        haveLinked = true;
        return '%' + version + '%';
      }
      else
        return '`' + version + '`';
    });

    if (forks && vList.length === 1) {
      haveLinked = false;
      return;
    }

    if (!shownIntro) {
      ui.log('info', 'Installed ' + (forks ? 'Forks' : 'Versions') + '\n');
      shownIntro = true;
    }

    vLen = Math.max(vLen, dep.length);
    logLines.push([dep, vList.join(' ')]);
  });

  logLines.forEach(function(cols) {
    var padding = vLen - cols[0].length;
    var paddingString = '  ';
    while(padding--)
      paddingString += ' ';

    ui.log('info', paddingString + '%' + cols[0] + '% ' + cols[1]);
  });

  if (haveLinked) {
    ui.log('info', '\nBold versions are linked. To unlink use %jspm install --unlink [name]%.');
  }
  if (shownIntro) {
    ui.log('info', '\nTo inspect individual package constraints, use %jspm inspect registry:name%.\n');
  }
  else if (forks) {
    ui.log('info', 'Install tree has no forks.');
  }
}
exports.showVersions = showVersions;

/*
 * Configuration cleaning
 *
 * 1. Construct list of all packages in main tree tracing from package.json primary installs
 * 2. Remove all orphaned dependencies not in this list
 * 3. Remove any package.json overrides that will never match this list
 * 4. Remove packages in .dependencies.json that aren't used at all
 * 5. Remove anything from jspm_packages not in this list
 *
 * Hard clean will do extra steps:
 * * Any dependencies of packages that don't have ranges are cleared
 *    (that is extra map configs added to packages)
 * * Config file saving is enforced (even if no changes were made)
 *
 */
function clean(hard) {
  var packageList = [];

  return config.load()
  .then(function() {

    // include the local package as a package
    if (config.loader.package && config.pjson.name)
      packageList.push(config.pjson.name);

    // Hard clean - remove dependencies not installed to parent goal ranges
    if (hard) {
      Object.keys(config.loader.baseMap).forEach(function(dep) {
        var pkg = config.loader.baseMap[dep];
        if (!config.pjson.dependencies[dep] && !config.pjson.devDependencies[dep] && !config.pjson.peerDependencies[dep] && pkg.registry)
          delete config.loader.baseMap[dep];
      });

      Object.keys(config.loader.depMap).forEach(function(parent) {
        var depMap = config.loader.depMap[parent];
        var secondaryRanges = config.deps[parent];
        if (secondaryRanges)
          Object.keys(depMap).forEach(function(dep) {
            if (!secondaryRanges.deps[dep]) {
              if (depMap[dep].registry) {
                var name = depMap[dep].exactName;
                ui.log('info', 'Clearing undeclared dependency `' + name + '` of `' + parent + '`.');
                delete depMap[dep];
              }
            }
          });
      });
    }

    // 1. getDependentPackages for each of baseMap
    Object.keys(config.loader.baseMap).forEach(function(dep) {
      getDependentPackages(config.loader.baseMap[dep], packageList);
    });

    // 2. now that we have the package list, remove everything not in it
    Object.keys(config.loader.depMap).forEach(function(dep) {
      var depUnencoded = new PackageName(dep, true).exactName;
      if (packageList.indexOf(depUnencoded) === -1) {
        ui.log('info', 'Clearing configuration for `' + depUnencoded + '`');
        config.loader.removePackage(dep);
      }
    });

    // 3. remove package.json overrides which will never match any packages
    var usedOverrides = [];
    packageList.forEach(function(pkgName) {
      if (config.pjson.overrides[pkgName])
        usedOverrides.push(pkgName);
    });
    Object.keys(config.pjson.overrides).forEach(function(overrideName) {
      if (usedOverrides.indexOf(overrideName) == -1 && hasProperties(config.pjson.overrides[overrideName])) {
        ui.log('info', 'Removing unused package.json override `' + overrideName + '`');
        delete config.pjson.overrides[overrideName];
      }
    });
  })

  .then(function() {
    return asp(fs.lstat)(config.pjson.packages)
    .catch(function(e) {
      if (e.code == 'ENOENT')
        return;
      throw e;
    }).then(function(stats) {
      // Skip if jspm_packages is symlinked or not existing
      if (!stats || stats.isSymbolicLink())
        return;

      // 4. Remove packages in .dependencies.json that aren't used at all
      Object.keys(config.deps).forEach(function(dep) {
        if (packageList.indexOf(dep) == -1)
          delete config.deps[dep];
      });

      // 5. Remove anything from jspm_packages not in this list
      return readDirWithDepth(config.pjson.packages, function(dirname) {
        if (dirname.split(path.sep).pop().indexOf('@') <= 0)
          return true;
      })
      .then(function(packageDirs) {
        return Promise.all(
        packageDirs
        .filter(function(dir) {
          var exactName = path.relative(config.pjson.packages, dir).replace(path.sep, ':').replace(/\\/g, '/'); // (win)
          exactName = new PackageName(exactName, true).exactName;
          var remove = packageList.indexOf(exactName) === -1;
          if (remove)
            ui.log('info', 'Removing package files for `' + exactName + '`');
          return remove;
        })
        .map(function(dir) {
          return asp(rimraf)(dir)
          .then(function() {
            var filename = dir + '.json';
            return new Promise(function(resolve) {
              fs.exists(filename, resolve);
            }).then(function(exists) {
              if (exists) return asp(fs.unlink)(filename);
            });
          })
          // NB deprecate with 0.16
          .then(function() {
            var filename = dir + '.js';
            return new Promise(function(resolve) {
              fs.exists(filename, resolve);
            }).then(function(exists) {
              if (exists) return asp(fs.unlink)(filename);
            });
          })
          .then(function() {
            return cascadeDelete(dir);
          });
        }));
      });
    });
  })
  .then(function() {
    if (hard) {
      config.pjson.file.changed = true;
      config.loader.file.changed = true;
      if (config.loader.devFile)
        config.loader.devFile.changed = true;
      if (config.loader.browserFile)
        config.loader.browserFile.changed = true;
      if (config.loader.nodeFile)
        config.loader.nodeFile.changed = true;
    }

    return config.save();
  });
}
exports.clean = clean;

// depthCheck returns true to keep going (files being ignored), false to add the dir to the flat list
function readDirWithDepth(dir, depthCheck) {
  var flatDirs = [];
  return asp(fs.readdir)(dir)
  .then(function(files) {
    if (!files)
      return [];
    return Promise.all(files.map(function(file) {
      var filepath = path.resolve(dir, file);

      // ensure it is a directory or symlink
      return asp(fs.lstat)(filepath)
      .then(function(fileInfo) {
        if (!fileInfo.isDirectory() && !fileInfo.isSymbolicLink())
          return;

        if (!depthCheck(filepath))
          return flatDirs.push(filepath);

        // keep going
        return readDirWithDepth(filepath, depthCheck)
        .then(function(items) {
          items.forEach(function(item) {
            flatDirs.push(item);
          });
        });
      });
    }));
  })
  .then(function() {
    return flatDirs;
  });
}


function getDependentPackages(pkg, packages) {
  packages.push(pkg.exactName);
  // get all immediate children of this package
  // for those children not already seen (in packages list),
  // run getDependentPackages in turn on those
  var depMap = config.loader.depMap[pkg.exactNameEncoded];
  if (!depMap)
    return;
  Object.keys(depMap).forEach(function(dep) {
    var curPkg = depMap[dep];
    if (packages.indexOf(curPkg.exactName) !== -1)
      return;
    getDependentPackages(curPkg, packages);
  });

  return packages;
}

exports.uninstall = function(names, peer) {
  if (!(names instanceof Array))
    names = [names];

  return config.load()
  .then(function() {
    if (names.length == 0 && peer)
      names = Object.keys(config.pjson.peerDependencies);

    installed = installed || config.loader;

    names.forEach(function(name) {
      delete config.pjson.dependencies[name];
      delete config.pjson.devDependencies[name];
      delete config.pjson.peerDependencies[name];
      delete installed.baseMap[name];
    });

    return clean();
  });
};

/*
 * Resolve all installs of the given package to a specific version
 */
exports.resolveOnly = function(pkg) {
  pkg = new PackageName(pkg);

  if (!pkg.version || !pkg.registry) {
    ui.log('warn', 'Resolve --only must take an exact package of the form `registry:pkg@version`.');
    return Promise.reject();
  }

  var didSomething = false;

  return config.load()
  .then(function() {
    Object.keys(config.loader.baseMap).forEach(function(name) {
      var curPkg = config.loader.baseMap[name];
      if (curPkg.registry === pkg.registry && curPkg.package === pkg.package && curPkg.version !== pkg.version) {
        didSomething = true;
        ui.log('info', 'Primary install ' + getUpdateRangeText(curPkg, pkg));
        config.loader.baseMap[name] = pkg.copy();
      }
    });

    Object.keys(config.loader.depMap).forEach(function(parent) {
      var curMap = config.loader.depMap[parent];
      Object.keys(curMap).forEach(function(name) {
        var curPkg = curMap[name];
        if (curPkg.registry === pkg.registry && curPkg.package === pkg.package && curPkg.version !== pkg.version) {
          didSomething = true;
          ui.log('info', 'In %' + parent + '% ' + getUpdateRangeText(curPkg, pkg));
          curMap[name] = pkg.copy();
        }
      });
    });

    return config.save();
  })
  .then(function() {
    if (didSomething)
      ui.log('ok', 'Resolution to only use `' + pkg.exactName + '` completed successfully.');
    else
      ui.log('ok', '`' + pkg.exactName + '` is already the only version of the package in use.');
  });
};
