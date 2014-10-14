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

exports.HOME = process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH;

var ui = require('./ui');
var fs = require('graceful-fs');
var path = require('path');
var pkg = require('./package');
var Package = pkg.Package;
var Promise = require('rsvp').Promise;
var nodeSemver = require('semver');
var asp = require('rsvp').denodeify;
var mkdirp = require('mkdirp');

// cached package.json file
var pjsonCache;

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

// the opposite of extend
// useful for setting default config
function prepend(a, b) {
  for (var p in b) {
    var val = b[p];
    if (typeof val == 'object')
      prepend(a[p] = typeof a[p] == 'object' ? a[p] : {}, val);
    else if (!(p in a))
      a[p] = val;
  }
  return a;
}

function getPackageJSON() {
  if (!process.env.jspmConfigPath)
    return config.create();

  config.dir = path.dirname(process.env.jspmConfigPath);

  return asp(fs.readFile)(process.env.jspmConfigPath)
  .then(function(pjson) {
    try {
      return JSON.parse(pjson);
    }
    catch(e) {
      throw 'Invalid package.json file at `' + process.env.jspmConfigPath; 
    }
  });
}

// create a new package.json file in the current directory
exports.create = function() {
  config.dir = process.cwd();

  var base;

  return ui.confirm('No package.json found, would you like to create one?', true)
  .then(function(create) {
    if (!create) 
      throw 'Operation cancelled';
  })
  .then(function(lib) {
    config.lib = lib;
    return ui.confirm('Would you like jspm to prefix its package.json properties under %jspm%?', true);
  })
  .then(function(prefix) {
    config.prefix = prefix;
    return ui.input('Enter a name for the project (optional)');
  })
  .then(function(name) {
    config.name = name;
    return ui.input('Enter baseURL path', '.');
  })
  .then(function(baseDir) {
    base = baseDir == '.' ? '' : baseDir + path.sep;
    config.baseDir = path.resolve(config.dir, baseDir);
    if (config.name)
      return ui.input('Enter project source folder', base + config.name || 'lib');
  })
  .then(function(lib) {
    config.lib = lib && path.resolve(config.dir, lib) || (base + config.name || 'lib');
    if (config.name)
      return ui.input('Enter project built folder (optional)');
  })
  .then(function(dist) {
    config.dist = dist && path.resolve(config.dir, dist) || (base + 'dist');
    return ui.input('Enter packages folder', base + 'jspm_packages');
  })
  .then(function(jspmPackages) {
    config.jspmPackages = jspmPackages;
    return ui.input('Enter config file path', base + 'config.js');
  })
  .then(function(configFile) {
    config.configFile = configFile;
    config.loaded = true;
    config.doCreate = true;
  });
}

exports.load = function() {
  if (config.loaded)
    return Promise.resolve();

  return getPackageJSON()
  .then(function(pjson) {
    pjsonCache = pjson;

    // parse the package.json into a usable form
    config.dependencies = {};
    config.map = {};

    if (!pjson)
      return;

    if (pjson.jspm) {
      // jspm dependencies replace base dependencies (allows npm co-existence)
      if (pjson.jspm.dependencies)
        pjson.jspm.registry = pjson.jspm.registry || exports.globalConfig.registry;
      for (var p in pjson.jspm)
        pjson[p] = pjson.jspm[p];
    }

    config.name = pjson.name;
    config.main = pjson.main;

    var base = pjson.directories && pjson.directories.baseURL && (pjson.directories.baseURL + path.sep) || '';

    config.baseDir = path.resolve(config.dir, base);

    config.lib = path.resolve(config.dir, pjson.directories && pjson.directories.lib || (base + (config.name || 'lib')));
    config.dist = path.resolve(config.dir, pjson.directories && pjson.directories.dist || (base + 'dist'));
    config.jspmPackages = path.resolve(config.dir, pjson.directories && pjson.directories['jspmPackages'] || (base + 'jspm_packages'));

    if (pjson.configFile)
      config.configFile = path.resolve(config.dir, pjson.configFile);
    
    if (pjson.buildConfig)
      config.buildConfig = pjson.buildConfig;

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
      config.configFile = path.resolve(config.dir, 'config.js');

    return asp(fs.readFile)(config.configFile).then(function(config) {
      return config + '';
    }, function(err) {
      if (err == 'ENOENT')
        throw 'Error accessing configuration file %' + config.configFile + '%';

      if (!config.doCreate)
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
  })
  .then(checkMapConfig)
  .then(function() {
    config.loaded = true;
  })
}

// checks to see if the package.json map config
// is accurately reflected in the config file
// - if the config file has a property not in the package.json, we set it in the package.json
// - if the package.json has a property not in the config, we set it in the config
// - where there is a conflict, we specifically ask which value to use
function checkMapConfig() {
  var conflictPromises = [];

  if (config.map && hasProperties(config.map)) {

    var depMap;

    return Promise.resolve()
    .then(function() {
      if (!config.name)
        return ui.input('Enter project name to use contextual mappings', 'app')
        .then(function(name) {
          config.name = name;

          // if the lib directory is not in package.json, and we've given a name
          // then the new lib default is the name not 'lib'
          if (!pjsonCache.directories || !pjsonCache.directories.lib)
            config.lib = path.resolve(config.dir, config.name);
        });
    })
    .then(function() {
      depMap = config.depMap[config.name] = config.depMap[config.name] || {};
    })
    .then(function() {
      // check everything in package.json is reflected in config
      return Promise.all(Object.keys(config.map).map(function(d) {
        var curMap = config.map[d];

        // ensure package-relative maps are relative and not named
        if (curMap.substr(0, config.name.length) == config.name && curMap.substr(config.name.length, 1) == '/')
          curMap = config.map[d] = '.' + curMap.substr(config.name.length);

        // maps are package-relative
        if (curMap.substr(0, 2) == './')
          curMap = config.name + curMap.substr(1);

        if (depMap[d] && depMap[d].exactName !== curMap) {
          return ui.confirm('The config file has a mapping, `' + d + ' -> ' + depMap[d].exactName 
            + '`, while in the %package.json% this is mapped to `' + curMap + '`. Update the package.json?')
          .then(function(override) {
            if (override) {
              var mapVal = depMap[d].exactName;
              if (mapVal.substr(0, config.name) == config.name && mapVal.substr(config.name.length, 1) == '/')
                mapVal = '.' + mapVal.substr(config.name.length);
              config.map[d] = mapVal;
            }
            else {
              depMap[d] = new Package(curMap);
            }
          });
        }
        else if (!depMap[d]) {
          depMap[d] = new Package(curMap);
        }
      }))
    })
    .then(function() {
      // check everything in config is reflected in package.json
      return Promise.all(Object.keys(depMap).map(function(d) {
        // we've handled all package.json now
        if (config.map[d])
          return;

        config.map[d] = depMap[d].exactName;
      }));
    })
  }

  return Promise.resolve();
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

  // ensure the package map is at the top
  var name = config.name;
  if (config.depMap[name]) {
    curConfig.map[name] = curConfig.map[name] || {};
    var curDep = config.depMap[name];
    for (var dep in curDep) {
      // the node core libs are an exception
      if (dep == 'nodelibs')
        continue;
      curConfig.map[name][dep] = curDep[dep].exactName;
    }
  }

  for (var d in config.depMap) {
    if (d == config.name)
      continue;
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
    config.configFile = path.resolve(config.dir, 'config.js');
    return ui.confirm('Configuration file %' + config.configFile + '% not found, create it?', true).then(function(create) {
      if (!create)
        throw 'Operation cancelled';
      hasConfig = true;
    });
  })
  .then(function() {
    // ensure config folder exists
    return asp(mkdirp)(path.dirname(config.configFile));
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
    pjsonCache = pjson;
    if (pjson.registry) {
      config.prefix = false;
    }
    else if (!pjson.jspm && config.prefix === undefined) {
      return Promise.resolve(ui.confirm('Would you like jspm to prefix its package.json properties under %jspm%?', true))
      .then(function(prefix) {
        config.prefix = prefix;
        return pjson;
      });
    }
    return pjson;
  })
  .then(function(pjson) {
    var _pjson = pjson;
    config.prefix = config.prefix || pjson.jspm;

    if (config.prefix)
      pjson = pjson.jspm = pjson.jspm || {};

    if (config.name)
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
    if (config.baseDir) {
      directories.baseURL = path.relative(config.dir, config.baseDir);
      if (!directories.baseURL)
        delete directories.baseURL;
    }

    var base = directories.baseURL && (directories.baseURL + path.sep) || '';
    if (directories.jspmPackages == base + 'jspm_packages')
      delete directories.jspmPackages;

    if (directories.lib == base + config.name || 'lib')
      delete directories.lib;

    if (directories.dist == base + 'dist')
      delete directories.dist;

    if (hasProperties(directories))
      pjson.directories = directories;

    if (!hasProperties(pjson.directories))
      delete pjson.directories;

    if (config.configFile)
      pjson.configFile = path.relative(config.dir, config.configFile);

    if (pjson.configFile == base + 'config.js')
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
      else if (pkg.registryCache && (pkg.registryCache[d + '@' + dep.version] == dep.exactName || pkg.registryCache[d] == dep.name))
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

    var map = pjson.map;
    for (var d in config.map) {
      if (map[d] != config.map[d])
        map[d] = config.map[d];
    }

    if (hasProperties(map))
      pjson.map = map;

    if (!config.prefix)
      pjson.registry = config.globalConfig.registry;
    else if (pjson.registry == 'jspm')
      delete pjson.registry;
    delete pjson.dependencies;

    if (hasProperties(dependencies))
      pjson.dependencies = dependencies;

    delete pjson.buildConfig;
    if (config.buildConfig)
      pjson.buildConfig = config.buildConfig;

    // save package.json
    return asp(fs.writeFile)(path.resolve(config.dir, 'package.json'), JSON.stringify(_pjson, null, 2) + '\n');
  })
  .then(function() {
    savePromise = undefined;
  });
}



// global config - automatically created and loaded on startup
exports.endpoints = [];
var globalConfigFile = exports.HOME + path.sep + '.jspm' + path.sep + 'config';
function saveGlobalConfig() {
  try {
    fs.mkdirSync(exports.HOME + path.sep + '.jspm');
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
  if (exports.HOME)
    saveGlobalConfig();
}
exports.saveGlobalConfig = saveGlobalConfig;

/*
 * Populate default endpoint configuration
 */
prepend(exports.globalConfig, {
  registry: 'jspm',
  endpoints: {
    github: {
      handler: 'jspm-github',
      remote: 'https://github.jspm.io'
    },
    npm: {
      handler: 'jspm-npm',
      remote: 'https://npm.jspm.io'
    },
    jspm: {
      handler: 'jspm-registry',
      remote: 'https://registry.jspm.io'
    }
  }
});

// config upgrade paths
if (exports.globalConfig.github) {
  prepend(exports.globalConfig.endpoints.github, exports.globalConfig.github);
  delete exports.globalConfig.github;
}
saveGlobalConfig();

exports.set = function(name, val) {
  var nameParts = name.split('.');

  var config = exports.globalConfig;
  var part;
  while (nameParts.length > 1) {
    var part = nameParts.shift();
    config[part] = typeof config[part] == 'object' ? config[part] : {};
    config = config[part];
  }
  if (val) {
    config[nameParts[0]] = val;
  }
  else {
    // If no value is specified, then remove property from config
    delete config[nameParts[0]];
  }
  
  saveGlobalConfig();
}
