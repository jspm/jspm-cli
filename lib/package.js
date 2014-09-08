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
var nodeSemver = require('semver');
var Promise = require('rsvp').Promise;
var asp = require('rsvp').denodeify;
var build = require('./build');
var config = require('./config');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var path = require('path');
var ep = require('./endpoint');

/*
  Parse a package name into endpoint:package@version

  name: 'github:jquery/jquery',
  exactName: 'github:jquery/jquery@2.0.3',
  exactPackage: 'jquery/jquery@2.0.3',

  endpoint: 'github',
  package: 'jquery/jquery',
  version: '2.0.3'
*/
var Package = exports.Package = function Package(name) {
  this.exactName = name;

  if (name.indexOf(':') != -1)
    this.endpoint = name.split(':')[0];

  var packageParts = (this.endpoint ? name.substr(this.endpoint.length + 1) : name).split('/');

  var versionSplit = (packageParts[packageParts.length - 1] || '').split('@');

  var version = versionSplit[1] || '';

  packageParts[packageParts.length - 1] = versionSplit[0];
  this.package = packageParts.join('/');

  this.name = (this.endpoint ? this.endpoint + ':' : '') + this.package;

  this.setVersion(version);
}
Package.prototype.setVersion = function(version) {
  this.version = version;
  var v = this.version ? '@' + this.version : '';
  this.exactPackage = this.package + v;
  this.exactName = this.name + v;
}

var link = require('./link');

var ncp = require('ncp');

var crypto = require('crypto');

function md5(input) {
  var md5 = crypto.createHash('md5');
  md5.update(input);
  return md5.digest('hex');
}

var exec = require('child_process').exec;

var fs = require('graceful-fs');

function extend(a, b) {
  for (var p in b)
    a[p] = b[p];
  return a;
}

var _pkg = module.exports;

// lookup a package in the registry if necessary
exports.registryCache;

exports.locate = function(target) {
  if (target.endpoint)
    return Promise.resolve(target);

  if (_pkg.registryCache) {
    var registryEntry = _pkg.registryCache[target.package];
    if (!registryEntry)
      throw '`' + target.exactName + '` not found in registry.';
    var pkg = new Package(registryEntry);
    pkg.setVersion(target.version);
    return Promise.resolve(pkg);
  }

  // we haven't loaded the registry yet -> load the registry file
  return _pkg.updateRegistry()
  .then(function() {
    return _pkg.readJSON(path.resolve(registryPath, 'registry.json'));
  })
  .then(function(json) {
    _pkg.registryCache = json;
  })
  .then(function() {
    return _pkg.locate(target);
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
    if (lookup.redirect)
      return exports.lookup(new Package(lookup.redirect));
    if (lookup.notfound)
      throw 'Repo `' + pkg.package + '` not found!';

    return _pkg.getVersionMatch(pkg, lookup.versions);
  })
  // return the lookup
  .then(function(lookupObj) {
    if (!lookupObj)
      throw 'No version match found for `' + pkg.exactName + '`';

    var lookup = new Package(pkg.name + '@' + lookupObj.version);
    lookup.hash = lookupObj.hash;
    return lookup;
  });
}

exports.getVersionMatch = function(pkg, versions) {
  var versionList = [];

  for (var v in versions)
    versionList.push(v);

  versionList.sort(semver.compare);

  // find highest stable match
  // latest is empty string
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
    return { version: versionList[0], hash: versions[versionList[0]] };
  }
  
  // finally try an unstable version match (always exact)
  for (var i = 0; i < versionList.length; i++) {
    if (semver.match(pkg.version, versionList[i]))
      return { version: versionList[i], hash: versions[versionList[i]] };
  }

  var rangeVersion = pkg.version.substr(0, 1) == '^' ? pkg.version.substr(1) : pkg.version;
  var rangeMatch = rangeVersion.match(semver.semverRegEx);

  // tag or prerelease -> match exact or nothing
  if (pkg.version && (!rangeMatch || rangeMatch[4])) {
    if (versions[rangeVersion])
      return { version: rangeVersion, hash: versions[rangeVersion] };
    return null;
  }
}

// we get a folder listing for the right name
// if we have a listing we filter to the override versions for that package
// we take the highest override that creates a semver range we are compatible with
exports.checkOverride = function(pkg) {
  var packageParts = pkg.package.split('/');
  var overrideName = packageParts.pop();
  var overrideDir = path.resolve(registryPath, 'package-overrides', pkg.endpoint, packageParts.join('/'));

  return _pkg.updateRegistry()
  .then(function() {
    return asp(fs.readdir)(overrideDir);
  })
  .then(function(files) {
    
    var overrideFile = files
    // find the files for this override name
    .filter(function(file) {
      return file.substr(0, overrideName.length) == overrideName && file.substr(overrideName.length, 1) == '@';
    })
    // derive versions
    .map(function(file) {
      return {
        version: file.substr(overrideName.length + 1, file.length - overrideName.length - 6),
        file: file
      };
    })
    // filter to only semver compatible overrides
    .filter(function(item) {
      if (nodeSemver.valid(pkg.version))
        return nodeSemver.satisfies(pkg.version, '^' + item.version);
      else
        return pkg.version == item.version;
    })
    // sort to find latest
    .sort(function(a, b) {
      return nodeSemver.compare(a.version, b.version);
    })
    .map(function(item) {
      return item.file;
    })
    .pop();

    // return that loaded override
    if (!overrideFile)
      return;

    return _pkg.readJSON(path.resolve(overrideDir, overrideFile))
    .catch(function(e) {
      ui.log('warn', 'Override file `' + overrideFile + '` found, but JSON is invalid');
    });
  }, function(err) {
    if (err.code === 'ENOENT')
      return;
    throw err;
  });
}

// NB need to remove rejectUnauthorized
exports.getCDNPackageJSON = function(fullName, remote) {
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

// clones / updates github:jspm/registry to ~/.jspm/registry 
var registryUpdated;
var registryPath = path.resolve(process.env.HOME, '.jspm/registry');
exports.updateRegistry = function() {
  if (registryUpdated)
    return Promise.resolve(registryUpdated);

  return registryUpdated = asp(fs.stat)(registryPath)
  .then(function() {
    // if the registry does exist, update it
    ui.log('info', 'Updating registry and override cache');
    return asp(exec)('git fetch --all && git reset --hard origin/master', {
      cwd: registryPath,
      timeout: 120000,
      killSignal: 'SIGKILL'
    })
    .then(function(stdout, stderr) {
      if (stderr)
        throw stderr;
    });
  }, function(err) {
    // if the registry does not exist, do a git clone
    if (err.code !== 'ENOENT')
      throw err;

    ui.log('info', 'Creating registry cache');

    var remoteString = 'https://';

    if (config.globalConfig.github && config.globalConfig.github.username)
      remoteString += config.globalConfig.github.username + ':' + config.globalConfig.github.password + '@';

  remoteString += 'github.com/jspm/registry.git';

    return asp(exec)('git clone --depth=1 ' + remoteString + ' registry', {
      cwd: path.dirname(registryPath),
      timeout: 120000,
      killSignal: 'SIGKILL'
    })
    .then(function(stdout, stderr) {
      if (stderr)
        throw stderr;
    });
  })
  .then(function() {
    registryUpdated = true;
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
function derivePackageConfig(pjson, override) {
  // apply the jspm internal overrides first
  if (pjson.jspm) {
    if (pjson.jspm.dependencies && !pjson.registry)
      pjson.registry = 'jspm';
    extend(pjson, pjson.jspm);
  }

  if (override)
    extend(pjson, override);

  // parse the dependencies
  pjson.dependencies = config.parseDependencies(pjson.dependencies, pjson.registry);

  // having parsed, note now that we are in the jspm registry form
  pjson.registry = 'jspm';

  // if there is a "browser" object, convert it into map config for browserify support
  if (typeof pjson.browser == 'object') {
    pjson.map = pjson.map || {};
    for (var b in pjson.browser) {
      var mapping = pjson.browser[b];
      if (typeof mapping != 'string')
        continue;
      if (b.substr(b.length - 3, 3) == '.js')
        b = b.substr(0, b.length - 3);
      if (mapping.substr(mapping.length - 3, 3) == '.js')
        mapping = mapping.substr(0, mapping.length - 3);
      
      // local maps not supported since this affects the external
      // interface for all other modules
      // only way to implement is through a module alias replacement
      // may be worth considering at some point
      if (b.substr(0, 2) == './')
        continue;

      pjson.map[b] = pjson.map[b] || mapping;
    }
  }
}

function doPreload(pjson, preload) {
  if (!pjson.dependencies)
    return;

  var deps = [];
  for (var p in pjson.dependencies) {
    var dep = pjson.dependencies[p];

    // jquery: github:components/jquery
    // jquery: jquery@1.5
    // -> RHS is dep
    if (dep.indexOf(':') != -1 || dep.indexOf('@') != -1)
      deps.push(dep);

    // jquery: *
    else if (dep == '*')
      deps.push(p);

    // jquery: 1.5
    else
      deps.push(p + '@' + dep);
  }

  preload(deps);
}

// adds the pkg.fresh, pkg.fullHash
// options.inject, options.force, options.override

// note if it is a symlink, we leave it unaltered
exports.download = function(pkg, jspmPackages, options, preload) {

  if (options.inject)
    return _pkg.getCDNPackageJSON(pkg.exactName).then(function(pjson) {
      doPreload(pjson, preload);
      return pjson;
    });

  var downloadDir = path.resolve(jspmPackages, pkg.endpoint, pkg.exactPackage);
  var cacheDir = path.resolve(process.env.HOME, '.jspm', 'packages', pkg.endpoint, pkg.exactPackage);
  var exactVersion, lastNamePart, main;

  var force = options.force;
  var override = options.override;

  var pjson;

  var endpoint = ep.load(pkg.endpoint);

  return Promise.resolve()
  .then(function() {
    exactVersion = pkg.version;
  })

  // get the override
  .then(function() {
    return override || _pkg.checkOverride(pkg);
  })

  .then(function(_override) {
    override = _override;
    
    // no hash -> it's existing and we skipped the lookup
    if (!pkg.hash)
      return true;

    // create the full package hash by combining it with the override
    pkg.fullHash = pkg.hash + md5(JSON.stringify(override || {}));

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
          return _pkg.readJSON(path.resolve(downloadDir, 'package.json'));
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
      return _pkg.readJSON(path.resolve(downloadDir, 'package.json'))
      .then(function(_pjson) {
        pjson = _pjson;
        return true;
      });
    return fresh;
  })

  .then(function(fresh) {
    // fire off preloading using early getPackageConfig hook if available
    if (endpoint.getPackageConfig)
      return Promise.resolve(endpoint.getPackageConfig(pkg.package, exactVersion, pkg.hash))
      .then(function(_pjson) {
        // we only use the getPackageConfig pjson if
        // we are going to run a build, otherwise we use the saved one
        if (!pjson) {
          pjson = _pjson;
          // apply the override and package config operations
          derivePackageConfig(pjson, override);
        }
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
      return _pkg.processPackage(pkg, cacheDir, _pjson || pjson, override);
    })
    // we've now finished creating the cache directory
    .then(function(_pjson) {
      pjson = _pjson;
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
    return pjson;
  });
}

/*
 Given a raw package in a folder,
 apply the package.json build operations etc

 Also saves the hash into the folder

 pjson is optional if provided by getPackageConfig
*/
exports.processPackage = function(pkg, dir, pjson, override) {
  var endpoint = ep.load(pkg.endpoint);

  return Promise.resolve()

  // if no getPackageConfig, load package.json from download folder
  // getPackageConfig is always primary source if provided
  .then(function() {
    if (!pjson)
      return _pkg.readJSON(path.resolve(dir, 'package.json'));
  })

  // apply package.json overrides
  .then(function(_pjson) {
    if (_pjson) {
      pjson = _pjson;

      // apply the override and package config operations
      derivePackageConfig(pjson, override || {});
    }

    // now that we have the derived pjson, do the endpoint build
    if (endpoint.build)
      return endpoint.build(pjson, dir);
  })

  // apply build operations from the package.json
  .then(function() {
    // don't build in dependencies
    var pjsonObj = extend({}, pjson);
    delete pjsonObj.dependencies;
    return build.buildPackage(dir, pjsonObj);
  })

  // save the final calculated package.json in place
  .then(function() {
    return asp(fs.writeFile)(path.resolve(dir, 'package.json'), JSON.stringify(pjson, null, 2))
  })

  .then(function() {
    return pjson;
  });
}

exports.readJSON = function(file) {
  return asp(fs.readFile)(file)

  .then(function(pjson) {
    try {
      return JSON.parse(pjson);
    }
    catch(e) {
      return {};
    }
  }, function(err) {
    if (err.code === 'ENOENT')
      return {};
    throw err;
  });
}

exports.createMain = function(pkg, pjson, downloadDir) {
  var lastNamePart, main;

  return Promise.resolve()

  // create the main entry point
  .then(function() {
    lastNamePart = pkg.name.split('/').pop().split(':').pop();
    main = typeof pjson.browser == 'string' && pjson.browser || typeof pjson.main == 'string' && pjson.main;

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


