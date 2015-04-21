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
      throw 'Repo `' + target.name + '` not found!';

    throw 'Invalid registry locate response for %' + target.registry + '%';
  }, function() {
    throw 'Error locating `' + target.name + '`.';
  });
};

var lookupPromises = {};
var lookups = {};

exports.lookup = function(pkg) {
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
      var lookupObj = getVersionMatch(version, lookup.versions);
      if (!lookupObj)
        return;

      return new PackageName(pkg.name + '@' + lookupObj.version, true);
    };
  }, function() {
    throw 'Error looking up `' + pkg.name + '`.';
  });
};

exports.getVersionMatch = getVersionMatch;
function getVersionMatch(pkgVersion, versions) {
  // unescape pkgVersion for comparison
  if (pkgVersion)
    pkgVersion = decodeURIComponent(pkgVersion);

  var latestPre;
  var versionList = [];
  var exactVersions = [];

  Object.keys(versions).forEach(function(v) {
    versions[v].version = v;
    if (versions[v].stable === false || versions[v].exactOnly)
      exactVersions.push(v);
    else
      versionList.push(v);
  });

  exactVersions.sort(semver.compare).reverse();
  versionList.sort(semver.compare).reverse();

  // find highest stable match in tags
  for (var i = 0; i < versionList.length; i++) {
    var version = versionList[i];
    var semverMatch = version.match(semver.semverRegEx);
    var valid = semverMatch && semverMatch[1] && semverMatch[2] && semverMatch[3];
    var pre = valid && semverMatch[4];
    var stable = versions[version].stable;

    // ignore non-semver or prerelease, unless explictly marked as stable
    if (!stable && (!valid || pre)) {
      latestPre = latestPre || pre && version;
      continue;
    }

    if (!pkgVersion || semver.match(pkgVersion, version))
      return versions[version];
  }

  // if we asked for latest, and nothing stable found, use master or otherwise top
  if (!pkgVersion) {
    if (latestPre)
      return versions[latestPre];
    if (versions.master)
      return versions.master;
    return versions[versionList[0] || exactVersions[0]];
  }

  // next try an unstable version range match in tags then branches
  for (var j = 0; j < versionList.length; j++) {
    if (semver.match(pkgVersion, versionList[j]))
      return versions[versionList[j]];
  }
  for (var k = 0; k < exactVersions.length; k++) {
    if (semver.match(pkgVersion, exactVersions[k]))
      return versions[exactVersions[k]];
  }

  // finally check for an exact tag match
  if (pkgVersion && versions[pkgVersion])
    return versions[pkgVersion];
}

// returns {hash} or {notfound} or {linked}
function getDirInfo(dir) {
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
      return asp(fs.readFile)(path.resolve(dir, '.jspm-hash'))
      .then(function(_hash) {
        return { hash: _hash.toString() };
      }, function(err) {
        if (err.code === 'ENOENT')
          return { notfound: true };
        throw err;
      });
    });
  });
}




/*

  Package.json information flow

  1. Package.json loaded as published
  2. Overridden by its own "jspm" property
  3. Override applied from registry or CLI
  4. Registry build operations can modify
  5. jspm build operations can modify
  5. Final package.json is used for package config injection
  6. Derived package.json saved in downloaded repo for inspection

*/
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

// note if it is a symlink, we leave it unaltered
var downloading = {};
// options.override
// options.unlink
// options.quick
exports.download = function(pkg, options, installDeps) {
  installDeps = installDeps || function() {};
  var override = options.override;
  if (downloading[pkg.exactName]) {
    downloading[pkg.exactName].preload.then(function(depMap) {
      installDeps(depMap);
      return depMap;
    });
    downloading[pkg.exactName].postload.then(function(depMap) {
      installDeps(depMap);
      return depMap;
    });
    return downloading[pkg.exactName].promise;
  }

  var getPackageConfigResolve, getPackageConfigReject;
  var getPackageConfigPromise = new Promise(function(resolve, reject) {
    getPackageConfigResolve = resolve;
    getPackageConfigReject = reject;
  });

  var postloadResolve;

  downloading[pkg.exactName] = {
    preload: getPackageConfigPromise.then(function(pjson) {
      var depMap = processDeps(pjson.dependencies, pjson.registry);
      installDeps(depMap);
      return depMap;
    }),
    postload: new Promise(function(resolve) {
      postloadResolve = resolve;
    })
    .then(function(depMap) {
      installDeps(depMap);
      return depMap;
    })
  };

  var downloadDir = pkg.getPath();

  downloading[pkg.exactName].promise = Promise.resolve()
  .then(function() {
    return getDirInfo(downloadDir);
  })
  .then(function(dirInfo) {
    if (dirInfo.linked && !options.unlink)
      return readJSON(path.resolve(downloadDir, '.jspm.json'))
      .then(function(_pjson) {
        pjson = _pjson;
      });

    var cacheDir = path.resolve(config.HOME, '.jspm', 'packages', pkg.registry, pkg.exactPackage);

    var pjson;
    var endpoint = registry.load(pkg.registry);

    var hash;
    var fullHash;
    var meta;

    var fresh;

    return (options.quick && dirInfo.hash ? Promise.resolve(true) : Promise.all([
      // ensure we have the hash from the lookup
      _pkg.lookup(pkg)
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
          if (!override && config.pjson.overrides[pkg.exactName])
            ui.log('warn', 'Using local override for `' + pkg.exactName + '`');
          return endpoint.getOverride(pkg.registry, pkg.package, pkg.version, override || config.pjson.overrides[pkg.exactName]);
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
      fullHash = hash + md5(JSON.stringify(override || {})) + endpoint.versionString + jspmVersion;

      if (config.force)
        return false;

      return dirInfo.hash === fullHash;
    })
    .then(function(_fresh) {
      fresh = _fresh;
      if (fresh)
        return readJSON(path.resolve(downloadDir, '.jspm.json'))
        .then(function(_pjson) {
          pjson = _pjson;
        });

      // ensure global cache is fresh / download if not
      return Promise.resolve(config.force ? false : getDirInfo(cacheDir))
      .then(function(cacheInfo) {
        if (cacheInfo.hash && cacheInfo.hash === fullHash)
          return readJSON(path.resolve(cacheDir, '.jspm.json'))
          .then(function(_pjson) {
            pjson = _pjson;
          });

        ui.log('info', 'Downloading `' + pkg.exactName + '`');

        if (endpoint.getPackageConfig)
          Promise.resolve()
          .then(function() {
            return endpoint.getPackageConfig(pkg.package, pkg.version, hash, meta);
          })
          .then(function(_pjson) {
            return derivePackageConfig(pkg, _pjson, override);
          }, function() {
            throw 'Error getting package config for `' + pkg.name + '`.';
          })
          .then(function(_pjson) {
            getPackageConfigResolve(pjson = _pjson);
          }, getPackageConfigReject);

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
        .then(function(_pjson) {
          // if we have a getPackageConfig, we use that pjson
          if (endpoint.getPackageConfig)
            return getPackageConfigPromise;

          // if no pjson returned by download, just read from download folder
          return Promise.resolve(_pjson || readJSON(path.resolve(cacheDir, 'package.json')))
          .then(function(_pjson) {
            return derivePackageConfig(pkg, _pjson, override);
          });
        }, function() {
          throw 'Error downloading `' + pkg.name + '`.';
        })
        .then(function(_pjson) {
          if (_pjson)
            pjson = _pjson;
          return _pkg.processPackage(pkg, cacheDir, pjson, postloadResolve);
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
        if (!pjson)
          throw new Error('no pjson for ' + pkg.exactName);
        return _pkg.createMain(pkg, pjson, downloadDir);
      });
    })
    .then(function() {
      // this can't trigger twice, so if its a second call its just a noop
      getPackageConfigResolve(pjson);
      return fresh;
    });
  });
  return downloading[pkg.exactName].promise;
};


// like config.derivePackageConfig, but applies the
// registry processPackageConfig operation as well
function derivePackageConfig(pkg, pjson, override) {
  pjson = config.derivePackageConfig(pjson, override);

  var endpoint = registry.load(pjson.registry || pkg.registry);
  return Promise.resolve(endpoint.processPackageConfig ? endpoint.processPackageConfig(pjson) : pjson)
  .then(function(pjson) {
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
    if (pjson.dependencies && Object.keys(pjson.dependencies).length > curDeps.length) {
      var newDepMap = processDeps(pjson.dependencies, pjson.registry);
      // remove dependencies already downloaded
      Object.keys(newDepMap).forEach(function(dep) {
        if (curDeps.indexOf(dep) !== -1)
          delete newDepMap[dep];
      });
      postload(newDepMap);
    }

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
    return asp(fs.writeFile)(path.resolve(dir, '.jspm.json'), JSON.stringify(pjson, null, 2));
  })
  .then(function() {
    clearTimeout(timeout);
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
