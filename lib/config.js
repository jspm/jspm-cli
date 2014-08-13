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

var ui = require('./ui');
var fs = require('graceful-fs');
var path = require('path');
var pkg = require('./package');
var Package = pkg.Package;
var Promise = require('rsvp').Promise;
var nodeSemver = require('semver');

// config file info
exports.baseMap = null;
exports.depMap = null;
exports.versions = null;

exports.loaded = false;

exports.paths = null;
exports.shim = null;
exports.bundles = null;
exports.baseURL = null;

// package.json dir
exports.dir = null;

// package.json info
exports.name = null;
exports.main = null;
exports.dependencies = null;
exports.map = null;
exports.lib = null;
exports.dist = null;
exports.jspmPackages = null;
exports.buildConfig = null;
exports.configFile = null;

exports.globalConfig;

var config = module.exports;

// convert a Node function into a promise
// asp(mkdirp)(dirname).then(...)
function asp(fn) {
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

function dirContains(dirName, fileName) {
  dirName = path.resolve(dirName);
  fileName = path.resolve(fileName);
  return path.relative(dirName, fileName).substr(0, 2) != '..';
}

function getPackageJSONDir(checkDir) {

  if (!checkDir)
    checkDir = process.cwd();

  // backtrack until we find a package.json

  // check if we have a package.json in this directory
  return asp(fs.readFile)(path.resolve(checkDir, 'package.json'))
  // found a package.json
  .then(function(data) {
    return Promise.resolve(data)
    .then(function(data) {
      try {
        return JSON.parse(data);
      }
      catch(e) {
        return true;
      }
    }, function() {})
    .then(function(pjson) {
      if (pjson === true)
        throw 'Invalid package.json file';
      if (!pjson)
        return config.create();
      if (checkDir == process.cwd()) {
        config.dir = checkDir;
        return pjson;
      }
      // if any of the package dirs are this dir, then we have the right package.json
      var dirList = [];
      if (pjson.directories) {
        for (var d in pjson.directories)
          dirList.push(pjson.directories[d]);
        if (!pjson.directories.jspmPackages)
          dirList.push('jspm_packages');
      }

      if (pjson.configFile && pjson.configFile != 'config.js')
        dirList.push(path.dirname(pjson.configFile));
      if (pjson.main)
        dirList.push(path.dirname(pjson.main));

      for (var i = 0; i < dirList.length; i++) {
        if (dirContains(process.cwd(), path.resolve(checkDir, dirList[i]))) {
          config.dir = checkDir;
          return pjson;
        }
      }
      // no luck
      return config.create();
    });

  }, function(err) {
    if (err.code != 'ENOENT')
      throw err;

    // no package.json -> backtrack up to next directory
    var pathParts = checkDir.split(path.sep);
    pathParts.pop();
    var nextDir = pathParts.join(path.sep);
    if (nextDir)
      return getPackageJSONDir(pathParts.join(path.sep));
    else
      return config.create();
  });
}

exports.load = function() {
  return getPackageJSONDir()
  .then(function(pjson) {
    // parse the package.json into a usable form
    config.dependencies = {};
    config.map = {};

    // newly created doesn't need parsing
    if (!pjson)
      return;

    if (pjson.jspm) {
      // jspm dependencies replace base dependencies (allows npm co-existence)
      if (pjson.jspm.dependencies)
        pjson.jspm.registry = pjson.jspm.registry || 'jspm';
      for (var p in pjson.jspm)
        pjson[p] = pjson.jspm[p];
    }

    config.lib = path.resolve(config.dir, pjson.directories && pjson.directories.lib || 'lib');
    config.dist = path.resolve(config.dir, pjson.directories && pjson.directories.dist || 'dist');
    config.jspmPackages = path.resolve(config.dir, pjson.directories && pjson.directories['jspmPackages'] || 'jspm_packages');

    if (pjson.configFile)
      config.configFile = path.resolve(config.dir, pjson.configFile);
    
    if (pjson.buildConfig)
      config.buildConfig = pjson.buildConfig;

    config.name = pjson.name || 'app';
    config.main = pjson.main;

    if (pjson.dependencies) {
      for (var d in pjson.dependencies) {
        var dep = pjson.dependencies[d];

        // version only
        if (dep.indexOf(':') == -1 && dep.indexOf('@') == -1)
          dep = d + '@' + dep;

        // convert into package objects
        config.dependencies[d] = new Package(dep);
      }
    }

    config.map = pjson.map || {};
  })

  // load the configFile, creating if necessary
  .then(function() {
    if (config.configFile == null)
      config.configFile = 'config.js';

    return asp(fs.readFile)(config.configFile).then(function(config) {
      return config + '';
    }, function(err) {
      if (err == 'ENOENT')
        throw 'Error accessing configuration file %' + config.configFile + '%';
      return ui.confirm('Configuration file %' + path.relative(config.dir, config.configFile) + '% not found, create it?', true).then(function(create) {
        if (!create)
          throw 'Operation cancelled';
        config.doCreate = true;
        return '';
      });
    });
  })

  // parse the configuration file
  .then(function(configSource) {
    var cfg = {};
    try {
      var System = {
        config: function(_cfg) {
          for (var c in _cfg) {
            var v = _cfg[c];
            if (typeof v == 'object') {
              cfg[c] = cfg[c] || {};
              for (var p in v)
                cfg[c][p] = v[p];
            }
            else
              cfg[c] = v;
          }
        },
        paths: {},
        map: {},
        versions: {}
      };
      eval(configSource);

      // allow declarative form too
      var config = System.config;
      delete System.config;
      config(System);
    }
    catch(e) {
      ui.log('err', e);
    }
    return cfg;
  })
  .then(function(cfg) {
    config.curConfig = cfg;
    
    config.paths = cfg.paths;
    config.shim = cfg.shim;
    config.bundles = cfg.bundles;
    config.baseURL = cfg.baseURL;

    // what we really care about...
    config.versions = config.versions || {};
    for (var v in cfg.versions)
      config.versions[v] = cfg.versions[v];

    // convert any version strings into array for easy handling
    config.depMap = {};
    config.baseMap = {};
    for (var v in config.versions)
      if (typeof config.versions[v] == 'string')
        config.versions[v] = [config.versions[v]];

    // separate map into baseMap and depMap
    for (var d in cfg.map) {
      if (typeof cfg.map[d] == 'string')
        config.baseMap[d] = new Package(cfg.map[d]);
      else {
        var depMap = cfg.map[d];
        config.depMap[d] = {};
        for (var m in depMap)
          config.depMap[d][m] = new Package(depMap[m]);
      }
    }

    config.loaded = true;
  });
}

// create a new package.json file in the current directory
exports.create = function() {
  config.dir = process.cwd();

  return ui.confirm('No package.json found, would you like to create one?', true)
  .then(function(create) {
    if (!create) 
      throw 'Operation cancelled';
  })
  /* .then(function() {
    return ui.input('Enter package name', 'app');
  })
  .then(function(name) {
    config.name = name;
    return ui.input('Enter application folder', 'lib');
  }) */
  .then(function(lib) {
    config.lib = lib;
    return ui.confirm('Would you like jspm to prefix its package.json properties under %jspm%?', true)
  })
  .then(function(prefix) {
    config.prefix = prefix;
    return ui.input('Enter packages folder', 'jspm_packages');
  })
  .then(function(jspmPackages) {
    config.jspmPackages = jspmPackages;
    return ui.input('Enter config file path', 'config.js');
  })
  .then(function(configFile) {
    config.configFile = configFile;
    config.loaded = true;
  });
}

function hasProperties(obj) {
  for (var p in obj)
    return true;
  return false;
}


var savePromise;
exports.save = function() {
  // if already saving, wait for current save to complete before saving again
  if (savePromise)
    return savePromise.then(exports.save);

  var hasConfig = config.doCreate || false;

  var curConfig = config.curConfig = config.curConfig || {};

  if (config.baseURL)
    curConfig['baseURL'] = config.baseURL;

  hasConfig = hasConfig || hasProperties(config.paths);

  config.paths = config.paths || {};
  config.paths['*'] = '*.js';
  /* if (!config.paths[config.name + '/*'])
    config.paths[config.name + '/*'] = path.relative(config.dir, config.lib) + '/*.js'; */
  curConfig.paths = curConfig.paths || {};
  for (var p in config.paths)
    curConfig.paths[p] = config.paths[p];

  if (config.shim && hasProperties(config.shim) && (hasConfig = true)) {
    curConfig.meta = curConfig.meta || {};
    for (var s in config.shim) {
      var curShim = config.shim[s];
      if (curShim.deps)
        curConfig.meta[s].deps = curShim.deps;
      if (curShim.exports)
        curConfig.meta[s].exports = curShim.exports;
      if (curShim.init)
        curConfig.meta[s].init = curShim.init;
    }
  }

  curConfig.map = curConfig.map || {};

  for (var d in config.baseMap)
    curConfig.map[d] = config.baseMap[d].exactName;

  for (var d in config.depMap) {
    curConfig.map[d] = curConfig.map[d] || {};
    var curDep = config.depMap[d];
    for (var dep in curDep) {
      // the node core libs are an exception
      if (dep == 'nodelibs')
        continue;
      curConfig.map[d][dep] = curDep[dep].exactName;
    }
  }


  curConfig.versions = curConfig.versions || {};

  for (var v in config.versions) {
    var version = config.versions[v];
    if (version.length == 1)
      version = version[0];
    if (version.length != 0)
      curConfig.versions[v] = version;
  }

  return savePromise = Promise.resolve()
  .then(function() {
    if (!hasConfig || config.configFile)
      return;
    // ask to create again here if not existing
    config.configFile = 'config.js';
    return ui.confirm('Configuration file %' + config.configFile + '% not found, create it?', true).then(function(create) {
      if (!create)
        throw 'Operation cancelled';
      hasConfig = true;
    });
  })
  .then(function() {
    if (!hasConfig)
      return;

    var configContent = '';

    var meta = config.curConfig.meta;
    var depCache = config.curConfig.depCache;
    var map = config.curConfig.map;
    var versions = config.curConfig.versions;

    delete config.curConfig.meta;
    delete config.curConfig.depCache;
    delete config.curConfig.map;
    delete config.curConfig.versions;

    if (hasProperties(config.curConfig))
      configContent += 'System.config(' + JSON.stringify(config.curConfig, null, 2) + ');\n\n';

    config.curConfig.meta = meta;
    config.curConfig.depCache = depCache;
    config.curConfig.map = map;
    config.curConfig.versions = versions;


    if (hasProperties(meta))
      configContent += 'System.config(' + JSON.stringify({ meta: meta }, null, 2) + ');\n\n';

    if (hasProperties(depCache))
      configContent += 'System.config(' + JSON.stringify({ depCache: depCache }, null, 2) + ');\n\n';

    if (hasProperties(map))
      configContent += 'System.config(' + JSON.stringify({ map: map }, null, 2) + ');\n\n';

    if (hasProperties(versions))
      configContent += 'System.config(' + JSON.stringify({ versions: versions }, null, 2) + ');\n\n';

    return asp(fs.writeFile)(config.configFile, configContent);
  })

  // read package.json
  .then(function() {
    return asp(fs.readFile)(path.resolve(config.dir, 'package.json'))
  })
  .then(JSON.parse, function(err) { return {}; })
  .then(function(pjson) {
    var _pjson = pjson;
    config.prefix = config.prefix || pjson.jspm;
    if (config.prefix)
      pjson = pjson.jspm = pjson.jspm || {};

    if (config.name && config.name != 'app')
      pjson.name = config.name;

    if (config.main)
      pjson.main = config.main;

    if (!pjson.main)
      delete pjson.main;

    var directories = pjson.directories || {};

    if (config.lib)
      directories.lib = path.relative(config.dir, config.lib);
    if (config.dist)
      directories.dist = path.relative(config.dir, config.dist);
    if (config.jspmPackages)
      directories.jspmPackages = path.relative(config.dir, config.jspmPackages);

    if (directories.jspmPackages == 'jspm_packages')
      delete directories.jspmPackages;

    if (directories.lib == 'lib')
      delete directories.lib;

    if (directories.dist == 'dist')
      delete directories.dist;

    if (hasProperties(directories))
      pjson.directories = directories;

    if (config.configFile)
      pjson.configFile = path.relative(config.dir, config.configFile);

    if (pjson.configFile == 'config.js')
      delete pjson.configFile;

    // reuse existing package.json dependencies if possible to maintain ordering
    var dependencies = pjson.dependencies = pjson.dependencies || {};
    var depValue;
    var seen = [];
    for (var d in config.dependencies) {
      seen.push(d);
      var dep = config.dependencies[d];
      var regName;
      // github:some/thing: x.y.z
      if (d == dep.name)
        depValue = dep.version;
      // name is exactly as in registry 
      // jquery: github:components/jquery@^x.y.z -> jquery: ^x.y.z
      else if (
        ((regName = pkg.registryCache[d + '@' + dep.version]) && (regName == dep.exactName)) ||
        ((regName = pkg.registryCache[d]) && (regName == dep.name))
      )
        depValue = dep.version;
      else
        depValue = config.dependencies[d].exactName;
      if (dependencies[d] != depValue)
        dependencies[d] = depValue;
    }

    // remove any dependencies no longer present
    for (var d in dependencies) {
      if (seen.indexOf(d) == -1)
        delete dependencies[d];
    }

    if (config.prefix)
      pjson.registry = 'jspm';
    else if (pjson.register != 'jspm')
      delete pjson.registry;
    delete pjson.dependencies;

    if (hasProperties(dependencies))
      pjson.dependencies = dependencies;

    delete pjson.buildConfig;
    if (config.buildConfig)
      pjson.buildConfig = config.buildConfig;

    // save package.json
    return asp(fs.writeFile)(path.resolve(config.dir, 'package.json'), JSON.stringify(_pjson, null, 2));
  })
  .then(function() {
    savePromise = undefined;
  });
}

// convert NodeJS or Bower dependencies into jspm-compatible dependencies
var githubRegEx = /^git(\+[^:]+)?:\/\/github.com\/(.+)/;
var protocolRegEx = /^[^\:\/]+:\/\//;
exports.parseDependencies = function(dependencies, registry) {
  // no registry -> no dependencies!
  if (!registry)
    return {};

  if (typeof registry != 'string')
    return {};

  registry = registry.toLowerCase();

  if (registry == 'jspm')
    return dependencies;

  // do dependency parsing
  for (var d in dependencies) (function(d) {
    var dep = dependencies[d];

    var match, name, version = '';

    // 1. git://github.com/name/repo.git#version -> git:name/repo@version
    if (match = dep.match(githubRegEx)) {
      dep = match[2];
      name = 'github:' + dep.split('#')[0];
      version = dep.split('#')[1];
      if (name.substr(name.length - 4, 4) == '.git')
        name = name.substr(0, name.length - 4);
    }
    
    // 2. url:// -> not supported
    else if (dep.match(protocolRegEx))
      throw 'Dependency ' + dep + ' not supported by jspm';

    // 3. name/repo#version -> github:name/repo@version
    else if (dep.split('/').length == 2) {
      name = 'github:' + dep.split('#')[0];
      version = dep.split('#')[1];
    }

    // 4. name#version -> registry:name@version  (bower only)
    else if ((match = dep.indexOf('#')) != -1) {
      name = registry + ':' + dep.substr(0, match);
      version = dep.substr(match + 1);
    }

    // 5. version -> registry:name@version
    else {
      name = registry + ':' + d;
      version = dep;
    }

    // in all of the above, the version is sanitized from a general semver range into a jspm-compatible version range
    // if it is an exact semver, or a tag, just use it directly
    if (!nodeSemver.valid(version)) {
      if (version == '' || version == '*')
        version = '';
      else
        var range = nodeSemver.validRange(version);

      if (range) {
        // if it has OR semantics, we only support the last range
        if (range.indexOf('||') != -1)
          range = range.split('||').pop();

        var rangeParts = range.split(' ');

        // convert AND statements into a single lower bound and upper bound
        // enforcing the lower bound as inclusive and the upper bound as exclusive
        var lowerBound = null;
        var upperBound = null;
        for (var i = 0; i < rangeParts.length; i++) {
          var part = rangeParts[i];
          var a = part.charAt(0);
          var b = part.charAt(1);

          // get the version
          var v = part;
          if (b == '=')
            v = part.substr(2);
          else if (a == '>' || a == '<' || a == '=')
            v = part.substr(1);

          // and the operator
          var gt = a == '>';
          var lt = a == '<';

          if (gt) {
            // take the highest lower bound
            if (!lowerBound || nodeSemver.gt(lowerBound, v))
              lowerBound = v;
          }
          else if (lt) {
            // take the lowest upper bound
            if (!upperBound || nodeSemver.lt(upperBound, v))
              upperBound = v;
          }
          else {
            // equality
            lowerBound = upperBound = part.substr(1);
            break;
          }
        }

        // for some reason nodeSemver adds "-0" when not appropriate
        if (lowerBound && lowerBound.substr(lowerBound.length - 2, 2) == '-0')
          lowerBound = lowerBound.substr(0, lowerBound.length - 2);
        if (upperBound && upperBound.substr(upperBound.length - 2, 2) == '-0')
          upperBound = upperBound.substr(0, upperBound.length - 2);

        if (!upperBound && !lowerBound)
          version = '';

        // if no upperBound, then this is just compatible with the lower bound
        else if (!upperBound)
          version = '^' + (lowerBound.substr(0, 4) != '0.0.' ? lowerBound : '0.0');

        // if no lowerBound, use the upperBound directly
        else if (!lowerBound)
          version = upperBound;

        else {
          var lowerParts = lowerBound.split('.');
          var upperParts = upperBound.split('.');

          // if upperbound is the exact major, and the lower bound is the exact version below, set to exact major
          if (parseInt(upperParts[0]) == parseInt(lowerParts[0]) + 1 && upperParts[1] == '0' && upperParts[2] == '0' && lowerParts[1] == '0' && lowerParts[2] == '0')
            version = lowerParts[0];

          // if upperbound is exact minor, and the lower bound is the exact minor below, set to exact minor
          else if (upperParts[0] == lowerParts[0] && parseInt(upperParts[1]) == parseInt(lowerParts[1]) + 1 && upperParts[2] == '0' && lowerParts[2] == '0')
            version = lowerParts[0] + '.' + lowerParts[1];

          // if crossing a major boundary -> ^upper major
          else if (upperParts[0] > lowerParts[0] && !(upperParts[1] == '0' && upperParts[2] == '0'))
            version = '^' + upperParts[0];
          
          // if crossing a minor boundary -> ^lower minor > 1, ^upper minor < 1
          else if (upperParts[0] == lowerParts[0] && upperParts[1] > lowerParts[1] && upperParts[2] != '0') {
            if (upperParts[0] != 0)
              version = '^' + lowerParts[0] + '.' + lowerParts[1];
            else
              version = '^0.' + upperParts[1];
          }
          // otherwise ^lowerbound
          else {
            version = '^' + lowerBound;
          }
        }
      }
    }
    
    dependencies[d] = name + (version ? '@' + version : '');
  })(d);
  return dependencies;
}





// global config - automatically created and loaded on startup
exports.endpoints = [];
var globalConfigFile = process.env.HOME + path.sep + '.jspm' + path.sep + 'config';
function saveGlobalConfig() {
  try {
    fs.mkdirSync(process.env.HOME + path.sep + '.jspm');
  }
  catch(e) {
    if (e.code != 'EEXIST')
      ui.log('err', 'Unable to create jspm system folder\n' + e.stack);
  }
  try {
    fs.writeFileSync(globalConfigFile, JSON.stringify(exports.globalConfig, null, 2));
  }
  catch(e) {
    ui.log('err', 'Unable to write global configuration file\n' + e.stack);
  }
}
if (fs.existsSync(globalConfigFile)) {
  try {
    exports.globalConfig = JSON.parse(fs.readFileSync(globalConfigFile) + '');
  }
  catch(e) {
    ui.log('err', 'Unable to read global configuration file');
    exports.globalConfig = {};
  }
}
else {
  exports.globalConfig = {};
  if (process.env.HOME)
    saveGlobalConfig();
}

var endpoints = exports.globalConfig.endpoint = exports.globalConfig.endpoint || {};
endpoints.github = 'jspm-github';
endpoints.npm = 'jspm-npm';
for (var e in endpoints) {
  exports.endpoints.push(e);
}

exports.set = function(name, val) {
  var nameParts = name.split('.');

  var config = exports.globalConfig;
  var part;
  while (nameParts.length > 1) {
    var part = nameParts.shift();
    config[part] = typeof config[part] == 'object' ? config[part] : {};
    config = config[part];
  }
  config[nameParts[0]] = val;
  
  saveGlobalConfig();
}