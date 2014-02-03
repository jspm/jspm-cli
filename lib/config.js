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

var cli = require('./cli');
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

exports.load = function(checkDir) {
  if (!checkDir)
    checkDir = process.cwd();

  // backtrack until we find a package.json

  // check if we have a package.json in this directory
  var pjsonPath = path.resolve(checkDir, 'package.json');
  return new Promise(function(resolve, reject) {
    fs.exists(pjsonPath, resolve);
  })
  .then(function(pjson) {
    if (!pjson) {
      var pathParts = checkDir.split(path.sep);
      pathParts.pop();
      var nextDir = pathParts.join(path.sep);
      if (nextDir)
        return config.load(pathParts.join(path.sep));
      else
        return config.create();
    }

    // read package.json
    return asp(fs.readFile)(path.resolve(checkDir, 'package.json'))

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
        throw 'Invalid package.json file'
      
      if (!pjson)
        return config.create();

      // if it is the current directory we're good
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

      if (pjson.configFile)
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
    })

    // parse the package.json into a usable form
    .then(function(pjson) {
      config.dependencies = {};
      config.map = {};

      // newly created doesn't need parsing
      if (!pjson)
        return;


      config.lib = path.resolve(config.dir, pjson.directories && pjson.directories.lib || 'lib');
      config.dist = path.resolve(config.dir, pjson.directories && pjson.directories.dist || 'dist');
      config.jspmPackages = path.resolve(config.dir, pjson.directories && pjson.directories['jspm_packages'] || 'jspm_packages');

      if (pjson.configFile)
        config.configFile = path.resolve(config.dir, pjson.configFile);
      
      if (pjson.buildConfig)
        config.buildConfig = pjson.buildConfig;

      config.name = pjson.name || 'app';
      config.main = pjson.main || 'main';

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
        return;

      return asp(fs.readFile)(config.configFile).then(function(config) {
        return config + '';
      }, function(err) {
        if (err == 'ENOENT')
          throw 'Error accessing configuration file %' + config.configFile + '%';
        return cli.input('Configuration file %' + path.relative(config.dir, config.configFile) + '% not found, create it?', 'y').then(function(create) {
          if (!create)
            throw 'Operation cancelled';
          config.create = true;
          return '';
        });
      });
    })

    // parse the configuration file
    .then(function(cfg) {
      var System = {
        paths: {},
        map: {},
        shim: {},
        versions: {},
        bundles: {},
        baseURL: null
      };

      // evaluate all configuration, as parsing separate JSON blogs is harder
      // we will completely rewrite this file on saving
      eval(cfg);
      
      config.paths = System.paths;
      config.shim = System.shim;
      config.bundles = System.bundles;
      config.baseURL = System.baseURL;

      // what we really care about...
      config.versions = System.versions;

      // convert any version strings into array for easy handling
      config.depMap = {};
      config.baseMap = {};
      for (var v in config.versions)
        if (typeof config.versions[v] == 'string')
          config.versions[v] = [config.versions[v]];

      // separate map into baseMap and depMap
      for (var d in System.map) {
        if (typeof System.map[d] == 'string')
          config.baseMap[d] = new Package(System.map[d]);
        else {
          var depMap = config.depMap[d] = System.map[d];
          for (var m in depMap)
            depMap[m] = new Package(depMap[m]);
        }
      }

      config.loaded = true;
    });

  });
}

// create a new package.json file in the current directory
exports.create = function() {
  config.dir = process.cwd();

  return cli.confirm('No package.json found, would you like to create one?', true)
  .then(function(create) {
    if (!create) 
      throw 'Operation cancelled';
  })
  .then(function() {
    return cli.input('Enter package name', 'app');
  })
  .then(function(name) {
    config.name = name;
    return cli.input('Enter application folder', 'lib');
  })
  .then(function(lib) {
    config.lib = lib;
    return cli.input('Enter packages folder', 'jspm_packages');
  })
  .then(function(jspmPackages) {
    config.jspmPackages = jspmPackages;
    return cli.input('Enter config file path', 'config.js');
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

exports.save = function() {

  var configFileContent = "\n";
  var hasConfig = config.create || false;

  if (config.baseURL)
    configFileContent += "System.baseURL = '" + config.baseURL + "';\n\n";

  hasConfig = hasConfig || hasProperties(config.paths);

  config.paths = config.paths || {};
  config.paths[config.name + '/*'] = config.paths[config.name + '/*'] || path.relative(config.dir, config.lib) + '/*.js';
  for (var p in config.paths)
    configFileContent += "System.paths['" + p + "'] = '" + config.paths[p] + "';\n";
  configFileContent += "\n";

  if (config.shim && hasProperties(config.shim) && (hasConfig = true))
    configFileContent += "System.shim = " + JSON.stringify(config.shim, null, 2).replace(/\"/g, "'") + ";\n\n";

  var map = {};

  // if there is a main, provide it as a map
  if (config.main)
    map[config.name] = config.name + '/' + config.main;

  for (var d in config.baseMap)
    map[d] = config.baseMap[d].exactName;

  for (var d in config.depMap) {
    var dMap = {};
    var curDep = config.depMap[d];
    for (var dep in curDep) {
      // the node core libs are an exception
      if (dep == 'nodelibs')
        continue;
      dMap[dep] = curDep[dep].exactName;
    }
    if (hasProperties(dMap))
      map[d] = dMap;
  }

  if (hasProperties(map) && (hasConfig = true))
    configFileContent += "System.map = " + JSON.stringify(map, null, 2).replace(/\"/g, "'") + ";\n\n";

  var versions = {};
  for (var v in config.versions) {
    var version = config.versions[v];
    if (version.length == 1)
      version = version[0];
    if (version.length != 0)
      versions[v] = version;
  }

  if (hasProperties(versions) && (hasConfig = true))
    configFileContent += "System.versions = " + JSON.stringify(versions, null, 2).replace(/\"/g, "'") + ";\n\n";

  if (hasProperties(config.bundles) && (hasConfig = true))
    configFileContent += "System.bundles = " + JSON.stringify(config.bundles, null, 2).replace(/\"/g, "'") + ";\n\n";

  return Promise.resolve()
  .then(function() {
    if (!hasConfig || config.configFile)
      return;
    // ask to create again here if not existing
    config.configFile = 'config.js';
    return cli.input('Configuration file %' + config.configFile + '% not found, create it?', 'y').then(function(create) {
      if (!create)
        throw 'Operation cancelled';
    });
  })
  .then(function() {
    if (!hasConfig)
      return;

    return asp(fs.writeFile)(config.configFile, configFileContent)
  })

  // read package.json
  .then(function() {
    return asp(fs.readFile)(path.resolve(config.dir, 'package.json'))
  })
  .then(JSON.parse, function(err) { return {}; })
  .then(function(pjson) {

    if (config.name != 'app')
      pjson.name = config.name;

    if (config.main != 'main')
      pjson.main = config.main;

    var directories = pjson.directories || {};

    if (config.lib)
      directories.lib = path.relative(config.dir, config.lib);
    if (config.dist)
      directories.dist = path.relative(config.dir, config.dist);
    if (config.jspmPackages)
      directories.jspmPackages = path.relative(config.dir, config.jspmPackages);

    if (directories.jspmPackages == 'jspm_packages')
      delete directories.jspmPackages;

    if (hasProperties(directories))
      pjson.directories = directories;

    if (config.configFile)
      pjson.configFile = path.relative(config.dir, config.configFile);

    var dependencies = {};
    for (var d in config.dependencies) {
      var dep = config.dependencies[d];
      var regName;
      // github:some/thing: x.y.z
      if (d == dep.name)
        dependencies[d] = dep.version;
      // name is exactly as in registry 
      // jquery: github:components/jquery@^x.y.z -> jquery: ^x.y.z
      else if (
        ((regName = pkg.registryCache[d + '@' + dep.version]) && (regName == dep.exactName)) ||
        ((regName = pkg.registryCache[d]) && (regName == dep.name))
      )
        dependencies[d] = dep.version;
      else
        dependencies[d] = config.dependencies[d].exactName;
    }

    pjson.registry = 'jspm';
    delete pjson.dependencies;

    if (hasProperties(dependencies))
      pjson.dependencies = dependencies;

    delete pjson.buildConfig;
    if (config.buildConfig)
      pjson.buildConfig = config.buildConfig;

    // save package.json
    return asp(fs.writeFile)(path.resolve(config.dir, 'package.json'), JSON.stringify(pjson, null, 2));
  })
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
  for (var d in dependencies) {
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
          var part = rangeParts[0];
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

        // if no upperBound, then this is just compatible with the lower bound
        if (!upperBound)
          version = '^' + lowerBound;

        // if no lowerBound, use the upperBound directly
        else if (!lowerBound)
          version = upperBound;

        else {
          var lowerParts = lowerBound.split('.');
          var upperParts = upperBound.split('.');

          // if crossing a major boundary -> ^upper major
          if (upperParts[0] > lowerParts[0])
            version = '^' + upperParts[0];
          
          // if crossing a minor boundary -> ^lower minor > 1, ^upper minor < 1
          else if (upperParts[1] > lowerParts[1]) {
            if (upperParts[0] != 0)
              version = '^' + lowerParts[0] + '.' + lowerParts[1];
            else
              version = '^0.' + upperParts[1];
          }
          // otherwise ^lowerbound
          else
            version = '^' + lowerBound;
        }
      }
    }
    
    dependencies[d] = name + (version ? '@' + version : '');
  }

  return dependencies;
}





// global config - automatically created and loaded on startup
exports.endpoints = ['npm', 'github'];
var globalConfigFile = process.env.HOME + path.sep + '.jspm' + path.sep + 'config';
function saveGlobalConfig() {
  try {
    fs.writeFileSync(globalConfigFile, JSON.stringify(exports.globalConfig, null, 2));
  }
  catch(e) {
    cli.log('err', 'Unable to write global configuration file\n' + e.stack);
  }
}
if (fs.existsSync(globalConfigFile)) {
  try {
    exports.globalConfig = JSON.parse(fs.readFileSync(globalConfigFile) + '');
  }
  catch(e) {
    cli.log('err', 'Unable to read global configuration file');
    exports.globalConfig = {};
  }
}
else {
  exports.globalConfig = {};
  if (process.env.HOME)
    saveGlobalConfig();
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