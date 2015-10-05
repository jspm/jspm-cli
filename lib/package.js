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
var build = require('./build');
var config = require('./config');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var path = require('path');
var registry = require('./registry');
var PackageName = require('./config/package-name');
var globalConfig = require('./global-config');
var readJSON = require('./common').readJSON;
var getRedirectContents = require('./common').getRedirectContents;
var ncp = require('ncp');
var crypto = require('crypto');
var fs = require('graceful-fs');

var jspmVersion = require('../package.json').version.split('.').splice(0, 2).join('.');

// we cache registry lookups here to allow reductions in config saving
var registryCache = exports.registryCache = {};

function md5(input) {
  var md5Hash = crypto.createHash('md5');
  md5Hash.update(input);
  return md5Hash.digest('hex');
}

var _pkg = module.exports;

// given a name like 'jquery', 'github:repo/thatwasmoved'
// add the default registry endpoint to the name
// so we now have 'jspm:jquery', 'github:repo/thatwasmoved'
// then run the locate hook (if provided) of the registry
// following redirects until the locate hook converges
// getting 'github:components/jquery' and 'github:repo/redirected'
// at this point, we have the final name for the target
var locateCache = {};
// target is a PackageName object
exports.locate = function(target) {
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
      var newTarget = new PackageName(located.redirect);
      newTarget.setVersion(target.version);
      return _pkg.locate(newTarget);
    }

    if (located.notfound)
      throw 'Repo `' + target.name + '` not found.' +
        (target.registry != 'npm' && target.package.split('/').length == 1 ? ' Perhaps try %jspm install npm:' + target.package + '%.' : '');

    throw 'Invalid registry locate response for %' + target.registry + '%';
  }, function() {
    throw 'Error locating `' + target.name + '`.';
  });
};

var lookupPromises = {};
var lookups = {};

exports.lookup = function(pkg, edge) {
  return Promise.resolve()

  // load the version map
  .then(function() {
    if (lookupPromises[pkg.package])
      return lookupPromises[pkg.package];

    ui.log('info', 'Looking up `' + pkg.name + '`');

    lookupPromises[pkg.package] = Promise.resolve(registry.load(pkg.registry).lookup(pkg.package));
    return lookupPromises[pkg.package];
  })
  .then(function(lookup) {
    if (lookup.notfound)
      throw 'Repo `' + pkg.name + '` not found!';

    if (!lookup.versions)
      throw 'Invalid registry lookup response for %' + pkg.registry + '%';

    lookups[pkg.package] = lookup.versions;

    return function(version) {
      var opts = {edge: edge, latestVersion: lookup.latest};
      var lookupObj = getVersionMatch(version, lookup.versions, opts);
      if (!lookupObj)
        return;

      return new PackageName(pkg.name + '@' + lookupObj.version, true);
    };
  }, function() {
    throw 'Error looking up `' + pkg.name + '`.';
  });
};

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

// returns {hash,depRanges} or {notfound} or {linked}
function getPackageDirInfo(dir) {
  return Promise.resolve()
  .then(function() {
    // check if the folder already exists
    return asp(fs.stat)(dir)
    .catch(function(err) {
      if (err.code === 'ENOENT')
        return;
      throw err;
    });
  })
  .then(function(exists) {
    if (!exists)
      return { notfound: true };

    // if it is linked, then it is fresh
    return asp(fs.lstat)(dir)
    .then(function(stats) {
      return stats.isSymbolicLink();
    })
    .then(function(linked) {
      if (linked)
        return { linked: true };

      // otherwise do the hash check
      var hash;
      return asp(fs.readFile)(path.resolve(dir, '.jspm-hash'))
      .then(function(_hash) {
        hash = _hash.toString();
      })
      .then(function() {
        return readJSON(dir + '.deps.json');
      })
      .then(function(depJSON) {
        var depRanges = {};
        Object.keys(depJSON).forEach(function(dep) {
          if (typeof depJSON[dep] == 'string')
            depRanges[dep] = new PackageName(depJSON[dep]);
        });
        return { hash: hash, depRanges: depRanges };
      }, function(err) {
        if (err.code === 'ENOENT')
          return { notfound: true };
        throw err;
      });
    });
  });
}

function processDeps(deps, registry) {
  var outdeps = {};
  if (!deps)
    return outdeps;
  Object.keys(deps).forEach(function(p) {
    var dep = deps[p];

    if (dep instanceof PackageName) {
      outdeps[p] = dep;
      return outdeps[p];
    }

    var outPackage;

    // jquery: github:components/jquery
    // jquery: jquery@1.5
    // -> RHS is dep
    if (dep.indexOf(':') !== -1)
      outPackage = dep;

    else if (!registry)
      throw new TypeError('Install of %' + p + '% to `' + dep + '` has no registry property provided.');

    // jquery: components/jquery@1.5
    else if (dep.lastIndexOf('@') > 0)
      outPackage = registry + ':' + dep;

    // jquery: 1.5
    else
      outPackage = registry + ':' + p + '@' + dep;

    outdeps[p] = new PackageName(outPackage, true);
  });
  return outdeps;
}
exports.processDeps = processDeps;

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
      throw new Error('Error requesting package.json for `' + pkg.exactName + '` at %' + url + '%.');

    try {
      return JSON.parse(res.body);
    }
    catch(e) {
      throw new Error('Unable to parse package.json');
    }
  })
  .then(function(pjson) {
    depResolve(processDeps(pjson.dependencies, pjson.registry));
    return pjson;
  }, depReject);
  return injecting[pkg.exactName].promise;
};

function getDepRanges(pjson) {
  var depRanges = processDeps(pjson.dependencies, pjson.registry);
  
  // dont install re-mapped dependencies
  Object.keys(depRanges).forEach(function(dep) {
    if (pjson.map && pjson.map[dep])
      delete depRanges[dep];
  });

  return depRanges;
}


// note if it is a symlink, we leave it unaltered
var downloading = {};
// options.override
// options.unlink
// options.quick
exports.download = function(pkg, options, installDeps) {
  var sentDeps;
  // called twice, ensure we don't duplicate install requests back
  function depsCallback(depRanges) {
    if (sentDeps)
      Object.keys(depRanges).forEach(function(dep) {
        if (sentDeps.indexOf(dep) != -1)
          delete depRanges[dep];
      });
    else
      sentDeps = Object.keys(depRanges);
    if (installDeps)
      installDeps(depRanges);
    return depRanges;
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
  var override = options.override;
  var downloadDir = pkg.getPath();
  var getPackageConfigPromise;

  downloading[pkg.exactName].promise = Promise.resolve()
  .then(function() {
    // if we have no constraint information, it's immediately a not-found
    if (!config.deps[pkg.exactName])
      return { notfound: true };

    // otherwise check the folder info
    return getPackageDirInfo(downloadDir);
  })
  .then(function(dirInfo) {
    if (dirInfo.linked && !options.unlink)
      return preloadResolve(config.deps[pkg.exactName]);

    var cacheDir = path.resolve(config.HOME, '.jspm', 'packages', pkg.registry, pkg.exactPackage);

    var endpoint = registry.load(pkg.registry);

    var hash;
    var fullHash;
    var meta;

    var fresh;

    return (options.quick && dirInfo.hash ? Promise.resolve(true) : Promise.all([
      // ensure we have the hash from the lookup
      _pkg.lookup(pkg, options.edge)
      .then(function() {
        var lookupObj = lookups[pkg.package][pkg.version];
        // linked packages have no lookup object
        if (lookupObj) {
          hash = lookupObj.hash;
          meta = lookupObj.meta;
        }
        else {
          hash = '';
          meta = {};
        }
      }),

      // and the override
      Promise.resolve()
      .then(function() {
        // load the registry endpoint
        var endpoint = registry.load(globalConfig.config.defaultRegistry);

        // get the override
        if (endpoint.getOverride) {
          if (!override) {
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
            if (overrideVersion) {
              override = config.pjson.overrides[pkg.name + '@' + overrideVersion];
              ui.log('warn', 'Using local override for `' + pkg.exactName + '`');
            }
          }
          return endpoint.getOverride(pkg.registry, pkg.package, pkg.version, override);
        }

        return override;
      })
      .then(function(_override) {
        override = _override;
      })
    ]))
    .then(function() {
      if (options.quick && dirInfo.hash)
        return true;

      // create the full package hash by combining it with the override and registry code hash
      fullHash = hash + md5(JSON.stringify(override || {})) + endpoint.versionString + jspmVersion + '.1';

      if (config.force)
        return false;

      return dirInfo.hash === fullHash;
    })
    .then(function(_fresh) {
      fresh = _fresh;
      if (fresh) {
        // this can't trigger twice, so if its a second call its just a noop
        preloadResolve(config.deps[pkg.exactName]);
        return true;
      }

      // ensure global cache is fresh / download if not
      return Promise.resolve(config.force ? false : getPackageDirInfo(cacheDir))
      .then(function(cacheInfo) {
        if (cacheInfo.hash && cacheInfo.hash === fullHash) {
          config.deps[pkg.exactName] = cacheInfo.depRanges;
          preloadResolve(cacheInfo.depRanges);
          return;
        }

        ui.log('info', 'Downloading `' + pkg.exactName + '`');

        if (endpoint.getPackageConfig)
          getPackageConfigPromise = Promise.resolve()
          .then(function() {
            return endpoint.getPackageConfig(pkg.package, pkg.version, hash, meta);
          })
          .then(function(pjson) {
            return derivePackageConfig(pkg, pjson, override);
          }, function() {
            throw 'Error getting package config for `' + pkg.name + '`.';
          })
          .then(function(pjson) {
            preloadResolve(getDepRanges(pjson));
            return pjson;
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
          return endpoint.download(pkg.package, pkg.version, hash, meta, cacheDir);
        })

        // process the package fully
        .then(function(pjson) {
          // if we have a getPackageConfig, we use that pjson
          if (endpoint.getPackageConfig)
            return getPackageConfigPromise;

          // if no pjson returned by download, just read from download folder
          return Promise.resolve(pjson || readJSON(path.resolve(cacheDir, 'package.json')))
          .then(function(pjson) {
            return derivePackageConfig(pkg, pjson, override);
          });
        }, function(err) {
          if (err)
            ui.log('err', err && err.stack || err);
          throw 'Error downloading `' + pkg.name + '`.';
        })
        .then(function(pjson) {
          return _pkg.processPackage(pkg, cacheDir, pjson, postloadResolve);
        })
        // create the main file in the cache folder
        .then(function(pjson) {
          return _pkg.createMain(pkg, pjson, cacheDir)
          .then(function() {
            return pjson;
          });
        })
        // create the deps file in the cache folder
        .then(function(pjson) {
          var depRanges = getDepRanges(pjson);
          var rangeMap = {};
          Object.keys(depRanges).forEach(function(dep) {
            rangeMap[dep] = depRanges[dep].exactName;
          });
          config.deps[pkg.exactName] = depRanges;
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
        // copy main file from cached folder (if it exists)
        return asp(ncp)(cacheDir + '.js', downloadDir + '.js')
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


// like config.derivePackageConfig, but applies the
// registry processPackageConfig operation as well
function derivePackageConfig(pkg, pjson, override) {
  pjson = config.derivePackageConfig(pjson, override);

  var endpoint = registry.load(pjson.registry || pkg.registry);
  return Promise.resolve(endpoint.processPackageConfig ? endpoint.processPackageConfig(pjson, pkg.exactName) : pjson)
  .then(function(pjson) {
    if (!pjson)
      throw new Error('processPackageConfig must return the processed package.json object.');
    pjson.registry = pjson.registry || pkg.registry;
    return pjson;
  })
  .catch(function() {
    throw 'Error processing package config for `' + pkg.name + '`.';
  });
}
exports.derivePackageConfig = derivePackageConfig;


/*
 Given a raw package in a folder,
 apply the package.json build operations etc

 Also saves the hash into the folder

 pjson is optional if provided by getPackageConfig

 NB this function should be deprecated
*/
exports.processPackage = function(pkg, dir, pjson, postload, isCDN) {
  // any package which takes longer than 10 seconds to process
  var timeout = setTimeout(function() {
    ui.log('warn', 'It\'s taking a long time to process the dependencies of `' + pkg.exactName + '`.\n' +
      'This package may need an %ignore% property to indicate test or example folders for jspm to skip.\n');
  }, 10000);
  var endpoint = registry.load(pjson.registry || pkg.registry);
  var deps;
  var buildErrors = [];
  var curDeps = [];

  return Promise.resolve()

  .then(function() {
    // now that we have the derived pjson, do the registry build
    if (endpoint.build)
      return Promise.resolve()
      .then(function() {
        curDeps = pjson.dependencies && Object.keys(pjson.dependencies) || [];
        return endpoint.build(pjson, dir);
      })
      .catch(function() {
        throw 'Error building package `' + pkg.name + '`.';
      });
  })

  // apply build operations from the package.json
  .then(function(_buildErrors) {
    if (_buildErrors)
      buildErrors = buildErrors.concat(_buildErrors);

    // if we gained a new dependency, download it
    postload(getDepRanges(pjson));

    // don't build in dependencies
    if (!isCDN) {
      deps = pjson.dependencies;
      delete pjson.dependencies;
    }
    else {
      deps = pjson.dependencies;
      pjson.dependencies = processDeps(pjson.dependencies, pjson.registry);
    }

    return build.buildPackage(dir, pjson, isCDN);
  })

  // save the final calculated package.json in place
  .then(function(_buildErrors) {
    if (_buildErrors)
      buildErrors = buildErrors.concat(_buildErrors);
    pjson.dependencies = deps;
  })
  .then(function() {
    // write build errors
    if (buildErrors.length)
      return asp(fs.writeFile)(path.resolve(dir, '.jspm.errors'), buildErrors.join('\n\n'));
  })
  .then(function() {
    clearTimeout(timeout);
    return pjson;
  });
};

exports.createMain = function(pkg, pjson, downloadDir) {
  var lastNamePart, main;
  var mainPath;
  var pluginMain;

  return Promise.resolve()

  // create the main entry point
  .then(function() {
    lastNamePart = pkg.name.split('/').pop().split(':').pop();
    main = typeof pjson.main === 'string' && pjson.main;

    // we don't need to ensure it exists for plugin mains
    // as they can have custom locate functions
    if (main && main.indexOf('!') !== -1) {
      pluginMain = true;
      return true;
    }

    if (main) {
      if (main.startsWith('./'))
        main = main.substr(2);
      if (main.endsWith('.js'))
        main = main.substr(0, main.length - 3);
    }

    main = main || 'index';

    // try the package.json main
    return new Promise(function(resolve) {
      mainPath = path.resolve(downloadDir, main + '.js');
      fs.exists(mainPath, resolve);
    });
  })
  .then(function(exists) {
    if (exists)
      return exists;

    main = lastNamePart;

    if (main.endsWith('.js'))
      main = main.substr(0, main.length - 3);

    return new Promise(function(resolve) {
      mainPath = path.resolve(downloadDir, main + '.js');
      fs.exists(mainPath, resolve);
    });
  })
  .then(function(exists) {
    // don't create a main if it doesn't exist
    if (!exists) {
      if (pjson.main !== false)
        ui.log('warn', 'Main entry point not found for `' + pkg.exactName + '`.\nAdjust this property in the package.json or with an override, setting %"main": false% if this is the intention.\n');
      return;
    }

    // create the main pointer
    var mainFile = path.resolve(downloadDir, '../' + lastNamePart + '@' + pkg.version + '.js');

    // plugin mains are redirected by CommonJS
    if (pluginMain)
      return asp(fs.writeFile)(mainFile, getRedirectContents('cjs', pkg.exactName + '/' + main));

    // otherwise detect the format of the main
    return asp(fs.readFile)(mainPath)
    .then(function(source) {
      var detected = build.detectFormat(source.toString());

      return asp(fs.writeFile)(mainFile, getRedirectContents(detected.format, pkg.exactName + '/' + main));
    });
  });
};
