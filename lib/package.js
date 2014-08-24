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
var build = require('./build');
var config = require('./config');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var path = require('path');

var exec = require('child_process').exec;

var fs = require('graceful-fs');

function extend(a, b) {
  for (var p in b)
    a[p] = b[p];
  return a;
}

// convert a Node function into a promise
// asp(mkdirp)(dirname).then(...)
var asp = function(fn) {
  return function() {
    var self = this;
    var args = Array.prototype.splice.call(arguments, 0);
    return new Promise(function(resolve, reject) {
      args.push(function(err, val) {
        if (err)
          return reject(err);
        resolve(val);
      });
      fn.apply(self, args);
    });    
  }
}

var _pkg = module.exports;

var endpointClasses = {};
exports.loadEndpoint = function(endpoint) {
  if (endpointClasses[endpoint])
    return endpointClasses[endpoint];

  try {
    // ensure the tmpDir exists
    var tmpDir = process.env.HOME + path.sep + '.jspm' + path.sep + 'tmp-' + endpoint;
    if (!fs.existsSync(tmpDir))
      fs.mkdirSync(tmpDir);

    var options = {
      timeout: 120, 
      tmpDir: tmpDir
    };
    extend(options, config.globalConfig[endpoint] || {});

    var endpointClass = require(config.globalConfig.endpoint && config.globalConfig.endpoint[endpoint]);

    return endpointClasses[endpoint] = new endpointClass(options);
  }
  catch(e) {
    ui.log('err', e.stack || e);
    throw 'Unable to load endpoint %' + endpoint + '%';
  }
}

/*
  parse a package name into endpoint:package@version

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

// lookup a package in the registry if necessary
exports.registryCache;

exports.locate = function(target) {
  if (target.endpoint)
    return Promise.resolve(target);

  if (_pkg.registryCache) {
    var registryEntry = _pkg.registryCache[target.exactName];
    if (!registryEntry)
      throw 'Not found.';
    return Promise.resolve(new Package(registryEntry));
  }

  // we haven't loaded the registry yet -> load the registry file
  return _pkg.updateRegistry()
  .then(function() {
    return asp(fs.readFile)(path.resolve(registryPath, 'registry.json'));
  })
  .then(function(json) {
    try {
      return JSON.parse(json);
    }
    catch(e) {
      throw 'Invalid registry JSON file.';
    }
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
var versionCache = {};

exports.lookup = function(pkg) {
  return Promise.resolve()
  // load the version map
  .then(function() {
    if (versionCache[pkg.name])
      return Promise.resolve(versionCache[pkg.name]);

    ui.log('info', 'Checking versions for `' + pkg.name + '`');

    return versionCache[pkg.name] = _pkg.loadEndpoint(pkg.endpoint).lookup(pkg.package)
    .then(function(result) {
      if (result.redirect)
        return exports.lookup(new Package(result.redirect));
      if (result.notfound)
        throw 'Repo `' + pkg.package + '` not found!';
      
      var versions = result.versions;

      var versionMap = {};
      for (var v in versions) {
        var version = v.substr(0, 1) == 'v' ? v.substr(1) : v; 

        var semverMatch = version.match(semver.semverRegEx);
        
        // non stable versions marked
        // tag or branch
        if (!semverMatch || !semverMatch[1] || !semverMatch) {
          versionMap[v] = {
            stable: false,
            hash: versions[v]
          };
        }
        // semver
        else {
          versionMap[version] = {
            stable: semverMatch[3] && !semverMatch[4],
            hash: versions[v],
            original: v
          };
        }
      }

      // save the version cache
      return versionMap;
    });
  })

  // get the version match
  .then(function(versionMap) {

    var rangeVersion = pkg.version.substr(0, 1) == '^' ? pkg.version.substr(1) : pkg.version;
    var rangeMatch = rangeVersion.match(semver.semverRegEx);

    var versionList = [];
    for (var v in versionMap)
      versionList.push(v);

    versionList.sort(semver.compare);

    // find highest stable match
    // latest is empty string
    for (var i = versionList.length - 1; i >=0; i--) {
      var map = versionMap[versionList[i]];
      if (!map.stable)
        continue;

      if (!pkg.version || semver.match(pkg.version, versionList[i])) {
        return { version: versionList[i], hash: map.hash };
      }
    }

    // if we asked for latest, and nothing stable found, use master
    if (!pkg.version) {
      if (versionMap.master)
        return { version: 'master', hash: versionMap.master.hash };
    }

    // finally try an unstable version match (always exact)
    for (var i = 0; i < versionList.length; i++) {
      if (versionList[i].stable)
        continue;
      if (semver.match(pkg.version, versionList[i]))
        return { version: versionList[i], hash: versionMap[versionList[i]].hash };
    }

    // tag or prerelease -> match exact or nothing
    if (pkg.version && (!rangeMatch || rangeMatch[4])) {
      if (versionMap[rangeVersion])
        return { version: rangeVersion, hash: versionMap[rangeVersion].hash };
      return null;
    }
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

exports.getCDNPackageJSON = function(fullName) {
  return asp(request)({
    method: 'get',
    url: 'https://' + fullName.substr(0, fullName.indexOf(':')) + '.jspm.io'
      + '/' + fullName.substr(fullName.indexOf(':') + 1) + '/package.json',
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

// NB this must be updated to use the new folder-based overrides system
//    this way we remove the CDN dependency
exports.checkOverride = function(fullName) {
  return asp(request)({
    method: 'get',
    url: 'https://github.jspm.io/jspm/registry@master/package-overrides/' + fullName.replace(':', '/') + '.json',
    rejectUnauthorized: false
  }).then(function(res) {
    if (res.statusCode == 404)
      return;
    
    if (res.statusCode != 200)
      throw 'Error requesting package.json';

    try {
      return JSON.parse(res.body);
    }
    catch(e) {
      if (cdn)
        throw 'Unable to parse package.json';
    }
  });
}

exports.loadConfig = function(pkg, override, inject) {
  // for injection, load the derived package.json from CDN
  if (inject)
    return _pkg.getCDNPackageJSON(pkg.exactName);

  return Promise.resolve(versionCache[pkg.name])
  .then(function(versionMap) {
    var exactVersion = versionMap[pkg.version].original || pkg.version;
  
    return Promise.all([
      override ? Promise.resolve(override) : _pkg.checkOverride(pkg.exactName),

      _pkg.loadEndpoint(pkg.endpoint).loadConfig(pkg.package, exactVersion, pkg.hash),
    ]);
  })
  .then(function(pjsons) {
    // apply the overrides to get a final package.json
    var pjson = pjsons && pjsons[1] || {};
    var override = pjsons && pjsons[0];

    // apply the jspm internal overrides first
    if (pjson.jspm)
      extend(pjson, pjson.jspm);

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

    return pjson;
  });
}

// clones / updates github:jspm/registry to ~/.jspm/registry 
var registryUpdated = false;
var registryPath = path.resolve(process.env.HOME, '.jspm/registry');
exports.updateRegistry = function() {
  if (registryUpdated)
    return Promise.resolve();

  return asp(fs.stat)(registryPath)
  .then(function() {
    // if the registry does exist, update it
    ui.log('info', 'Updating registry cache');
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
  }, function() {});
}


// adds the pkg.fresh property in the process
exports.download = function(pkg, pjson, jspmPackages, force) {
  var downloadDir = path.resolve(jspmPackages, pkg.endpoint, pkg.exactPackage);
  var exactVersion, lastNamePart, main;

  return Promise.resolve(versionCache[pkg.name])
  .then(function(versionMap) {
    exactVersion = versionMap[pkg.version].original || pkg.version;

    // if not forcing, and we have a hash, check if the download folder is fresh
    // no hash means we have skipped a lookup as we are using an existing file
    // so we are fresh by default
    // forcing means always not fresh
    return ((force || !pkg.hash) ? Promise.resolve(force ? false : true) : isFresh(downloadDir, pkg.hash));
  })

  .then(function(fresh) {
    pkg.fresh = fresh;
    if (fresh)
      return;

    // if not fresh, check to see if we have this hash in our cache

    // download if not fresh
    ui.log('info', 'Downloading `' + pkg.exactName + '`');

    return Promise.resolve(downloadDir)
    
    // ensure the download directory exists
    .then(asp(mkdirp))

    // clear the directory
    .then(function() {  
      return asp(rimraf)(downloadDir);
    })
      
    .then(function() {
      return asp(fs.mkdir)(downloadDir)
    })

    // do the download
    // NB this is where we should download to a cached global directory
    .then(function() {
      return _pkg.loadEndpoint(pkg.endpoint).download(pkg.package, exactVersion, pkg.hash, downloadDir);
    })

    // do the build
    .then(function() {
      var endpoint = _pkg.loadEndpoint(pkg.endpoint);
      if (endpoint.build)
        return endpoint.build(pjson, downloadDir);
    })

    // apply build operations from the package.json
    .then(function() {
      // don't build in dependencies
      var pjsonObj = extend({}, pjson);
      delete pjsonObj.dependencies;
      return build.buildPackage(downloadDir, pjsonObj)
    })

    // save the final calculated package.json in place
    .then(function() {
      return asp(fs.writeFile)(path.resolve(downloadDir, 'package.json'), JSON.stringify(pjson, null, 2))
    })

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
      })
    })
    .then(function(exists) {
      if (exists)
        return true;

      main = lastNamePart;
      return new Promise(function(resolve, reject) {
        fs.exists(path.resolve(downloadDir, main.substr(main.length - 3, 3) != '.js' ? main + '.js' : main), resolve);
      })
    })
    .then(function(exists) {
      // create the main pointer
      var mainFile = path.resolve(downloadDir, '../' + lastNamePart + '@' + pkg.version + '.js');
      return asp(fs.writeFile)(mainFile, 'export * from "' + pkg.exactName + '/' + main + '";');
    })
    .then(function() {
      // finally add the .jspm-hash
      return asp(fs.writeFile)(path.resolve(downloadDir, '.jspm-hash'), pkg.hash)
    });
  });
}





