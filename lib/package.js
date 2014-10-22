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
var ep = require('./endpoint');
var PackageName = require('./config/package-name');
var globalConfig = require('./global-config');
var readJSON = require('./common').readJSON;
var ncp = require('ncp');
var crypto = require('crypto');
var fs = require('graceful-fs');

var jspmVersion = require('../package.json').version.split('.').splice(0, 2).join('.');

// we cache registry lookups here to allow reductions in config saving
var registryCache = exports.registryCache = {};

function md5(input) {
  var md5 = crypto.createHash('md5');
  md5.update(input);
  return md5.digest('hex');
}

var _pkg = module.exports;

// given a name like 'jquery', 'github:repo/thatwasmoved'
// add the default registry endpoint to the name
// so we now have 'jspm:jquery', 'github:repo/thatwasmoved'
// then run the locate hook (if provided) of the endpoint
// following redirects until the locate hook converges
// getting 'github:components/jquery' and 'github:repo/redirected'
// at this point, we have the final name for the target
var locateCache = {};
exports.locate = function(target) {
  if (!target.endpoint) {
    target = new PackageName(target.exactName);
    target.setEndpoint(globalConfig.config.registry);
  }

  var endpoint = ep.load(target.endpoint);

  if (!endpoint.locate)
    return Promise.resolve(target);

  locateCache[target.endpoint] = locateCache[target.endpoint] || {};

  // NB enable versioned locate
  if (locateCache[target.endpoint][target.package])
    return locateCache[target.endpoint][target.package];

  return locateCache[target.endpoint][target.package] = Promise.resolve(endpoint.locate(target.package))
  .then(function(located) {
    // NB support versioned registry
    if (target.endpoint == globalConfig.config.registry)
      registryCache[target.package] = located.redirect;

    if (!located)
      return target;

    if (located.redirect) {
      var newTarget = new PackageName(located.redirect);
      newTarget.setVersion(target.version);
      return _pkg.locate(newTarget);
    }

    if (located.notfound)
      throw 'Repo `' + target.name + '` not found!';

    throw 'Invalid endpoint locate response for %' + target.endpoint + '%';
  });
}

// lookup the latest suitable version for this package range
// if the range is a tag or prerelease, then it is just that
// if the range is compatible with a prerelease, then it is just that
// if the range is compatible with a semver, then it is the 
//   associated stable compatible semver
// if the range is a semver, then it is the latest minor, patch or exact
// also create pkg.hash for the lookup version
var lookupCache = {};

exports.lookup = function(pkg) {

  return Promise.resolve()

  // load the version map
  .then(function() {
    if (lookupCache[pkg.package])
      return lookupCache[pkg.package];

    ui.log('info', 'Looking up `' + pkg.name + '`');

    return lookupCache[pkg.package] = Promise.resolve(ep.load(pkg.endpoint).lookup(pkg.package));
  })
  .then(function(lookup) {
    if (lookup.notfound)
      throw 'Repo `' + pkg.package + '` not found!';

    if (!lookup.versions)
      throw 'Invalid endpoint lookup response for %' + pkg.endpoint + '%';

    return _pkg.getVersionMatch(pkg, lookup.versions);
  })
  // return the lookup
  .then(function(lookupObj) {
    if (!lookupObj)
      throw 'No version match found for `' + pkg.exactName + '`';

    var lookup = new PackageName(pkg.name + '@' + lookupObj.version);
    lookup.hash = lookupObj.hash;
    return lookup;
  });
}

exports.getVersionMatch = function(pkg, versions) {
  var versionList = [];
  var branchVersions = [];

  for (var v in versions) {
    if (v.substr(0, 1) == '#')
      branchVersions.push(v.substr(1));
    else
      versionList.push(v);
  }

  branchVersions.sort(semver.compare);
  versionList.sort(semver.compare);

  // find highest stable match in tags
  for (var i = versionList.length - 1; i >=0; i--) {
    var version = versionList[i];

    var semverMatch = version.match(semver.semverRegEx);
    
    // ignore unstable
    // (stable is semver, without prerelease)
    if (!semverMatch || !semverMatch[1] || !semverMatch[2] || !semverMatch[3] || semverMatch[4])
      continue;

    if (!pkg.version || semver.match(pkg.version, version))
      return { version: version, hash: versions[version] };
  }

  // if we asked for latest, and nothing stable found, use master or otherwise top
  if (!pkg.version) {
    if (versions.master)
      return { version: 'master', hash: versions.master };
    return { version: versionList[0] || branchVersions[0], hash: versions[versionList[0] || ('#' + branchVersions[0])] };
  }
  
  // next try an unstable version range match in tags then branches
  for (var i = 0; i < versionList.length; i++) {
    if (semver.match(pkg.version, versionList[i]))
      return { version: versionList[i], hash: versions[versionList[i]] };
  }
  for (var i = 0; i < branchVersions.length; i++) {
    if (semver.match(pkg.version, branchVersions[i]))
      return { version: branchVersions[i], hash: versions[('#' + branchVersions[i])]};
  }

  // finally check for an exact tag match
  if (pkg.version && versions[pkg.version])
    return { version: pkg.version, hash: versions[pkg.version] };
}

// NB need to remove rejectUnauthorized
exports.getCDNPackageJSON = function(pkg) {
  var fullName = pkg.exactName;
  var remote = ep.load(pkg.endpoint).remote;
  return asp(request)({
    method: 'get',
    url: remote + (remote.substr(remote.length -1 , 1) == '/' ? '' : '/') + fullName.substr(fullName.indexOf(':') + 1) + '/package.json',
    rejectUnauthorized: false
  }).then(function(res) {
    if (res.statusCode != 200)
      throw 'Error requesting package.json';
    try {
      return JSON.parse(res.body);
    }
    catch(e) {
      throw 'Unable to parse package.json';
    }
  });
}

function isFresh(dir, hash) {
  return asp(fs.readFile)(path.resolve(dir, '.jspm-hash')).then(function(_hash) { 
    return hash == _hash + '';
  }, function(err) {
    if (err.code === 'ENOENT')
      return;
    throw err;
  });
}




/*

  Package.json information flow

  1. Package.json loaded as published
  2. Overridden by its own "jspm" property
  3. Override applied from registry or CLI
  4. Endpoint build operations can modify
  5. jspm build operations can modify
  5. Final package.json is used for package config injection
  6. Derived package.json saved in downloaded repo for inspection

*/
function processDeps(deps, registry) {
  var outdeps = {};
  if (!registry)
    return outdeps;
  Object.keys(deps).forEach(function(p) {
    var dep = deps[p];

    // jquery: github:components/jquery
    // jquery: jquery@1.5
    // -> RHS is dep
    if (dep.indexOf(':') != -1)
      outdeps[p] = dep;

    else if (dep.indexOf('@') != -1)
      outdeps[p] = registry + ':' + dep;

    // jquery: *
    else if (dep == '*')
      outdeps[p] = registry + ':' + p;

    // jquery: 1.5
    else
      outdeps[p] = registry + ':' + p + '@' + dep;
  });
  return outdeps;
}

function doPreload(pjson, preload) {
  if (!pjson.dependencies)
    return;

  var deps = processDeps(pjson.dependencies, pjson.registry);

  preload(Object.keys(deps).map(function(p) { return deps[p]; }));
}

// adds the pkg.fresh, pkg.fullHash
// options.inject, options.force, options.override

// note if it is a symlink, we leave it unaltered
exports.download = function(pkg, jspmPackages, options, preload) {
  if (options.inject)
    return _pkg.getCDNPackageJSON(pkg).then(function(pjson) {
      return processDeps(pjson.dependencies, pjson.registry);
    });

  var downloadDir = path.resolve(jspmPackages, pkg.endpoint, pkg.exactPackage);
  var cacheDir = path.resolve(config.HOME, '.jspm', 'packages', pkg.endpoint, pkg.exactPackage);
  var exactVersion, lastNamePart, main;

  var override;

  var force = options.force;

  var pjson;

  var endpoint = ep.load(pkg.endpoint);

  return Promise.resolve()
  .then(function() {
    exactVersion = pkg.version;
  })

  // get the override
  .then(function() {

    // load the registry endpoint
    var registry = ep.load(globalConfig.config.registry);

    if (registry.getOverride)
      return registry.getOverride(pkg.endpoint, pkg.package, pkg.version, options.override);

    return options.override;
  })

  .then(function(_override) {
    override = _override;
    
    // no hash -> it's existing and we skipped the lookup
    if (!pkg.hash)
      return true;

    // create the full package hash by combining it with the override and endpoint code hash
    pkg.fullHash = pkg.hash + md5(JSON.stringify(override || {})) + endpoint.versionString + jspmVersion;

    if (force) 
      return false;

    return Promise.resolve(isFresh(downloadDir, pkg.fullHash))
    .then(function(fresh) {
      pkg.fresh = fresh;
      if (fresh)
        return true;

      // if not fresh, check to see if we have this hash in our global cache
      return isFresh(cacheDir, pkg.fullHash)
      .then(function(fresh) {
        if (!fresh)
          return false;

        // if in the global cache, we just copy the global cache dir to
        // the download dir
        // now copy the cache dir to the download dir
        return Promise.resolve(downloadDir)
        .then(asp(mkdirp)(downloadDir))
        // clear the directory
        .then(function() {
          return asp(rimraf)(downloadDir);
        })
        .then(function() {
          return asp(mkdirp)(downloadDir);
        })
        .then(function() {
          return asp(ncp)(cacheDir, downloadDir);
        })
        .then(function() {
          return readJSON(path.resolve(downloadDir, '.jspm.json'));
        })
        .then(function(_pjson) {
          pjson = _pjson
          return _pkg.createMain(pkg, pjson, downloadDir);
        })
        .then(function() {
          return true;
        });
      });
    });
  })

  .then(function(fresh) {
    // we're fresh and built -> take the package.json from the download folder
    if (fresh && !pjson)
      return readJSON(path.resolve(downloadDir, '.jspm.json'))
      .then(function(_pjson) {
        pjson = _pjson;
        return true;
      });
    return fresh;
  })

  .then(function(fresh) {
    // fire off preloading using early getPackageConfig hook if available
    // NB this can run in parallel to download with Promise.all
    if (endpoint.getPackageConfig)
      // we only use the getPackageConfig pjson if
      // we are going to run a build, otherwise we use the saved one
      return Promise.resolve(endpoint.getPackageConfig(pkg.package, exactVersion, pkg.hash))
      .then(function(_pjson) {
        // apply the override and package config operations
        if (!pjson)
          pjson = config.derivePackageConfig(_pjson, override);
        doPreload(pjson, preload);
        return fresh;
      });
    return fresh;
  })
  .then(function(fresh) {
    if (fresh)
      return;

    // download if not fresh
    ui.log('info', 'Downloading `' + pkg.exactName + '`');

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
      return endpoint.download(pkg.package, exactVersion, pkg.hash, cacheDir);
    })

    // process the package fully
    .then(function(_pjson) {
      // a package.json from the download takes preference
      if (_pjson)
        pjson = config.derivePackageConfig(_pjson, override || {});

      // if still no package.json, load from the downloaded folder
      if (!pjson)
        return Promise.resolve(readJSON(path.resolve(dir, 'package.json')))
        .then(function(_pjson) {
          if (_pjson)
            pjson = config.derivePackageConfig(_pjson, override || {});
        });

    })
    .then(function() {
      return _pkg.processPackage(pkg, cacheDir, pjson || {});
    })
    // we've now finished creating the cache directory
    .then(function() {
      return asp(fs.writeFile)(path.resolve(cacheDir, '.jspm-hash'), pkg.fullHash);
    })
    // now copy the cache dir to the download dir
    .then(function() {
      return asp(mkdirp)(downloadDir);
    })
    // clear the directory
    .then(function() {
      return asp(rimraf)(downloadDir);
    })
    .then(function() {
      return asp(ncp)(cacheDir, downloadDir);
    })
    // finally add the main
    .then(function() {
      return _pkg.createMain(pkg, pjson, downloadDir);
    });
  })
  .then(function() {
    var depMap = {};
    return processDeps(pjson.dependencies, pjson.registry);
  });
}

/*
 Given a raw package in a folder,
 apply the package.json build operations etc

 Also saves the hash into the folder

 pjson is optional if provided by getPackageConfig
*/
exports.processPackage = function(pkg, dir, pjson) {
  var endpoint = ep.load(pkg.endpoint);
  var deps;

  return Promise.resolve()

  .then(function() {
    // now that we have the derived pjson, do the endpoint build
    if (endpoint.build)
      return endpoint.build(pjson, dir);
  })

  // apply build operations from the package.json
  .then(function() {
    // don't build in dependencies
    deps = pjson.dependencies;
    delete pjson.dependencies;
    return build.buildPackage(dir, pjson);
  })

  // save the final calculated package.json in place
  .then(function() {
    pjson.dependencies = deps;
    return asp(fs.writeFile)(path.resolve(dir, '.jspm.json'), JSON.stringify(pjson, null, 2));
  });
}

exports.createMain = function(pkg, pjson, downloadDir) {
  var lastNamePart, main;

  return Promise.resolve()

  // create the main entry point
  .then(function() {
    lastNamePart = pkg.name.split('/').pop().split(':').pop();
    main = typeof pjson.main == 'string' && pjson.main;

    if (main) {
      if (main.substr(0, 2) == './')
        main = main.substr(2);
      if (main.substr(main.length - 3, 3) == '.js')
        main = main.substr(0, main.length - 3);
    }

    main = main || 'index';

    // try the package.json main
    return new Promise(function(resolve, reject) {
      fs.exists(path.resolve(downloadDir, main.substr(main.length - 3, 3) != '.js' ? main + '.js' : main), resolve);
    });
  })
  .then(function(exists) {
    if (exists)
      return true;

    main = lastNamePart;
    return new Promise(function(resolve, reject) {
      fs.exists(path.resolve(downloadDir, main.substr(main.length - 3, 3) != '.js' ? main + '.js' : main), resolve);
    });
  })
  .then(function(exists) {
    // create the main pointer
    var mainFile = path.resolve(downloadDir, '../' + lastNamePart + '@' + pkg.version + '.js');
    return asp(fs.writeFile)(mainFile, 'export * from "' + pkg.exactName + '/' + main + '";');
  });
}


