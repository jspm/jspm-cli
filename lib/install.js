var config = require('./config');
var Promise = require('rsvp').Promise;
var asp = require('rsvp').denodeify;
var pkg = require('./package');
var semver = require('./semver');
var PackageName = require('./config/package-name');
var ui = require('./ui');
var path = require('path');

var readJSON = require('./common').readJSON;

var primaryRanges;
var secondaryRanges = {};

var installed;
var installing = {
  baseMap: {},
  depMap: {}
};

var downloads = {};

/*
 * install('jquery', 'jquery', { latest, stable, parent, inject, link } [, seen])
 *
 * Install modes:
 *  - Default  a. The new install tree is set to use exact latest versions of primaries,
 *                including for existing primaries.
 *                Secondaries tend to their latest ideal version.
 *             b. Forks against the existing tree are handled by upgrading the existing
 *                tree, at both primary and secondary levels, with the secondary fork
 *                potentially rolling back as well.
 *             c. Forks within the new tree are deduped for secondaries by checking for 
 *                rollback of the higher version.
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
  var newDownload;

  return config.load()
  .then(function() {
    installed = installed || config.loader;
    primaryRanges = primaryRanges || config.pjson.dependencies;

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
    if (!options.parent && resolution.version.match(semver.semverRegEx))
      target.setVersion('^' + resolution.version);
    
    // b. Forks against the existing tree are handled by upgrading the existing tree, 
    //    at both primary and secondary levels, with the secondary fork potentially rolling back as well.
    return Promise.resolve()
    .then(function() {
      return resolveInstalledForks(name, options.parent, resolution, function(forkVersion, forkRange, secondary) {

        if (semver.match(forkRange, resolution.version))
          return resolution.version;
        
        if (secondary) {
          var secondaryUpgrade = getLatestMatch(forkRange.version);
          if (semver.match(target.version, secondaryUpgrade.version)) {
            resolution.setVersion(secondaryUpgrade.version);
            if (secondaryUpgrade != forkVersion)
              return secondaryUpgrade.version;
          }
        }
      });
    })

    // c. Forks within the new tree are deduped for secondaries by checking for rollback of the higher version
    .then(function() {
      return resolveInstallingForks(name, options.parent, resolution, function(forkVersion, forkRange, secondary) {
        
        // rollback the other secondary to this primary or secondary
        if (secondary && semver.match(forkRange, resolution.version))
          return resolution.version;

        // rollback this secondary install to the other primary or secondary
        if (options.parent && semver.match(target.version, forkVersion))
          resolution.version = forkVersion;

      });
    });
  })
  .then(function() {

    // -- store the resolution --

    var curMap;
    if (options.parent) {
      if (installed.depMap[options.parent])
        existing = true;
      curMap = (existing ? installed : installing).depMap;
      curMap[options.parent] = curMap[options.parent] || {};

      logIfUpdate(name, curMap[options.parent][name], resolution);
      curMap[options.parent][name] = resolution;
    }
    else {
      if (installed.baseMap[name])
        existing = true;
      curMap = (existing ? installed : installing).baseMap;

      logIfUpdate(name, curMap[name], resolution);
      curMap[name] = resolution;
    }

    // update the dependency range tree
    if (!options.parent) {
      primaryRanges[name] = target.copy();
    }
    else {
      secondaryRanges[options.parent] = secondaryRanges[options.parent] || {};
      secondaryRanges[options.parent][name] = target.copy();
    }

    // -- handle circular installs --

    seen = seen || [];
    if (seen.indexOf(resolution.exactName) != -1)
      return;
    seen.push(resolution.exactName);


    // -- download --

    //if (options.link)
    //  return link.symlink(resolution, config.pjson.packages, options)

    if (downloads[resolution.exactName]) {
      newDownload = true;
      return downloads[resolution.exactName];
    }

    return (downloads[resolution.exactName] = pkg.download(resolution, options, downloadDeps))
    .then(function(depMap) {

      // if the endpoint doesn't support preloading, or already installed, run dependency installs after download completion
      if (!dependencyDownloads)
        downloadDeps(depMap);

      // non-primary installs report completion before their dependencies for usability
      if (options.parent && !existing && newDownload)
        ui.log('ok', getInstallVerb(resolution.fresh, options) + ' `' + target.exactName + '` (' + resolution.version + ')');

      return dependencyDownloads;
    })
    .then(function(depMap) {
      if (!options.parent && newDownload)
        ui.log('ok', getInstallVerb(resolution.fresh, options) + ' %' + name + '% as `' + target.exactName + '` (' + resolution.version + ')');
    });

    function downloadDeps(depMap) {
      dependencyDownloads = Promise.all(Object.keys(depMap).map(function(dep) {
        return install(dep, new PackageName(depMap[dep]), {
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

  // then save
  return config.save();
}


function getInstallVerb(fresh, options) {
  var verb;
  if (!fresh) {
    if (options.inject)
      return 'Injected';
    else if (!options.link)
      return 'Installed';
    else
      return 'Linked';
  }
  else {
    if (!options.link)
      return 'Up to date -';
    else
      return 'Already linked -';
  }
}
function getUpdateRangeText(existing, update) {
  if (existing.name == update.name)
    return '`' + existing.version + '` to `' + update.version + '`';
  else
    return '`' + existing.exactName + '` to `' + update.exactName + '`';
}

function logIfUpdate(name, existing, update) {
  if (!existing)
    return;
  if (existing.exactName != update.exactName)
    ui.log('info', 'Updating %' + name + '% from ' + getUpdateRangeText(existing, update) + '.');
}


// check installed dep and base maps for any fork versions of this target
// resolver takes the existing version and range, returns an optional new version
function resolveInstalledForks(name, parent, target, resolve) {
  return resolveForks(name, parent, target, true, resolve);
}

function resolveInstallingForks(name, parent, target, resolve) {
  return resolveForks(name, parent, target, false, resolve);
}

function resolveForks(name, parent, target, existing, resolve) {
  var tree = existing ? installed : installing;

  Object.keys(tree.baseMap).forEach(function(dep) {
    // skip itself
    if (!parent && name == dep)
      return;

    var primary = tree.baseMap[dep];
    if (primary.name != target.name || primary.version == target.version)
      return;

    var newVersion = resolve(primary.version, primaryRanges[dep].version, false);

    if (newVersion) {
      if (existing)
        ui.log('info', (semver.compare(primary.version, newVersion) < 0 ? 'Updating' : 'Deprecating') + ' %' + dep + '% from `' + primary.version + '` to `' + newVersion + '`.');

      primary.setVersion(newVersion);
    }
  });

  // secondary forks
  return Promise.all(Object.keys(tree.depMap).map(function(depParent) {
    
    var curDepMap = tree.depMap[depParent];
    return Promise.all(Object.keys(curDepMap).map(function(dep) {
      // skip itself
      if (depParent == parent && dep == name)
        return;

      var secondary = curDepMap[dep];

      if (secondary.name != target.name || secondary.version == target.version)
        return;

      return loadVersionRange(dep, depParent)
      .then(function(range) {
        // if there was no range (jspm_packages empty), ignore
        if (!range)
          return;

        // if something already installed is out-of-range, log a warning and skip it
        if (secondary.name != range.name || !semver.match(range.version, secondary.version)) {
          ui.log('warn', 'Dependency %' + dep + '% of %' + parent + '% has been altered from the original range, `' + range.exactName + '`, and locked to `' + secondary.exactName + '`.');
          return;
        }

        var newVersion = resolve(secondary.version, range.version, true);

        if (newVersion && newVersion != secondary.version) {
          if (existing)
            ui.log('info', (semver.compare(secondary.version, newVersion) < 0 ? 'Updating' : 'Deprecating') + ' %' + parent + '% dependency `' + secondary.exactName + '` to `' + newVersion + '`.');

          secondary.setVersion(newVersion);
        }
      });

    }));
  }));
}


function loadVersionRange(name, parent) {
  if (!parent)
    return Promise.resolve(primaryRanges[name]);

  return Promise.resolve()
  .then(function() {
    if (secondaryRanges[parent])
      return secondaryRanges[parent];

    var parentPkg = new PackageName(parent);

    return secondaryRanges[parent] = readJSON(path.resolve(parentPkg.getPath(), '.jspm.json'))
    .then(function(pjson) {
      return pkg.processDeps(pjson.dependencies || {}, pjson.registry);
    })
    .then(function(depMap) {
      Object.keys(depMap).forEach(function(p) {
        depMap[p] = new PackageName(depMap[p]);
      });
      return depMap;
    });
  })
  .then(function(deps) {
    return deps[name];
  });
}









// update == install --latest for existing primaries!
// jspm update --progressive "npm test"
exports.update = function() {
}


