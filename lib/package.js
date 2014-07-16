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

var https = require('https');
var ui = require('./ui');
var semver = require('./semver');
var nodeSemver = require('semver');
var Promise = require('rsvp').Promise;
var build = require('./build');
var config = require('./config');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');

var path = require('path');

var fs = require('graceful-fs');

exports.https = false;

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





var endpoints = {};
exports.loadEndpoint = function(endpoint) {
  var endpoints = config.globalConfig.endpoint || {};
  try {
    // ensure the tmpDir exists
    var tmpDir = process.env.HOME + path.sep + '.jspm' + path.sep + 'tmp-' + endpoint;
    if (!fs.existsSync(tmpDir))
      fs.mkdirSync(tmpDir);

    return endpoints[endpoint] = new (require(endpoints[endpoint] || 'jspm-' + endpoint))(extend({ log: false, timeout: 120, tmpDir: tmpDir }, config.globalConfig[endpoint] || {}));
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
exports.registryCache = {};
exports.locate = function(target) {
  if (target.endpoint)
    return Promise.resolve(target);

  if (_pkg.registryCache[target.exactName])
    return Promise.resolve(new Package(_pkg.registryCache[target.exactName]));

  ui.log('info', 'Looking up %' + target.name + '% in registry');

  return new Promise(function(resolve, reject) {
    var resData = [];
    https.get({
      hostname: 'registry.jspm.io',
      path: '/' + target.exactName,
      headers: { accept: 'application/json' },
      rejectUnauthorized: false
    }, function(res) {
      res.on('data', function(chunk) { resData.push(chunk); });
      res.on('end', function() {
        var result = resData.join('');
        try {
          result = JSON.parse(result);
        }
        catch(e) {
          return reject(result ? result : 'Not found');
        }
        _pkg.registryCache[target.exactName] = result.name;
        resolve(new Package(result.name));
      });
      res.on('error', function(err) {
        reject('Unable to connect to registry\n' + err.stack);
      });
    });
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
    if (versionCache[pkg.package])
      return versionCache[pkg.package];

    ui.log('info', 'Checking versions for `' + pkg.name + '`');

    return new Promise(function(resolve, reject) {
      var promise = _pkg.loadEndpoint(pkg.endpoint).getVersions(pkg.package, resolve, reject);
      if (promise)
        promise.then(resolve, reject);
    })
    .then(function(versions) {
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
      return versionCache[pkg.package] = versionMap;
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
      if (!versionList[i].stable)
        continue;

      if (!pkg.version || semver.match(pkg.version, versionList[i])) {
        return { version: versionList[i], hash: versionMap[versionList[i]].hash };
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

exports.checkOverride = function(fullName, cdn) {
  var hostname, path;
  if (!cdn) {
    hostname = 'github.jspm.io';
    path = '/jspm/registry@master/package-overrides/' + fullName.replace(':', '/') + '.json';
  }
  else {
    hostname = fullName.substr(0, fullName.indexOf(':')) + '.jspm.io';
    path = '/' + fullName.substr(fullName.indexOf(':') + 1) + '/package.json';
  }

  return new Promise(function(resolve, reject) {
    https.get({
      hostname: hostname,
      path: path,
      rejectUnauthorized: false
    }, function(res) {
      if (res.statusCode == 404) {
        res.socket.destroy();
        return resolve();
      }

      if (res.statusCode != 200) {
        res.socket.destroy();
        return reject('Error requesting package.json');
      }

      var pjsonData = [];
      res.on('data', function(chunk) { pjsonData.push(chunk); });
      res.on('end', function() {
        try { 
          resolve(JSON.parse(pjsonData.join(''))); 
        }
        catch(e) {
          if (cdn)
            reject('Unable to parse package.json');
          else
            resolve();
        }
      });
      res.on('error', reject);
    });
  });
}

exports.inject = function(pkg, override) {
  // simultaneously request the package.json from CDN and the override if needed
  // finally parse the overridden package.json returning the dependency list
  return _pkg.checkOverride(pkg.exactName, true)
  .then(function(pjson) {
    return config.parseDependencies(pjson.dependencies, pjson.registry);
  });
}

function isFresh(dir, hash) {
  return asp(fs.readFile)(path.resolve(dir, '.jspm-hash')).then(function(_hash) { 
    return hash == _hash + '';
  }, function() {});
}


// adds the pkg.fresh property in the process
exports.download = function(pkg, jspmPackages, override, force) {
  var downloadDir = path.resolve(jspmPackages, pkg.endpoint, pkg.exactPackage);
  

  // if not forcing, and we have a hash, check if the download folder is fresh
  // no hash means we have skipped a lookup as we are using an existing file
  // so we are fresh by default
  // forcing means always not fresh

  return ((force || !pkg.hash) ? Promise.resolve(force ? false : true) : isFresh(downloadDir, pkg.hash))

  // if not fresh, simultaneously check for an override and do the download
  .then(function(fresh) {
    pkg.fresh = fresh;
    if (fresh)
      return false;

    ui.log('info', 'Downloading `' + pkg.exactName + '`');
    
    return Promise.all([
      override ? Promise.resolve(override) : _pkg.checkOverride(pkg.exactName, true),

      Promise.resolve(downloadDir)
      
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
      .then(function() {
        return new Promise(function(resolve, reject) {
          var exactVersion = versionCache[pkg.package][pkg.version].original || pkg.version;
          var promise = _pkg.loadEndpoint(pkg.endpoint).download(pkg.package, exactVersion, pkg.hash, downloadDir, resolve, reject);
          if (promise)
            promise.then(resolve, reject);
        });
      })

      // if the download defines the package.json use that
      // otherwise load the package.json
      .then(function(pjson) {
        if (pjson)
          return pjson;

        return asp(fs.readFile)(path.resolve(downloadDir, 'package.json'))
        .then(function(data) {
          try {
            return JSON.parse(data);
          }
          catch(e) {}
        }, function() {});
      })
    ])
    // apply the overrides to get a final package.json
    .then(function(pjsons) {

      var pjson = pjsons && pjsons[1] || {};
      var override = pjsons && pjsons[0];

      pjson.useJSExtensions = true;

      if (override) {
        pjson = override;
      }
      else {

        // apply the jspm internal overrides first
        if (pjson.jspm)
          extend(pjson, pjson.jspm);
      }


      if (typeof pjson.registry == 'string' && pjson.registry.toLowerCase == 'npm')
        pjson.useJSExtensions = true;

      // parse the dependencies
      pjson.dependencies = config.parseDependencies(pjson.dependencies, pjson.registry);

      // having parsed, note now that we are in the jspm registry form
      pjson.registry = 'jspm';

      // if there is a "browser" object, convert it into map config for browserify support
      if (typeof pjson.browser == 'object') {
        pjson.map = pjson.map || {};
        for (var b in pjson.browser) {
          var mapping = pjson.browser[b];
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
    })

    // apply build operations from the package.json
    .then(function(pjson) {
      // don't build in dependencies
      var pjsonObj = extend({}, pjson);
      delete pjsonObj.dependencies;

      return build.buildPackage(downloadDir, pjsonObj)
      .then(function() {
        return pjson;
      });
    })

    // save the final calculated package.json in place
    .then(function(pjson) {
      return asp(fs.writeFile)(path.resolve(downloadDir, 'package.json'), JSON.stringify(pjson, null, 2))
      .then(function() {
        return pjson;
      });
    })

    // create the main entry point
    .then(function(pjson) {
      var lastNamePart = pkg.name.split('/').pop().split(':').pop();
      var main = typeof pjson.browser == 'string' && pjson.browser || typeof pjson.main == 'string' && pjson.main;

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
        // NB should move this into full tree completion, but is tricky due to async edge cases
        return asp(fs.writeFile)(path.resolve(downloadDir, '.jspm-hash'), pkg.hash)
      })
      .then(function() {
        return pjson;
      })
    })
  })
  .then(function(pjson) {
    if (pjson)
      return pjson;

    // if fresh, load the package.json
    return asp(fs.readFile)(path.resolve(downloadDir, 'package.json'))
    .then(function(data) {
      try {
        return JSON.parse(data);
      }
      catch(e) {}
    }, function() {});
  })

  // return the dependencies
  .then(function(pjson) {
    return pjson && pjson.dependencies || {};
  });
}





