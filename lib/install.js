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

require('core-js/es6/string');

var config = require('./config');
var Promise = require('rsvp').Promise;
var asp = require('rsvp').denodeify;
var pkg = require('./package');
var semver = require('./semver');
var PackageName = require('./config/package-name');
var ui = require('./ui');
var path = require('path');
var link = require('./link');
var globalConfig = require('./global-config');

var rimraf = require('rimraf');

var readJSON = require('./common').readJSON;
var alphabetize = require('./common').alphabetize;
var hasProperties = require('./common').hasProperties;

var fs = require('graceful-fs');

var primaryRanges = {};
var secondaryRanges = {};

var installedResolves = {};
var installingResolves = {};

var installed;
var installing = {
  baseMap: {},
  depMap: {}
};

var errorMessages = {
  'implicit-install': 'Update does not support implicit installs.',
  'update-with-version': 'Update does not support explicit version ranges.'
};

// NB remove assertions for release
// function assert(statement, name) {
//  if (!statement)
//    throw new TypeError('Assertion Failed: ' + name);
// }

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
 * options.link means symlink linked versions in ranges to jspm_packages where available
 * options.lock - lock existing tree dependencies
 * options.latest - new install tree has all deps installed to latest - no rollback deduping
 * options.unlink
 * options.quick - lock and skip hash checks
 * options.dev - stored in devDependencies
 *
 * options.summary - show fork and resolution summary
 */
exports.install = function(targets, options) {
  if (typeof targets === 'string') {
    var name = targets;
    targets = {};
    targets[name] = typeof options === 'string' ? options : '';
    options = typeof options === 'object' ? options : arguments[2];
  }
  options = options || {};

  return config.load()
  .then(function() {
    var error;
    installed = installed || config.loader;

    if (options.force)
      config.force = true;

    if (options.link || options.quick)
      options.lock = true;

    var defaultTargets = options.dev ? config.pjson.devDependencies : config.pjson.dependencies;
    if (targets === true)
      targets = defaultTargets;
    else if (targets && options.doUpdate)
      Object.keys(targets).forEach(function(module) {
        var target = targets[module];
        var configured = defaultTargets[module];
        if (!configured || target) {
          var moduleExpr = target ? module + '@' + target : module;
          error = configured ? 'update-with-version' : 'implicit-install';
          ui.log('warn', 'Did you mean `jspm install ' + moduleExpr + '`?');
        }
        targets[module] = configured || '';
      });

    if (error) {
      ui.log('err', errorMessages[error]);
      process.exit(1);
    }

    targets = pkg.processDeps(targets, globalConfig.config.defaultRegistry);

    return Promise.all(Object.keys(targets).map(function(name) {
      return install(name, targets[name], options);
    }))
    .then(function() {
      return saveInstall();
    })
    .then(function() {
      // after every install, show fork and resolution summary
      if (options.summary !== false)
        showVersions(true);
    });
  });
};

/*
 * install('jquery', 'jquery', { latest, lock, parent, inject, link, unlink, override } [, seen])
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
  var dependencyDownloads;
  var existing;

  return Promise.resolve()
  .then(function() {
    if (options.link)
      return Promise.resolve(target);

    return pkg.locate(target);
  })
  .then(function(located) {
    target = located;

    config.loader.ensureRegistry(located.registry, options.inject);

    if (options.link)
      return link.lookup(target);

    // lock if necessary
    if (options.lock && (resolution = getInstalledMatch(target, options.parent, name)))
      return Promise.resolve();

    // perform a full version lookup
    return pkg.lookup(target);
  })
  .then(function(getLatestMatch) {
    if (!getLatestMatch)
      return storeResolution();

    // --- version constraint solving ---

    // a. The new install tree is set to use exact latest versions of primaries, including for existing primaries.
    //    Secondaries tend to their latest ideal version.
    resolution = getLatestMatch(target.version);

    if (!resolution)
      throw 'No version match found for `' + target.exactName + '`';

    // if no version range was specified on install, install to semver-compatible with the latest
    if (!options.parent && !target.version && !options.link) {
      if (resolution.version.match(semver.semverRegEx))
        target.setVersion('^' + resolution.version);
      else
        target.setVersion(resolution.version);
    }

    // load our fork ranges to do a resolution
    return loadExistingForkRanges(resolution, name, options.parent, options.inject)
    .then(function() {
      // here, alter means upgrade or rollback

      // if we've consolidated with another resolution, we don't do altering
      var consolidated = false;

      // b. Forks within the new tree are deduped for secondaries by checking for rollback of the higher version
      if (!options.latest)
        resolveForks(installing, name, options.parent, resolution, function(forkVersion, forkRanges, allSecondary) {
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
      resolveForks(installed, name, options.parent, resolution, function(forkVersion, forkRanges) {
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
    });
  })
  .then(function() {

    // -- handle circular installs --

    seen = seen || [];
    if (seen.indexOf(resolution.exactName) !== -1)
      return;
    seen.push(resolution.exactName);


    // -- download --
    return Promise.resolve()
    .then(function() {
      if (options.link)
        return link.symlink(resolution, downloadDeps);

      if (options.inject)
        return pkg.inject(resolution, downloadDeps);

      // override, quick, unlink options passed
      return pkg.download(resolution, options, downloadDeps);
    })
    .then(function(fresh) {
      resolution.fresh = fresh;
      // log sub-dependencies before child completion for nicer output
      if (options.parent)
        logInstall(name, target, resolution, options);

      return dependencyDownloads;
    })
    .then(function() {
      if (!options.parent)
        logInstall(name, target, resolution, options);
    });
  });

  // store resolution in config
  function storeResolution() {
    var curMap;
    if (options.parent) {
      curMap = (existing ? installed : installing).depMap;
      curMap[options.parent] = curMap[options.parent] || {};
      curMap[options.parent][name] = resolution.copy();
    }
    else {
      curMap = (existing ? installed : installing).baseMap;
      curMap[name] = resolution.copy();
    }

    // update the dependency range tree
    if (!options.parent) {
      if (!primaryRanges[name] || primaryRanges[name].exactName !== target.exactName)
        primaryRanges[name] = target.copy();
      // store in package.json
      if (!options.link) {
        if (!options.dev)
          config.pjson.dependencies[name] = primaryRanges[name];
        else
          config.pjson.devDependencies[name] = primaryRanges[name];
        if (options.override)
          config.pjson.overrides[resolution.exactName] = options.override;
      }
    }
    else {
      // update the secondary ranges
      secondaryRanges[options.parent] = secondaryRanges[options.parent] || {};
      if (!secondaryRanges[options.parent][name])
        secondaryRanges[options.parent][name] = target.copy();
      else
        if (secondaryRanges[options.parent][name] && secondaryRanges[options.parent][name].exactName !== target.exactName)
          ui.log('warn', 'Currently installed dependency ranges of `' + options.parent + '` are not consistent ( %' + secondaryRanges[options.parent][name].exactName + '% should be %' + target.exactName + '%)');
    }
  }

  // trigger dependency downloads
  // this can be triggered twice
  //  - once by initial preload, and once post-build if additional dependencies are discovered
  function downloadDeps(depMap) {
    dependencyDownloads = (dependencyDownloads || Promise.resolve()).then(function() {
      return Promise.all(Object.keys(depMap).map(function(dep) {
        return install(dep, depMap[dep], {
          latest: options.latest,
          lock: options.lock,
          parent: resolution.exactName,
          inject: options.inject,
          quick: options.quick
        }, seen);
      }));
    });
  }
}

function getInstalledMatch(target, parent, name) {
  // use the config lock if provided
  if (parent) {
    if (installed.depMap[parent] && installed.depMap[parent][name])
      return installed.depMap[parent][name];
  }
  else {
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
  return match;
}

function saveInstall() {
  return Promise.resolve()
  .then(function() {

    // merge the installing tree into the installed
    Object.keys(installing.baseMap).forEach(function(p) {
      installed.baseMap[p] = installing.baseMap[p];
    });

    Object.keys(installing.depMap).forEach(function(p) {
      installed.depMap[p] = installing.depMap[p];
    });

    // deprecate old nodelibs
    // NB this can be removed when 0.9 is no longer supported
    for (var i = 0; i < 10; i++) {
      if (installed.depMap['github:jspm/nodelibs@0.0.' + i])
        return clean();
    }

    if (hasProperties(installedResolves))
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
function logInstall(name, target, resolution, options) {
  if (logged[target.exactName + '=' + resolution.exactName])
    return;

  // don't log secondary fresh
  if (options.parent && resolution.fresh)
    return;

  logged[target.exactName + '=' + resolution.exactName] = true;

  var verb;
  if (options.inject)
    verb = 'Injected';

  else if (!resolution.fresh) {
    if (!options.link)
      verb = 'Installed';
    else
      verb = 'Linked';
  }
  else {
    if (options.quick)
      return;
    if (!options.link)
      verb = 'Up to date -';
    else
      verb = 'Already linked -';
  }

  if (options.parent)
    ui.log('ok', verb + ' `' + target.exactName + '` (' + resolution.version + ')');
  else
    ui.log('ok', verb + ' %' + name + '% as `' + target.exactName + '` (' + resolution.version + ')');
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

  Object.keys(resolveLog).forEach(function(resolveFrom) {
    if (resolveLog[resolveFrom] === from.exactName)
      resolveLog[resolveFrom] = to.exactName;
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
      if (!secondaryRanges[parent])
        return;

      visit(dep, parent, secondary, secondaryRanges[parent][dep]);
    });
  });
}

// find all forks of this resolution in the tree
// calling resolve(forkVersion, forkRanges, allSecondary)
// for each unique fork version
// sync resolution to avoid conflicts
function resolveForks(tree, name, parentName, resolution, resolve) {
  // forks is a map from fork versions to an object, { ranges, hasPrimary }
  // hasPrimary indicates whether any of these ranges are primary ranges
  var forks = {};
  var forkVersions = [];

  visitForkRanges(tree, resolution, name, parentName, function(dep, parent, resolved, range) {
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
  if (parent && secondaryRanges[parent] && secondaryRanges[parent][name])
    return;
  else if (!parent && primaryRanges[name])
    return;

  var _target;

  return Promise.resolve()
  .then(function() {
    if (!parent)
      return config.pjson.dependencies[name] || config.pjson.devDependencies[name];

    return Promise.resolve()
    .then(function() {
      if (secondaryDepsPromises[parent])
        return secondaryDepsPromises[parent];

      return Promise.resolve()
      .then(function() {
        var parentPkg = new PackageName(parent);
        var pjsonPath = path.resolve(parentPkg.getPath(), '.jspm.json');

        // if the package is installed but not in jspm_packages
        // then we wait on the getPackageConfig or download of the package here
        return (secondaryDepsPromises[parent] = new Promise(function(resolve, reject) {
          if (inject)
            return pkg.inject(parentPkg, resolve).catch(reject);

          fs.exists(pjsonPath, function(exists) {
            if (exists)
              return resolve();
            pkg.download(parentPkg, {}, resolve).then(resolve, reject);
          });
        })
        .then(function(depMap) {
          if (depMap)
            return depMap;

          return readJSON(pjsonPath)
          .then(function(pjson) {
            return pkg.processDeps(pjson.dependencies || {}, pjson.registry);
          });
        }));
      });
    })
    .then(function(deps) {
      return deps[name];
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
        secondaryRanges[parent] = secondaryRanges[parent] || {};
        secondaryRanges[parent][name] = located;
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
  pkg = new PackageName(pkg);
  var lastParent;
  var found;
  return loadExistingForkRanges(pkg, config.loader.local)
  .then(function() {
    ui.log('info', '\nInstalled versions of %' + pkg.name + '%');
    visitForkRanges(installed, pkg, null, null, function(name, parent, resolved, range) {
      found = true;
      if (range.version === '')
        range.version = '*';
      var rangeVersion = range.name === resolved.name ? range.version : range.exactName;
      if (range.version === '*')
        range.version = '';

      if (!parent)
        ui.log('info', '\n       %' + name + '% `' + resolved.version + '` (' + rangeVersion + ')');
      else {
        if (lastParent !== parent) {
          ui.log('info', '\n  ' + parent);
          lastParent = parent;
        }
        ui.log('info', '    ' + name + ' `' + resolved.version + '` (' + rangeVersion + ')');
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

  var vLen = Object.keys(versions).map(function(dep) {
    return dep.length;
  }).reduce(function(a, b) {
    return Math.max(a, b);
  }, 0);

  var shownIntro = false;

  Object.keys(versions).forEach(function(dep) {
    var vList = versions[dep].sort(semver.compare).map(function(version) {
      if (linkedVersions[dep + '@' + version]) {
        haveLinked = true;
        return '%' + version + '%';
      }
      else
        return '`' + version + '`';
    });

    if (forks && vList.length === 1)
      return;

    if (!shownIntro) {
      ui.log('info', 'Installed ' + (forks ? 'Forks' : 'Versions') + '\n');
      shownIntro = true;
    }

    var padding = vLen - dep.length;
    var paddingString = '';
    while(padding--)
      paddingString += ' ';

    ui.log('info', '  ' + paddingString + '%' + dep + '% ' + vList.join(' '));
  });

  if (haveLinked) {
    ui.log('info', '\nBold versions are linked. To unlink use %jspm install --unlink [name]%.');
  }
  if (shownIntro) {
    ui.log('info', '\nTo inspect individual package constraints, use %jspm inspect registry:name%.\n');
  }
  else if (forks) {
    ui.log('ok', 'Install tree has no forks.');
  }
}
exports.showVersions = showVersions;

/*
 * Configuration cleaning
 *
 * This is purely a configuration operation (config.js)
 * that is, we are cleaning that which is not already present in the configuration file
 * The first operation we do is orphaning within the configuration file itself
 * the second operation we do is a full package listing of jspm_packages,
 * and removal of that which is not represented in configuration
 *
 */
function clean() {
  var packageList = [];

  return config.load()
  .then(function() {

    // getDependentPackages for each of baseMap
    Object.keys(config.loader.baseMap).forEach(function(dep) {
      getDependentPackages(config.loader.baseMap[dep].exactName, packageList);
    });

    // now that we have the package list, remove everything not in it
    Object.keys(config.loader.depMap).forEach(function(dep) {
      if (packageList.indexOf(dep) === -1) {
        ui.log('info', 'Clearing configuration for `' + dep + '`');
        delete config.loader.depMap[dep];
      }
    });

    return readDirWithDepth(config.pjson.packages, function(dirname) {
      if (dirname.indexOf('@') === -1)
        return true;
      // causes mains to be ignored
      if (dirname.endsWith('.js'))
        return true;
    });
  })
  .then(function(packageDirs) {
    return Promise.all(
    packageDirs
    .filter(function(dir) {
      var exactName = path.relative(config.pjson.packages, dir).replace(path.sep, ':').replace(/\\/g, '/'); // (win)
      var remove = packageList.indexOf(exactName) === -1;
      if (remove)
        ui.log('info', 'Removing package files for `' + exactName + '`');
      return remove;
    })
    .map(function(dir) {
      return asp(rimraf)(dir)
      .then(function() {
        var filename = dir + '.js';
        return new Promise(function(resolve) {
          fs.exists(filename, resolve);
        }).then(function(exists) {
          if (exists) return asp(fs.unlink)(filename);
        });
      });
    }));
  })
  .then(function() {
    return config.save();
  });
}
exports.clean = clean;

// depthCheck returns true to keep going (files being ignored), false to add the dir to the flat list
function readDirWithDepth(dir, depthCheck) {
  var flatDirs = [];
  function pushMany(items) {
    items.forEach(function(item) { flatDirs.push(item); });
  }
  return asp(fs.lstat)(dir).then(function(fileInfo) {
    if (fileInfo.isSymbolicLink())
      return Promise.resolve([dir]);

    if (!fileInfo.isDirectory())
      return Promise.resolve([]);

    return asp(fs.readdir)(dir);
  })
  .then(function(files) {
    if (!files)
      return [];
    return Promise.all(files.map(function(file) {
      var filepath = path.resolve(dir, file);
      /* `dir` is always absolute path, so equality implies isSymbolicLink above */
      var notSymlink = dir !== file;
      if (notSymlink && depthCheck(filepath)) {
        return readDirWithDepth(filepath, depthCheck).then(pushMany);
      } else {
        flatDirs.push(filepath);
      }
    }));
  })
  .then(function() {
    return flatDirs;
  });
}


function getDependentPackages(pkg, packages) {
  packages.push(pkg);
  // get all immediate children of this package
  // for those children not already seen (in packages list),
  // run getDependentPackages in turn on those
  var depMap = config.loader.depMap[pkg];
  if (!depMap)
    return;
  Object.keys(depMap).forEach(function(dep) {
    var curPkg = depMap[dep].exactName;
    if (packages.indexOf(curPkg) !== -1)
      return;
    getDependentPackages(curPkg, packages);
  });

  return packages;
}

exports.uninstall = function(names) {
  if (!(names instanceof Array))
    names = [names];

  return config.load()
  .then(function() {
    installed = installed || config.loader;

    names.forEach(function(name) {
      if (!config.pjson.dependencies[name] && !config.pjson.devDependencies[name]) {
        ui.log('warn', 'Dependency %' + name + '% is not an existing primary install.');
        return;
      }

      delete config.pjson.dependencies[name];
      delete config.pjson.devDependencies[name];
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
