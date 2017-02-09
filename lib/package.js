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

var request = require('request');
var ui = require('./ui');
var semver = require('./semver');
var asp = require('bluebird').Promise.promisify;
var config = require('./config');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var path = require('path');
var registry = require('./registry');
var PackageName = require('./package-name');
var globalConfig = require('./config/global-config');
var readJSON = require('./common').readJSON;
var ncp = require('ncp');
var fs = require('graceful-fs');
var glob = require('glob');
var minimatch = require('minimatch');
var md5 = require('./common').md5;
var processDeps = require('./common').processDeps;
var extend = require('./common').extend;
var HOME = require('./common').HOME;
var Promise = require('bluebird');
var newLine = require('./common').newLine;

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

    ui.log('debug', 'Looking up `' + pkg.name + '`');
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

      return new PackageName(pkg.name + '@' + lookupObj.version);
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

  if (versions[pkgVersion]) {
    versions[pkgVersion].version = pkgVersion;
    return versions[pkgVersion];
  }

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
  }
}

function getOverride(pkg, manualOverride, alreadyInstalled) {
  return Promise.resolve()
  .then(function() {
    // if the package is not installed, but we have a local override match, then use that
    var existingOverride = config.pjson.overrides[pkg.exactName];
    if (!alreadyInstalled && !existingOverride) {
      var existingOverrideVersion = Object.keys(config.pjson.overrides)
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
      if (existingOverrideVersion)
        existingOverride = JSON.parse(JSON.stringify(config.pjson.overrides[pkg.name + '@' + existingOverrideVersion]));
    }

    if ((alreadyInstalled || existingOverride) && !manualOverride)
      return Promise.resolve(config.pjson.overrides[pkg.exactName] = existingOverride || {});

    // otherwise use the registry override + manual override
    var endpoint = registry.load(globalConfig.config.defaultRegistry);
    return endpoint.getOverride(pkg.registry, pkg.package, pkg.version, manualOverride)
    .then(function(override) {
      for (var p in override)
        if (override[p] === undefined)
          delete override[p];

      override = override || {};
      // persist the override for reproducibility
      config.pjson.overrides[pkg.exactName] = override;
      return override;
    });
  })
  .then(function(override) {
    var packageConfig = typeof override.systemjs == 'object' ? override.systemjs : override;
    upgradePackageConfig(packageConfig);
    return override;
  });
}

exports.upgradePackageConfig = upgradePackageConfig;
function upgradePackageConfig(packageConfig) {
  // 0.16 Package Config Override Upgrade Path:
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

      curMeta.format = 'global';

      if (typeof curMeta.deps === 'string')
        curMeta.deps = [curMeta.deps];
    }
    delete packageConfig.shim;
  }
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
exports.download = function(pkg, options, depsCallback) {
  // download queue
  if (downloading[pkg.exactName]) {
    downloading[pkg.exactName].preloadCallbacks.push(depsCallback);
    downloading[pkg.exactName].postloadCallbacks.push(depsCallback);
    return downloading[pkg.exactName].promise;
  }

  // track the deps sent to the deps callback to avoid duplication between preload and postload
  var sentDeps = [];
  function doDepsCallback(depRanges) {
    var sendRanges = { deps: {}, peerDeps: {} };
    Object.keys(depRanges.deps).forEach(function(dep) {
      if (sentDeps.indexOf(dep) == -1)
        sendRanges.deps[dep] = depRanges.deps[dep];
    });
    Object.keys(depRanges.peerDeps).forEach(function(dep) {
      if (sentDeps.indexOf(dep) == -1)
        sendRanges.peerDeps[dep] = depRanges.peerDeps[dep];
    });
    sentDeps = sentDeps.concat(Object.keys(sendRanges.deps)).concat(Object.keys(sendRanges.peerDeps));
    depsCallback(sendRanges);
  }

  // callbacks as we need a synchronous guarantee of resolution
  // before the download promise
  var preloadCallbacks = [doDepsCallback];
  var postloadCallbacks = [doDepsCallback];
  function preloadResolve(depRanges) {
    preloadCallbacks.forEach(function(cb) {
      cb(depRanges);
    });
  }
  function postloadResolve(depRanges) {
    postloadCallbacks.forEach(function(cb) {
      cb(depRanges);
    });
  }

  downloading[pkg.exactName] = {
    preloadCallbacks: preloadCallbacks,
    postloadCallbacks: postloadCallbacks
  };

  // download
  var downloadDir = pkg.getPath();
  var getPackageConfigError;
  var getPackageConfigPromise;
  var override;

  return (downloading[pkg.exactName].promise = Promise.resolve()
  .then(function() {
    // determine the override
    return getOverride(pkg, options.override, options.alreadyInstalled);
  })
  .then(function(_override) {
    override = _override;

    // check if the folder exists
    return new Promise(function(resolve) {
      fs.exists(downloadDir, resolve);
    });
  })
  .then(function(dirExists) {
    // quick skips actual hash checks and dependency reinstalls
    if (options.quick && !options.override && dirExists)
      return true;

    var fullHash, cfgHash;

    // check freshness
    return Promise.resolve()
    .then(function() {
      // ensure lookup data is present
      if (!lookups[pkg.name] && !options.linked)
        return lookup(pkg);
    })
    .then(function() {
      if ((!lookups[pkg.name] || !lookups[pkg.name][pkg.version]) && !options.linked)
        throw 'Unable to resolve version %' + pkg.version + '% for `' + pkg.package + '`.';

      return getPackageHash(downloadDir);
    })
    .then(function(hashes) {
      // if the package exists locally, hash the package@x.y.z.json file to see if it has been changed
      // if it has been changed then add the altered package@x.y.z.json contents
      // to the overrides as an override, and note that we have done this
      if (hashes[1]) {
        return readJSON(downloadDir + '.json')
        .then(function(pkgConfig) {
          if (computeConfigHash(pkgConfig) == hashes[1])
            return;

          for (var c in pkgConfig) {
            if (JSON.stringify(pkgConfig[c]) !== JSON.stringify(override[c]))
              override[c] = pkgConfig[c];
          }
          // overrides usually extend, so to indicate that we want this to be the final override
          // we set empty values explicitly
          // if (!override.defaultExtension)
          //  override.defaultExtension = false;
          if (!override.format)
            override.format = 'detect';
          if (!override.meta)
            override.meta = {};
          if (!override.map)
            override.map = {};

          ui.log('ok', 'The package configuration file `' + path.relative(path.dirname(config.pjsonPath), downloadDir + '.json') +
                '` has been edited manually. To avoid overwriting the change, it has been added to the package.json overrides.');

          return hashes[0];
        }, function(err) {
          if (typeof err === 'string' && err.startsWith('Error parsing') || err.code == 'ENOENT')
            return null;
          throw err;
        });
      }

      return hashes[0];
    })
    .then(function(pkgHash) {
      if (options.force)
        return false;

      fullHash = computePackageHash(pkg, override);

      return pkgHash === fullHash;
    })
    .then(function(fresh) {
      if (fresh && config[pkg.exactName]) {
        // this can't trigger twice, so if its a second call its just a noop
        preloadResolve(config.deps[pkg.exactName]);
        return true;
      }

      // clear stored dependency cache for download
      delete config.deps[pkg.exactName];

      // if linked, process the symlinked folder
      if (options.linked && !options.unlink) {
        ui.log('info', 'Processing linked package `' + pkg.exactName + '`');

        return Promise.resolve(readJSON(path.resolve(downloadDir, 'package.json')))
        .then(function(packageConfig) {
          return derivePackageConfig(pkg, packageConfig, override);
        })
        .then(function(packageConfig) {
          return processPackage(pkg, downloadDir, packageConfig, options.linked);
        }, function(err) {
          if (err)
            ui.log('err', err && err.stack || err);
          throw 'Error processing linked package `' + pkg.exactName + '`.';
        })
        .then(function(packageConfig) {
          return createLoaderConfig(pkg, packageConfig, downloadDir)
          .then(function() {
            postloadResolve(getDepRanges(pkg, packageConfig));
          });
        })
        .then(function() {
          return false;
        });
      }

      if (pkg.registry == 'local')
        throw '`' + pkg.exactName + '` must be linked to be used in installs.';

      var cacheDir = pkg.getPath(path.resolve(HOME, '.jspm', 'packages'));

      // ensure global cache is fresh / download if not
      return Promise.resolve()
      .then(function() {
        if (config.force)
          return false;

        return getPackageHash(cacheDir)
        .then(function(hashes) {
          return hashes[0] && hashes[0] === fullHash;
        });
      })
      .then(function(cacheFresh) {
        // global cache is fresh
        // read the cache .deps.json file containing the deps ranges
        if (cacheFresh)
          return readJSON(cacheDir + '.deps.json')
          .then(function(depJSON) {
            var depRanges = getDepRanges(pkg, depJSON);
            if (!depRanges.deps)
              throw new TypeError('Invalid deps format!');
            preloadResolve(depRanges);
            return null;
          });

        ui.log('info', 'Downloading `' + pkg.exactName + '`');

        var endpoint = registry.load(pkg.registry);
        var lookupObj = lookups[pkg.name][pkg.version];

        getPackageConfigPromise = Promise.resolve()
        .then(function() {
          if (endpoint.getPackageConfig)
            return endpoint.getPackageConfig(pkg.package, pkg.version, lookupObj.hash, lookupObj.meta);
        })
        .then(function(packageConfig) {
          if (!packageConfig)
            return;
          return derivePackageConfig(pkg, packageConfig, override)
          .then(function(packageConfig) {
            preloadResolve(getDepRanges(pkg, packageConfig));
            return packageConfig;
          });
        })
        .catch(function(err) {
          getPackageConfigError = err;
        });

        return Promise.resolve(cacheDir)
        // ensure the download directory exists
        .then(asp(mkdirp))
        // clear the directory
        .then(function() {
          return asp(rimraf)(cacheDir);
        })
        .then(function() {
          try {
            fs.unlinkSync(cacheDir + '.js');
          }
          catch(e) {}
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
        .then(function(downloadPackageConfig) {
          if (getPackageConfigError)
            return Promise.reject(getPackageConfigError);

          return getPackageConfigPromise
          .then(function(packageConfig) {
            // if we have a getPackageConfig, we always use that packageConfig
            if (packageConfig)
              return packageConfig;

            // otherwise get from the repo
            return Promise.resolve(downloadPackageConfig || readJSON(path.resolve(cacheDir, 'package.json')))
            .then(function(packageConfig) {
              return derivePackageConfig(pkg, packageConfig, override)
              .then(function(packageConfig) {
                preloadResolve(getDepRanges(pkg, packageConfig));
                return packageConfig;
              });
            });
          });
        })
        .then(function(packageConfig) {
          // recompute hash in case override was deduped
          fullHash = computePackageHash(pkg, override);
          return processPackage(pkg, cacheDir, packageConfig);
        })
        // create the config file in the cache folder
        .then(function(packageConfig) {
          return createLoaderConfig(pkg, packageConfig, cacheDir)
          .then(function(loaderConfig) {
            cfgHash = computeConfigHash(loaderConfig);
            return packageConfig;
          });
        })
        // create the deps file in the cache folder
        .then(function(packageConfig) {
          var depRanges = getDepRanges(pkg, packageConfig);
          var rangeMap = { dependencies: {}, peerDependencies: {} };
          Object.keys(depRanges.deps).forEach(function(dep) {
            rangeMap.dependencies[dep] = depRanges.deps[dep].exactName;
          });
          Object.keys(depRanges.peerDeps).forEach(function(dep) {
            rangeMap.peerDependencies[dep] = depRanges.peerDeps[dep].exactName;
          });
          fs.writeFileSync(cacheDir + '.deps.json', JSON.stringify(rangeMap, null, 2));
          fs.writeFileSync(path.resolve(cacheDir, '.jspm-hash'), fullHash + newLine + cfgHash);

          // postloadResolve creates a promise so we need to return null for Bluebird warnings
          postloadResolve(depRanges);
          return null;
        });
      })

      // copy global cache to local install
      // clear the directory
      .then(function() {
        // in case it was linked, try and remove
        try {
          fs.unlinkSync(downloadDir);
        }
        catch(e) {
          if (e.code === 'EISDIR' || e.code === 'EPERM' || e.code === 'ENOENT')
            return;
          throw e;
        }
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
        // copy config file from cached folder
        return asp(ncp)(cacheDir + '.json', downloadDir + '.json');
      })
      .then(function() {
        // bump the modified time of the .jspm-hash so that it matches the config file time
        return asp(fs.utimes)(path.resolve(downloadDir, '.jspm-hash'), new Date() / 1000, new Date() / 1000);
      })
      .then(function() {
        return fresh;
      });
    });
  }));
};

function getPackageHash(dir) {
  return new Promise(function(resolve) {
    fs.exists(dir + '.json', function(exists) {
      resolve(exists);
    });
  })
  .then(function(hasConfig) {
    if (!hasConfig)
      return [];

    // otherwise do the hash check
    return asp(fs.readFile)(path.resolve(dir, '.jspm-hash'))
    .then(function(hash) {
      return hash.toString().split(/\n|\r/);
    }, function(err) {
      if (err.code === 'ENOENT')
        return [];
      throw err;
    });
  });
}

function computePackageHash(pkg, override) {
  // determine the full hash of the package
  var hash = lookups[pkg.name] && lookups[pkg.name][pkg.version].hash || 'link';
  var endpoint = registry.load(pkg.registry);

  return hash + md5(JSON.stringify(override)) + endpoint.versionString + 'jspm@' + jspmVersion;
}

function computeConfigHash(pkgConfig) {
  return md5(JSON.stringify(pkgConfig));
}

// return the dependency install range object
// while also setting it on the config.deps cache
// note it is important that we return the config.deps by reference
// that is because when installed, locate redirects mutate this to ensure
// targets all resolve out of registry mappings for reproducibility
function getDepRanges(pkg, packageConfig) {
  var depRanges = config.deps[pkg.exactName] = config.deps[pkg.exactName] || { deps: {}, peerDeps: {} };

  var mainDepRanges = processDeps(packageConfig.dependencies, packageConfig.registry, pkg.exactName);
  var peerDepRanges = processDeps(packageConfig.peerDependencies, packageConfig.registry, pkg.exactName);

  // treat optional dependencies as peerDependencies
  // when supported in jspm via https://github.com/jspm/jspm-cli/issues/1441,
  // optionalDependencies will be optional peer dependencies
  var optionalDepRanges = processDeps(packageConfig.optionalDependencies, packageConfig.registry, pkg.exactName);
  Object.keys(optionalDepRanges).forEach(function(dep) {
    if (!peerDepRanges[dep])
      peerDepRanges[dep] = optionalDepRanges[dep];
  });

  // deps that are both normal deps and peer deps treated as just peer deps
  Object.keys(peerDepRanges).forEach(function(dep) {
    if (mainDepRanges[dep])
      delete mainDepRanges[dep];
  });

  // ensure depRanges is an exact reference to the config.deps ranges
  // so we can mutate the resolutions
  Object.keys(mainDepRanges).forEach(function(dep) {
    if (depRanges.deps[dep])
      return;
    depRanges.deps[dep] = mainDepRanges[dep];
  });
  Object.keys(peerDepRanges).forEach(function(dep) {
    if (depRanges.peerDeps[dep])
      return;
    depRanges.peerDeps[dep] = peerDepRanges[dep];
  });

  return depRanges;
}

// like config.derivePackageConfig, but applies the
// registry processPackageConfig operation as well
function derivePackageConfig(pkg, packageConfig, override) {
  packageConfig = extend({}, packageConfig);

  // first derive the override
  if (override || packageConfig.jspm)
    packageConfig.jspm = extend({}, packageConfig.jspm || {});

  if (override) {
    // override is by reference, so we remove properties that don't apply
    // and clone properties that do
    for (var p in override) {
      var stringified = JSON.stringify(override[p]);
      if (p in packageConfig.jspm ? JSON.stringify(packageConfig.jspm[p]) !== stringified : JSON.stringify(packageConfig[p]) !== stringified)
        packageConfig.jspm[p] = JSON.parse(stringified);
      else
        delete override[p];
    }
  }

  // then apply the override
  if (packageConfig.jspm)
    extend(packageConfig, packageConfig.jspm);

  var endpoint = registry.load(packageConfig.registry || pkg.registry);
  return Promise.resolve()
  .then(function() {
    if (endpoint.processPackageConfig)
      return endpoint.processPackageConfig(packageConfig, pkg.exactName);

    return packageConfig;
  })
  .then(function(packageConfig) {
    if (!packageConfig)
      throw new Error('processPackageConfig must return the processed configuration object.');
    packageConfig.registry = packageConfig.registry || pkg.registry || 'jspm';
    return packageConfig;
  });
}


// apply registry process to package config given completed download folder and config
function processPackage(pkg, dir, packageConfig, linked) {
  // any package which takes longer than 10 seconds to process
  var timeout = setTimeout(function() {
    ui.log('warn', 'It\'s taking a long time to process the dependencies of `' + pkg.exactName + '`.\n' +
      'This package may need an %ignore% property to indicate test or example folders for jspm to skip.\n');
  }, 10000);
  var endpoint = registry.load(packageConfig.registry || pkg.registry);

  return Promise.resolve()
  .then(function() {
    if (linked)
      return;

    return filterIgnoreAndFiles(dir, packageConfig.ignore, packageConfig.files);
  })
  .then(function() {
    if (linked)
      return;

    var distDir;

    if (packageConfig.directories)
      distDir = packageConfig.directories.dist || packageConfig.directories.lib;

    if (distDir)
      return collapseDistDir(dir, distDir);
  })
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

  .then(function(packageConfig) {

    upgradePackageConfig(packageConfig);

    clearTimeout(timeout);
    return packageConfig;
  });
}

// filter files in a downloaded package to just the [files] and [ignore]
var inDir = require('./common').inDir;
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
        if (typeof keepFile != 'string')
          return;
        if (keepFile.startsWith('./'))
          keepFile = keepFile.substr(2);
        if (keepFile.endsWith('/*') && keepFile[keepFile.length - 3] != '*')
          keepFile = keepFile.substr(0, keepFile.length - 2) + '/**/*';

        // this file is in a keep dir, or a keep file, don't exclude
        if (inDir(fileName, keepFile, false, '/') || minimatch(fileName, keepFile, { dot: true }))
          return true;
      }))
        return removeFiles.push(fileName);

      // if ignore, ensure removed
      if (ignore && ignore.some(function(ignoreFile) {
        if (typeof ignoreFile != 'string')
          return;
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
function collapseDistDir(dir, subDir) {
  if (subDir.endsWith('/'))
    subDir = subDir.substr(0, subDir.length - 1);

  var tmpDir = path.resolve(dir, '..', '.tmp-' + dir.split(path.sep).pop());

  // move subDir to tmpDir
  fs.renameSync(path.normalize(dir + path.sep + subDir), tmpDir);

  // remove everything in dir
  return asp(rimraf)(dir)
  .then(function() {
    fs.renameSync(tmpDir, dir);
  });
}


var loaderConfigProperties = ['baseDir', 'defaultExtension', 'format', 'meta', 'map', 'main'];

function createLoaderConfig(pkg, packageConfig, downloadDir) {
  // systemjs prefix property in package.json takes preference
  if (typeof packageConfig.systemjs == 'object')
    packageConfig = packageConfig.systemjs;

  var loaderConfig = {};
  for (var p in packageConfig)
    if (loaderConfigProperties.indexOf(p) != -1)
      loaderConfig[p] = packageConfig[p];

  if (packageConfig.modules && !packageConfig.meta)
    loaderConfig.meta = packageConfig.modules;

  if (!packageConfig.main) {
    if (packageConfig.main === false)
      delete loaderConfig.main;
    else
      ui.log('warn', 'Package `' + pkg.exactName + '` has no "main" entry point set in its package config.');
  }

  fs.writeFileSync(downloadDir + '.json', JSON.stringify(loaderConfig, null, 2));
  return Promise.resolve(loaderConfig);
}
