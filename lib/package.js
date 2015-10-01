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

var request = require('request');
var ui = require('./ui');
var semver = require('./semver');
var Promise = require('rsvp').Promise;
var asp = require('rsvp').denodeify;
var config = require('./config');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var path = require('path');
var registry = require('./registry');
var PackageName = require('./config/package-name');
var globalConfig = require('./global-config');
var readJSON = require('./common').readJSON;
var ncp = require('ncp');
var fs = require('graceful-fs');
var glob = require('glob');
var minimatch = require('minimatch');
var md5 = require('./common').md5;
var processDeps = require('./common').processDeps;
var extend = require('./common').extend;
var dextend = require('./common').dextend;

var jspmVersion = require('../package.json').version.split('.').splice(0, 2).join('.');

// we cache registry lookups here to allow reductions in config saving
var registryCache = exports.registryCache = {};

// given a name like 'jquery', 'github:repo/thatwasmoved'
// add the default registry endpoint to the name
// so we now have 'jspm:jquery', 'github:repo/thatwasmoved'
// then run the locate hook (if provided) of the registry
// following redirects until the locate hook converges
// getting 'github:components/jquery' and 'github:repo/redirected'
// at this point, we have the final name for the target
var locateCache = {};
// target is a PackageName object
exports.locate = locate;
function locate(target) {
  if (!target.registry) {
    target = new PackageName(target.exactName);
    target.setRegistry(globalConfig.config.defaultRegistry);
  }

  var endpoint = registry.load(target.registry);

  if (!endpoint.locate)
    return Promise.resolve(target);

  locateCache[target.registry] = locateCache[target.registry] || {};

  // NB enable versioned locate
  return Promise.resolve()
  .then(function() {
    if (locateCache[target.registry][target.package])
      return locateCache[target.registry][target.package];

    return (locateCache[target.registry][target.package] = Promise.resolve(endpoint.locate(target.package))
    .then(function(located) {
      // NB support versioned registry
      if (target.registry === globalConfig.config.defaultRegistry)
        registryCache[target.package] = located.redirect;
      return located;
    }));
  })
  .then(function(located) {
    if (!located)
      return target;

    if (located.redirect) {
      var redirectPkg = new PackageName(located.redirect);

      // mutate the target by the redirect
      // this ensures we always store resolved targets
      target.setRegistry(redirectPkg.registry);
      target.setPackage(redirectPkg.package);

      return locate(target);
    }

    if (located.notfound)
      throw 'Repo `' + target.name + '` not found.' +
        (target.registry != 'npm' && target.package.split('/').length == 1 ? ' Perhaps try %jspm install npm:' + target.package + '%.' : '');

    throw 'Invalid registry locate response for %' + target.registry + '%';
  }, function(e) {
    if (e)
      ui.log('err', e.stack || e);
    throw 'Error locating `' + target.name + '`.';
  });
}

var lookupPromises = {};
var lookups = {};

exports.lookup = lookup;
function lookup(pkg, edge) {
  return Promise.resolve()
  // load the version map
  .then(function() {
    // already loaded
    if (lookups[pkg.name])
      return { versions: lookups[pkg.name] };

    // already loading
    if (lookupPromises[pkg.name])
      return lookupPromises[pkg.name];

    ui.log('info', 'Looking up `' + pkg.name + '`');
    return (lookupPromises[pkg.name] = Promise.resolve(registry.load(pkg.registry).lookup(pkg.package)));
  })
  .then(function(lookup) {
    if (lookup.notfound)
      throw 'Repo `' + pkg.name + '` not found!';

    if (!lookup.versions)
      throw 'Invalid registry lookup response for %' + pkg.registry + '%';

    lookups[pkg.name] = lookup.versions;

    return function(version) {
      var opts = {edge: edge, latestVersion: lookup.latest};
      var lookupObj = getVersionMatch(version, lookup.versions, opts);
      if (!lookupObj)
        return;

      return new PackageName(pkg.name + '@' + lookupObj.version, true);
    };
  }, function(e) {
    if (e)
      ui.log('err', e.stack || e);

    throw 'Error looking up `' + pkg.name + '`.';
  });
}

// exported for unit testing
exports.getVersionMatch = getVersionMatch;
function getVersionMatch(pkgVersion, versions, options) {
  // unescape pkgVersion for comparison
  if (pkgVersion)
    pkgVersion = decodeURIComponent(pkgVersion);

  var version;
  var stableSemver = [];
  var unstableSemver = [];
  var stableExact = [];
  var unstableExact = [];
  var edge = options && options.edge;

  Object.keys(versions).forEach(function(v) {
    version = versions[v];
    var stable = version.stable;
    var semverMatch = v.match(semver.semverRegEx);
    var valid = semverMatch && semverMatch[1] && semverMatch[2] && semverMatch[3];
    var pre = valid && semverMatch[4];

    // store a reverse lookup
    version.version = v;

    // ignore non-semver or prerelease, unless explictly marked as stable
    if (!valid) {
      // unstable unless explicitly stable. in --edge prioritize all after 'master'
      if (stable && !edge)
        stableExact.push(v);
      else
        unstableExact.push(v);
    }
    // stable unless explicitly unstable or indetermate and a prerelease
    // --edge considers all semver to be stable
    else if (!edge && (stable === false || (stable !== true && pre)))
      unstableSemver.push(v);
    else
      stableSemver.push(v);
  });

  function compareDesc(a, b) {
    return semver.compare(b, a);
  }

  if (!pkgVersion) {
    var latest = options && options.latestVersion && versions[options.latestVersion];
    if (!edge && latest)
      return latest;
    stableSemver.sort(compareDesc);

    if (stableSemver[0])
      return versions[stableSemver[0]];

    unstableSemver.sort(compareDesc);
    if (unstableSemver[0])
      return versions[unstableSemver[0]];

    if (latest)
      return latest;

    stableExact.sort();
    if (stableExact[0])
      return versions[stableExact[0]];

    // an ugly practicality. ideally designed out in future.
    if (versions.master)
      return versions.master;

    unstableExact.sort();
    if (unstableExact[0])
      return versions[unstableExact[0]];
  }
  else {
    var i, ver;
    stableSemver.sort(compareDesc);
    // find highest stable match in tags
    for (i = 0; i < stableSemver.length; i++) {
      ver = stableSemver[i];
      var match = edge ? semver.matchUnstable : semver.match;
      if (match(pkgVersion, ver))
        return versions[ver];
    }
    unstableSemver.sort(compareDesc);
    for (i = 0; i < unstableSemver.length; i++) {
      ver = unstableSemver[i];
      if (semver.match(pkgVersion, ver))
        return versions[ver];
    }
    // finally check for an exact tag match
    if (versions[pkgVersion])
      return versions[pkgVersion];
  }
}

function getOverride(pkg, manualOverride) {
  return Promise.resolve()
  .then(function() {
    // first check if the package is already installed
    // if so, then the override used is the one in the package.json (even if not present)
    // this is to ensure full reproducibility without relying on registry after initial install
    if (!config.loader.upgrade16) {
      var alreadyInstalled = Object.keys(config.loader.baseMap).some(function(dep) {
        return config.loader.baseMap[dep].exactName == pkg.exactName;
      }) || Object.keys(config.loader.depMap).some(function(dep) {
        var pkgMap = config.loader.depMap[dep];
        return Object.keys(pkgMap).some(function(dep) {
          return pkgMap[dep].exactName == pkg.exactName;
        });
      });

      if (alreadyInstalled) {
        var override = extend(config.pjson.overrides[pkg.exactName] || {}, manualOverride);
        // persist the manual override
        config.pjson.overrides[pkg.exactName] = override;
        return Promise.resolve(override);
      }
    }
    // 0.16 upgrade path must use registry override + package.json override + manual override
    // also override just needs to match the version
    // NB deprecate with 0.16
    else {
      var overrideVersion = Object.keys(config.pjson.overrides)
      .filter(function(overrideName) {
        return overrideName.startsWith(pkg.name + '@');
      })
      .map(function(overrideName) {
        return overrideName.split('@').pop();
      })
      .filter(function(overrideVersion) {
        return semver.match('^' + overrideVersion, pkg.version);
      })
      .sort(semver.compare).pop();

      if (overrideVersion)
        manualOverride = extend(config.pjson.overrides[pkg.name + '@' + overrideVersion], manualOverride);
    }

    // otherwise use the registry override + manual override
    var endpoint = registry.load(globalConfig.config.defaultRegistry);
    return endpoint.getOverride(pkg.registry, pkg.package, pkg.version, manualOverride)
    .then(function(override) {
      // persist the override for reproducibility
      config.pjson.overrides[pkg.exactName] = override;
      return override;
    });
  });
}

var injecting = {};
exports.inject = function(pkg, depLoad) {
  if (injecting[pkg.exactName]) {
    injecting[pkg.exactName].depLoad.then(function(depMap) {
      depLoad(depMap);
      return depMap;
    });
    return injecting[pkg.exactName].promise;
  }

  injecting[pkg.exactName] = {};

  var depResolve, depReject;
  injecting[pkg.exactName].depLoad = new Promise(function(resolve, reject) {
    depResolve = resolve;
    depReject = reject;
  })
  .then(function(depMap) {
    depLoad(depMap);
    return depMap;
  });

  var remote = registry.load(pkg.registry).remote;

  if (!remote)
    throw 'Cannot inject from registry %' + pkg.registry + '% as it has no remote.';

  // NB remove rejectUnauthorized
  var url = remote + (remote.endsWith('/') ? '' : '/') + pkg.exactName.substr(pkg.exactName.indexOf(':') + 1) + '/.jspm.json';
  injecting[pkg.exactName].promise = asp(request)({
    method: 'get',
    url: url,
    rejectUnauthorized: false
  }).then(function(res) {
    if (res.statusCode !== 200)
      throw new Error('Error requesting package config for `' + pkg.exactName + '` at %' + url + '%.');

    try {
      return JSON.parse(res.body);
    }
    catch(e) {
      throw new Error('Unable to parse package config');
    }
  })
  .then(function(pjson) {
    depResolve(processDeps(pjson.dependencies, pjson.registry));
    return pjson;
  }, depReject);
  return injecting[pkg.exactName].promise;
};



// note if it is a symlink, we leave it unaltered
var downloading = {};
// options.override
// options.quick
// options.force
// options.linked
exports.download = function(pkg, options, installDeps, installPeerDeps) {
  // called once or twice
  function depsCallback(deps) {
    if (installDeps)
      installDeps(deps);
    return deps;
  }

  // download queue
  if (downloading[pkg.exactName]) {
    downloading[pkg.exactName].preload.then(depsCallback);
    downloading[pkg.exactName].postload.then(depsCallback);
    return downloading[pkg.exactName].promise;
  }
  var postloadResolve, preloadResolve;
  downloading[pkg.exactName] = {
    preload: new Promise(function(resolve) {
      preloadResolve = resolve;
    })
    .then(depsCallback),
    postload: new Promise(function(resolve) {
      postloadResolve = resolve;
    })
    .then(depsCallback)
  };

  // download
  var downloadDir = pkg.getPath();
  var getPackageConfigPromise;
  var override;

  downloading[pkg.exactName].promise = Promise.resolve()
  .then(function() {
    // determine the override
    return getOverride(pkg, options.override);
  })
  .then(function(_override) {
    override = dextend({}, _override);

    // check if the folder exists
    return new Promise(function(resolve) {
      fs.exists(downloadDir, resolve);
    });
  })
  .then(function(dirExists) {
    // quick skips actual hash checks and dependency reinstalls
    if (options.quick && !options.override && dirExists)
      return true;

    var fullHash;

    // check freshness
    return Promise.resolve()
    .then(function() {
      // ensure lookup data is present
      if (!lookups[pkg.name] && !options.linked)
        return lookup(pkg);
    })
    .then(function() {
      return getPackageHash(downloadDir);
    })
    .then(function(pkgHash) {
      if (options.force)
        return false;

      // determine the full hash of the package
      var hash = lookups[pkg.name] && lookups[pkg.name][pkg.version].hash || 'link';
      var endpoint = registry.load(pkg.registry);

      fullHash = hash + md5(JSON.stringify(override)) + endpoint.versionString + jspmVersion;

      return pkgHash === fullHash;
    })
    .then(function(fresh) {
      if (fresh) {
        // this can't trigger twice, so if its a second call its just a noop
        preloadResolve(config.deps[pkg.exactName]);
        return true;
      }

      // clear stored dependency cache
      delete config.deps[pkg.exactName];

      // if linked, process the symlinked folder
      if (options.linked) {
        ui.log('info', 'Processing configuration for linked package `' + pkg.exactName + '`');

        return Promise.resolve(readJSON(path.resolve(downloadDir, 'package.json')))
        .then(function(packageConfig) {
          return derivePackageConfig(pkg, packageConfig, override);
        }, function(err) {
          if (err)
            ui.log('err', err && err.stack || err);
          throw 'Error processing linked package `' + pkg.exactName + '`.';
        })
        .then(function(packageConfig) {
          return processPackage(pkg, downloadDir, packageConfig);
        })
        .then(function(packageConfig) {
          return createLoaderConfig(pkg, packageConfig, downloadDir)
          .then(function() {
            var depRanges = getDepRanges(pkg, packageConfig);
            postloadResolve(depRanges.deps);
            if (depRanges.peerDeps && installPeerDeps)
              installPeerDeps(depRanges.peerDeps);
          });
        })
        .then(function() {
          return false;
        });
      }

      if (pkg.registry == 'local')
        throw '`' + pkg.exactName + '` must be linked to be used in installs.';

      var cacheDir = path.resolve(config.HOME, '.jspm', 'packages', pkg.registry, pkg.exactPackage);

      // ensure global cache is fresh / download if not
      return Promise.resolve()
      .then(function() {
        if (config.force)
          return false;

        return getPackageHash(cacheDir)
        .then(function(hash) {
          return hash && hash === fullHash;
        });
      })
      .then(function(cacheFresh) {
        // global cach is fresh
        // read the cache .deps.json file containing the deps ranges
        if (cacheFresh)
          return readJSON(cacheDir + '.deps.json')
          .then(function(depJSON) {
            var depRanges = getDepRanges(pkg, depJSON);
            preloadResolve(depRanges.deps);
            if (depRanges.peerDeps && installPeerDeps)
              installPeerDeps(depRanges.peerDeps);
          });

        ui.log('info', 'Downloading `' + pkg.exactName + '`');

        var endpoint = registry.load(pkg.registry);
        var lookupObj = lookups[pkg.name][pkg.version];

        if (endpoint.getPackageConfig)
          getPackageConfigPromise = Promise.resolve()
          .then(function() {
            return endpoint.getPackageConfig(pkg.package, pkg.version, lookupObj.hash, lookupObj.meta);
          })
          .then(function(packageConfig) {
            return derivePackageConfig(pkg, packageConfig, override);
          }, function() {
            throw 'Error getting package config for `' + pkg.name + '`.';
          })
          .then(function(packageConfig) {
            var depRanges = getDepRanges(pkg, packageConfig);
            preloadResolve(depRanges.deps);
            if (depRanges.peerDeps && installPeerDeps)
              installPeerDeps(depRanges.peerDeps);
            return packageConfig;
          });

        return Promise.resolve(cacheDir)
        // ensure the download directory exists
        .then(asp(mkdirp))
        // clear the directory
        .then(function() {
          return asp(rimraf)(cacheDir);
        })
        // create it
        .then(function() {
          return asp(mkdirp)(cacheDir);
        })
        // do the download
        .then(function() {
          return endpoint.download(pkg.package, pkg.version, lookupObj.hash, lookupObj.meta, cacheDir);
        })

        // process the package fully
        .then(function(packageConfig) {
          // if we have a getPackageConfig, we use that packageConfig
          if (endpoint.getPackageConfig)
            return getPackageConfigPromise;

          // registries must always encode the package.json config reading themselves
          return Promise.resolve(packageConfig || {})
          .then(function(packageConfig) {
            return derivePackageConfig(pkg, packageConfig, override);
          });
        }, function(err) {
          if (err)
            ui.log('err', err && err.stack || err);
          throw 'Error downloading `' + pkg.name + '`.';
        })
        .then(function(packageConfig) {
          return processPackage(pkg, cacheDir, packageConfig);
        })
        // create the config file in the cache folder
        .then(function(packageConfig) {
          return createLoaderConfig(pkg, packageConfig, cacheDir)
          .then(function() {
            return packageConfig;
          });
        })
        // create the deps file in the cache folder
        .then(function(packageConfig) {
          var depRanges = getDepRanges(pkg, packageConfig);
          postloadResolve(depRanges.deps);
          if (depRanges.peerDeps && installPeerDeps)
            installPeerDeps(depRanges.peerDeps);
          var rangeMap = { deps: {}, peerDeps: {} };
          Object.keys(depRanges.deps).forEach(function(dep) {
            rangeMap.deps[dep] = depRanges.deps[dep].exactName;
          });
          Object.keys(depRanges.peerDeps).forEach(function(dep) {
            rangeMap.peerDeps[dep] = depRanges.peerDeps[dep].exactName;
          });
          return asp(fs.writeFile(cacheDir + '.deps.json', JSON.stringify(rangeMap, null, 2)));
        })
        // we've now finished creating the cache directory
        .then(function() {
          return asp(fs.writeFile)(path.resolve(cacheDir, '.jspm-hash'), fullHash);
        });
      })

      // copy global cache to local install
      // clear the directory
      .then(function() {
        // in case it was linked, try and remove
        return asp(fs.unlink)(downloadDir)
        .catch(function(e) {
          if (e.code === 'EISDIR' || e.code === 'EPERM' || e.code === 'ENOENT')
            return;
          throw e;
        });
      })
      .then(function() {
        return asp(mkdirp)(downloadDir);
      })
      .then(function() {
        return asp(rimraf)(downloadDir);
      })
      .then(function() {
        return asp(ncp)(cacheDir, downloadDir);
      })
      .then(function() {
        // copy config file from cached folder (if it exists)
        return asp(ncp)(cacheDir + '.json', downloadDir + '.json')
        .catch(function(err) {
          if (err instanceof Array)
            err = err[0];
          if (err.code == 'ENOENT')
            return;
          throw err;
        });
      })
      .then(function() {
        return fresh;
      });
    });
  });
  return downloading[pkg.exactName].promise;
};

function getPackageHash(dir) {
  return new Promise(function(resolve) {
    fs.exists(dir + '.json', function(exists) {
      resolve(exists);
    });
  })
  .then(function(hasConfig) {
    if (!hasConfig)
      return null;

    // otherwise do the hash check
    return asp(fs.readFile)(path.resolve(dir, '.jspm-hash'))
    .then(function(hash) {
      return hash.toString();
    }, function(err) {
      if (err.code === 'ENOENT')
        return null;
      throw err;
    });
  });
}

// return the dependency install range object
// while also setting it on the config.deps cache
// note it is important that we return the config.deps by reference
// that is because when installed, locate redirects mutate this to ensure
// targets all resolve out of registry mappings for reproducibility
function getDepRanges(pkg, packageConfig) {
  var depRanges = config.deps[pkg.exactName] = config.deps[pkg.exactName] || {};
  
  var newDepRanges = processDeps(packageConfig.dependencies, packageConfig.registry);
  var peerDepRanges = processDeps(packageConfig.peerDependencies, packageConfig.registry);

  // dont install re-mapped dependencies
  if (packageConfig.map)
    Object.keys(packageConfig.map).forEach(function(dep) {
      if (depRanges[dep])
        delete depRanges[dep];
      if (peerDepRanges[dep])
        delete peerDepRanges[dep];
    });
  
  // ensure depRanges is an exact reference to the config.deps ranges
  // so we can mutate the resolutions
  Object.keys(newDepRanges).forEach(function(dep) {
    if (depRanges[dep])
      return;

    depRanges[dep] = newDepRanges[dep];
  });

  return {
    deps: depRanges,
    peerDeps: peerDepRanges
  };
}

// like config.derivePackageConfig, but applies the
// registry processPackageConfig operation as well
function derivePackageConfig(pkg, packageConfig, override) {
  packageConfig = config.derivePackageConfig(packageConfig, override);

  var endpoint = registry.load(packageConfig.registry || pkg.registry);
  return Promise.resolve(endpoint.processPackageConfig ? endpoint.processPackageConfig(packageConfig, pkg.exactName) : packageConfig)
  .then(function(packageConfig) {
    if (!packageConfig)
      throw new Error('processPackageConfig must return the processed configuration object.');
    packageConfig.registry = packageConfig.registry || pkg.registry;
    return packageConfig;
  })
  .catch(function() {
    throw 'Error processing package config for `' + pkg.name + '`.';
  });
}


// apply registry process to package config given completed download folder and config
function processPackage(pkg, dir, packageConfig) {
  // any package which takes longer than 10 seconds to process
  var timeout = setTimeout(function() {
    ui.log('warn', 'It\'s taking a long time to process the dependencies of `' + pkg.exactName + '`.\n' +
      'This package may need an %ignore% property to indicate test or example folders for jspm to skip.\n');
  }, 10000);
  var endpoint = registry.load(packageConfig.registry || pkg.registry);

  return Promise.resolve(filterIgnoreAndFiles(dir, packageConfig.ignore, packageConfig.files))
  .then(function() {
    // now that we have the derived packageConfig, do the registry build
    if (endpoint.processPackage)
      return endpoint.processPackage(packageConfig, pkg.exactName, dir)
      .catch(function(e) {
        throw 'Error building package `' + pkg.exactName + '`.\n' + (e && e.stack || e);
      })
      .then(function(packageConfig) {
        if (!packageConfig)
          throw new Error('Registry endpoint processPackage of ' + pkg.exactName + ' did not return package config.');
        return packageConfig;
      });
    else
      return packageConfig;
  })

  // apply build operations from the package config
  .then(function(packageConfig) {
    // 0.16 Upgrade Path:
    // shim becomes meta
    if (packageConfig.shim) {
      packageConfig.meta = packageConfig.meta || {};

      for (var s in packageConfig.shim) {
        // ignore shim if there is any meta config for this module
        if (packageConfig.meta[s + '.js'])
          continue;
        
        var curShim = packageConfig.shim[s];
        var curMeta = packageConfig.meta[s + '.js'] = {};

        if (curShim instanceof Array) {
          curMeta.deps = curShim;
        }
        else if (typeof curShim == 'object') {
          if (curShim.deps)
            curMeta.deps = curShim.deps;
          else if (curShim.imports)
            curMeta.deps = curShim.imports;

          if (curShim.exports)
            curMeta.exports = curShim.exports;
        }

        curShim.format = 'global';
      }
    }
    // directories.lib/dist becomes baseDir
    if (!packageConfig.baseDir && packageConfig.directories && (packageConfig.directories.dist || packageConfig.directories.lib))
      packageConfig.baseDir = packageConfig.directories.dist || packageConfig.directories.lib;

    clearTimeout(timeout);
    return packageConfig;
  });
}

// filter files in a downloaded package to just the [files] and [ignore]
function inDir(fileName, dir, sep) {
  return fileName.substr(0, dir.length) === dir && (sep === false || fileName.substr(dir.length - 1, 1) === path.sep);
}
function filterIgnoreAndFiles(dir, ignore, files) {
  if (!ignore && !files)
    return Promise.resolve();

  return asp(glob)(dir + path.sep + '**' + path.sep + '*', {dot: true})
  .then(function(allFiles) {
    var removeFiles = [];

    allFiles.forEach(function(file) {
      var fileName = path.relative(dir, file).replace(/\\/g, '/');

      // if files, remove all files except those in the files list
      if (files && !files.some(function(keepFile) {
        if (keepFile.startsWith('./'))
          keepFile = keepFile.substr(2);

        // this file is in a keep dir, or a keep file, don't exclude
        if (inDir(fileName, keepFile, false) || minimatch(fileName, keepFile))
          return true;
      }))
        return removeFiles.push(fileName);

      // if ignore, ensure removed
      if (ignore && ignore.some(function(ignoreFile) {
        if (ignoreFile.startsWith('./'))
          ignoreFile = ignoreFile.substr(2);
        // this file is in an ignore dir or an ignore file, ignore
        if (inDir(fileName, ignoreFile, false) || minimatch(fileName, ignoreFile))
          return true;
      }))
        removeFiles.push(fileName);
    });

    // do removal
    return Promise.all(removeFiles.map(function(removeFile) {
      return asp(fs.unlink)(path.resolve(dir, removeFile)).catch(function(e) {
        if (e.code === 'EPERM' || e.code === 'EISDIR' || e.code === 'ENOENT')
          return;
        throw e;
      });
    }));
  });
}

var loaderConfigProperties = ['baseDir', 'defaultExtension', 'format', 'meta', 'map', 'main'];

function createLoaderConfig(pkg, packageConfig, downloadDir) {
  // systemjs prefix property in package.json takes preference
  if (packageConfig.systemjs)
    packageConfig = packageConfig.systemjs;

  var loaderConfig = {};
  for (var p in packageConfig)
    if (loaderConfigProperties.indexOf(p) != -1)
      loaderConfig[p] = packageConfig[p];

  return asp(fs.writeFile)(downloadDir + '.json', JSON.stringify(loaderConfig, null, 2));
}
