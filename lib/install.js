var config = require('./config');
var Promise = require('rsvp').Promise;
var asp = require('rsvp').denodeify;
var pkg = require('./package');
var semver = require('./semver');
var PackageName = require('./config/package-name');
var ui = require('./ui');
var path = require('path');

var readJSON = require('./common').readJSON;
var alphabetize = require('./common').alphabetize;

var fs = require('graceful-fs');

var primaryRanges = {};
var secondaryRanges = {};

var installed;
var installing = {
  baseMap: {},
  depMap: {}
};

var downloads = {};

// NB remove assertions for release
function assert(statement, name) {
  if (!statement)
    throw new TypeError('Assertion Failed: ' + name);
}

/*
 * install('jquery', 'jquery', { latest, stable, parent, inject, link } [, seen])
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
exports.install = install;
function install(name, target, options, seen) {
  // we install a target range, to an exact version resolution
  var resolution;
  var dependencyDownloads;
  var existing;

  // primary saved to package.json
  if (!options.parent)
    config.pjson.dependencies[name] = target;

  return config.load()
  .then(function() {
    installed = installed || config.loader;

    return pkg.locate(target);
  })
  .then(function(located) {
    target = located;

    config.loader.ensureEndpoint(located.endpoint);

    // satisfy with existing dependencies if appropriate
    /*if (options.stable || !options.latest && options.parent)
      return getVersionsFor(target).reverse().some(function(version) {
        if (!semver.match(target.version, version))
          return;

        target.setVersion(version);
        return true;
      });*/
  })
  .then(function(satisfied) {
    if (satisfied)
      return target;
    
    // perform a full version lookup
    return pkg.lookup(target);
  })
  .then(function(getLatestMatch) {
    // -- work out the version resolution --

    // a. The new install tree is set to use exact latest versions of primaries, including for existing primaries.
    //    Secondaries tend to their latest ideal version.
    resolution = getLatestMatch(target.version);

    if (!resolution)
      throw 'No version match found for `' + target.exactName + '`';

    // if no version range was specified on install, install to semver-compatible with the latest
    if (!options.parent && !target.version) {
      if (resolution.version.match(semver.semverRegEx))
        target.setVersion('^' + resolution.version);
      else
        target.setVersion(resolution.version);
    }

    // load our fork ranges to do a resolution
    return loadExistingForkRanges(resolution)
    .then(function() {

      // if we've consolidated with another resolution, we don't do rollback
      var consolidated = false;

      // b. Forks within the new tree are deduped for secondaries by checking for rollback of the higher version
      resolveForks(installing, name, options.parent, resolution, function(forkVersion, forkRanges, allSecondary) {

        // rollback the other secondaries to this primary or secondary
        if (allSecondary && forkRanges.every(function(forkRange) {
          return semver.match(forkRange, resolution.version);
        }))
          return resolution.version;

        // rollback this secondary install to the other primary or secondary
        if (options.parent && !consolidated && semver.match(target.version, forkVersion)) {
          consolidated = true;
          resolution.setVersion(forkVersion);
        }
      });

      // c. Forks against the existing tree are handled by upgrading the existing tree, 
      //    at both primary and secondary levels, with the secondary fork potentially rolling back as well.
      resolveForks(installed, name, options.parent, resolution, function(forkVersion, forkRanges) {
        if (forkRanges.every(function(forkRange) {
          return semver.match(forkRange, resolution.version);
        }))
          return resolution.version;

        // find the best upgrade of all the fork ranges for rollback of secondaries
        if (options.parent && !consolidated) {
          var bestSecondaryRollback = resolution;
          forkRanges.forEach(function(forkRange) {
            var forkLatest = getLatestMatch(forkRange);
            if (semver.compare(bestSecondaryRollback.version, forkLatest.version) == 1)
              bestSecondaryRollback = forkLatest;
          });

          if (semver.compare(bestSecondaryRollback.version, forkVersion) == -1)
            bestSecondaryRollback = getLatestMatch(forkVersion);
          
          if (semver.match(target.version, bestSecondaryRollback.version)) {
            consolidated = true;
            resolution = bestSecondaryRollback;
            return bestSecondaryRollback.version;
          }
        }
      });

      // -- store the resolution --

      // should be able to assert here for existing that we resolved ourselves already as a fork of ourselves
      var curMap;
      if (options.parent) {
        if (installed.depMap[options.parent])
          existing = true;
        curMap = (existing ? installed : installing).depMap;
        curMap[options.parent] = curMap[options.parent] || {};
        curMap[options.parent][name] = resolution.copy();
      }
      else {
        if (installed.baseMap[name])
          existing = true;
        curMap = (existing ? installed : installing).baseMap;
        curMap[name] = resolution.copy();
      }

      // update the dependency range tree
      if (!options.parent) {
        if (!primaryRanges[name] || primaryRanges[name].exactName != target.exactName)
          primaryRanges[name] = config.pjson.dependencies[name] = target.copy();
      }
      else {
        // update the secondary ranges
        secondaryRanges[options.parent] = secondaryRanges[options.parent] || {};
        if (!secondaryRanges[options.parent][name])
          secondaryRanges[options.parent][name] = target.copy();
        else 
          assert(secondaryRanges[options.parent][name].exactName == target.exactName, 'secondary range clash ' + secondaryRanges[options.parent][name].exactName + ', ' + target.exactName);
      }

    });
  })
  .then(function() {

    // -- handle circular installs --

    seen = seen || [];
    if (seen.indexOf(resolution.exactName) != -1)
      return;
    seen.push(resolution.exactName);


    // -- download --

    //if (options.link)
    //  return link.symlink(resolution, config.pjson.packages, options)
    return pkg.download(resolution, options, downloadDeps)
    .then(function(fresh) {
      resolution.fresh = fresh;
      // log sub-dependencies before child completion for usability
      if (options.parent)
        logInstall(name, target, resolution, options);

      return dependencyDownloads;
    })
    .then(function(depMap) {
      if (!options.parent)
        logInstall(name, target, resolution, options);
    });

    function downloadDeps(depMap) {
      dependencyDownloads = Promise.all(Object.keys(depMap).map(function(dep) {
        return install(dep, depMap[dep], {
          latest: options.latest,
          stable: options.stable,
          inject: options.inject,
          parent: resolution.exactName
        }, seen);
      }));
    }
  });
}

exports.saveInstall = saveInstall;
function saveInstall() {
  // merge the installing tree into the installed
  Object.keys(installing.baseMap).forEach(function(p) {
    installed.baseMap[p] = installing.baseMap[p];
  });

  Object.keys(installing.depMap).forEach(function(p) {
    installed.depMap[p] = installing.depMap[p];
  });

  console.log('');
  console.log('Installed Resolutions:');
  console.log('----------------------');
  console.log(JSON.stringify(installedResolves, null, 2));
  console.log('');
  console.log('');
  console.log('Installing Resolutions:');
  console.log('-----------------------');
  console.log(JSON.stringify(installingResolves, null, 2));

  // we may have lowered versions earlier that turned out to be inevitable forks, so raise again?
  // note version tree at the end, not during
  // effectively like our previous versions object, but of display form
  // we note the diff of the installed tree too
  // perhaps skim this, and just publish a beta regardless, refine later!

  // then save
  return config.save();
}

var logged = {};
function logInstall(name, target, resolution, options) {
  if (logged[target.exactName + '=' + resolution.exactName])
    return;
  logged[target.exactName + '=' + resolution.exactName] = true;

  var verb;
  if (!resolution.fresh) {
    if (options.inject)
      verb = 'Injected';
    else if (!options.link)
      verb = 'Installed';
    else
      verb = 'Linked';
  }
  else {
    if (!options.link)
      verb = 'Up to date -';
    else
      verb = 'Already linked -';
  }

  if (logged)

  if (options.parent)
    ui.log('ok', verb + ' `' + target.exactName + '` (' + resolution.version + ')');
  else
    ui.log('ok', verb + ' %' + name + '% as `' + target.exactName + '` (' + resolution.version + ')');
}
function getUpdateRangeText(existing, update) {
  if (existing.name == update.name)
    return '`' + existing.version + '` to `' + update.version + '`';
  else
    return '`' + existing.exactName + '` to `' + update.exactName + '`';
}
function logIfUpdate(name, existing, update, parent) {
  if (!existing)
    return;
  if (existing.exactName != update.exactName)
    ui.log('info', 'Updating %' + name + '% from ' + getUpdateRangeText(existing, update) + ' in ' + parent + '.');
}



var installedResolves = {};
var installingResolves = {};

// go through the baseMap and depMap, changing FROM to TO
// keep a log of what we did in resolveLog
function doResolution(tree, from, to) {
  if (from.exactName == to.exactName)
    return;

  // add this to the resolve log, including deep-updating resolution chains
  var resolveLog = tree == installed ? installedResolves : installingResolves;

  resolveLog[from.exactName] = to.exactName;

  Object.keys(resolveLog).forEach(function(resolveFrom) {
    if (resolveLog[resolveFrom] == from.exactName)
      resolveLog[resolveFrom] = to.exactName;
  });

  Object.keys(tree.baseMap).forEach(function(dep) {
    if (tree.baseMap[dep].exactName == from.exactName)
      tree.baseMap[dep] = to.copy();
  });

  Object.keys(tree.depMap).forEach(function(parent) {
    var curMap = tree.depMap[parent];
    Object.keys(curMap).forEach(function(dep) {
      if (curMap[dep].exactName == from.exactName)
        curMap[dep] = to.copy();
    });
  });
}

function loadExistingForkRanges(resolution) {
  var tree = installed;
  return Promise.all(Object.keys(tree.baseMap).map(function(dep) {
    var primary = tree.baseMap[dep];
    if (primary.name != resolution.name)
      return;

    return loadExistingRange(dep);
  }))
  .then(function() {
    return Promise.all(Object.keys(tree.depMap).map(function(parent) {
      var curDepMap = tree.depMap[parent];

      return Promise.all(Object.keys(curDepMap).map(function(dep) {
        var secondary = curDepMap[dep];

        if (secondary.name != resolution.name)
          return;

        return loadExistingRange(dep, parent);
      }));
    }));
  });
}

function visitForkRanges(tree, resolution, visit) {
  // now that we've got all the version ranges we need for consideration,
  // go through and run resolutions against the fork list
  Object.keys(tree.baseMap).forEach(function(dep) {
    var primary = tree.baseMap[dep];
    if (primary.name != resolution.name)
      return;

    visit(dep, null, primary, primaryRanges[dep]);
  });

  Object.keys(tree.depMap).forEach(function(parent) {
    var curDepMap = tree.depMap[parent];

    Object.keys(curDepMap).forEach(function(dep) {
      var secondary = curDepMap[dep];

      if (secondary.name != resolution.name)
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

  visitForkRanges(tree, resolution, function(dep, parent, resolved, range) {
    // its not a fork of itself
    if (dep == name && parent == parentName)
      return;

    // we only work with stuff within it's own matching range
    // not user overrides
    if (range.name != resolved.name || !semver.match(range.version, resolved.version))
      return;

    var forkObj = forks[resolved.version];
    if (!forkObj)
      forkObj = forks[resolved.version] = { ranges: [], allSecondary: true };

    if (!parent)
      forkObj.allSecondary = false;

    forkObj.ranges.push(range.version);
  });

  // now run through and resolve the forks
  Object.keys(forks).forEach(function(forkVersion) {
    var forkObj = forks[forkVersion];

    var newVersion = resolve(forkVersion, forkObj.ranges, forkObj.allSecondary);
    if (!newVersion || newVersion == forkVersion)
      return;

    var from = resolution.copy().setVersion(forkVersion);
    var to = resolution.copy().setVersion(newVersion);

    doResolution(tree, from, to);
  });
}

var secondaryDepsPromises = {};
function loadExistingRange(name, parent) {
  if (parent && secondaryRanges[parent] && secondaryRanges[parent][name])
    return;
  else if (!parent && primaryRanges[name])
    return;

  var _target;

  return Promise.resolve()
  .then(function() {
    if (!parent)
      return config.pjson.dependencies[name];

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
        return secondaryDepsPromises[parent] = new Promise(function(resolve, reject) {
          fs.exists(pjsonPath, function(exists) {
            if (exists)
              return resolve();
            pkg.download(parentPkg, {}, resolve).catch(reject);
          });
        })
        .then(function(depMap) {
          if (depMap)
            return depMap;

          return readJSON(pjsonPath)
          .then(function(pjson) {
            return pkg.processDeps(pjson.dependencies || {}, pjson.registry);
          });
        });
      });
    })
    .then(function(deps) {
      return deps[name];
    });
  })
  .then(function(target) {
    if (!target) {
      ui.log('warn', (parent ? '%' + parent + '% dependency %' : '%') + name + '% is not a specified dependency in the package.json.');
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
  return loadExistingForkRanges(pkg)
  .then(function() {
    ui.log('info', '\nInstalled versions of %' + pkg.name + '%');
    visitForkRanges(installed, pkg, function(name, parent, resolved, range) {
      found = true;
      if (range.version == '')
        range.version = '*';
      var rangeVersion = range.name == resolved.name ? range.version : range.exactName;
      if (range.version == '*')
        range.version = '';

      if (!parent)
        ui.log('info', '\n       %' + name + '% `' + resolved.version + '` (' + rangeVersion + ')');
      else {
        if (lastParent != parent) {
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


function showVersions() {
  installed = installed || config.loader;

  var versions = {};

  function addDep(dep) {
    var vList = versions[dep.name] = versions[dep.name] || [];
    if (vList.indexOf(dep.version) == -1)
      vList.push(dep.version);
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
  });

  ui.log('info', 'Installed Versions\n');

  Object.keys(versions).forEach(function(dep) {
    var vList = versions[dep].sort(semver.compare);

    var padding = vLen - dep.length;
    var paddingString = '';
    while(padding--)
      paddingString += ' ';

    ui.log('info', '  ' + paddingString + '%' + dep + '% ' + '`' + vList.join('` `') + '`');
  });
  ui.log('');
}
exports.showVersions = showVersions;









// update == install --latest for existing primaries!
// jspm update --progressive "npm test"
exports.update = function() {
}


