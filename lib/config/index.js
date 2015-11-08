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
var ui = require('../ui');
var fs = require('graceful-fs');
var path = require('path');
var PackageConfig = require('./package');
var LoaderConfig = require('./loader');
var mkdirp = require('mkdirp');
var asp = require('rsvp').denodeify;
var readJSON = require('../common').readJSON;
var PackageName = require('../package-name');
var stringify = require('../common').stringify;

var config = module.exports;

exports.version = require('../../package.json').version;

// package and loader configuration objects that are created
exports.pjson = null;
exports.loader = null;

var loadPromise;
exports.loaded = false;
exports.load = function(prompts, promptType) {
  if (config.loaded)
    return Promise.resolve();

  if (loadPromise)
    return loadPromise;

  return (loadPromise = Promise.resolve()
  .then(function() {

    if (process.env.globalJspm === 'true')
      ui.log('warn', 'Running jspm globally, it is advisable to locally install jspm via %npm install jspm --save-dev%.');

    if (!process.env.jspmConfigPath)
      return ui.confirm('Package.json file does not exist, create it?', true)
      .then(function(create) {
        if (!create)
          throw 'Operation aborted.';
      });
  })
  .then(function() {
    config.pjsonPath = process.env.jspmConfigPath || path.resolve(process.cwd(), 'package.json');

    config.pjson = new PackageConfig(config.pjsonPath);

    if (fs.existsSync(config.pjson.configFiles.jspm))
      return;

    return ui.confirm('Configuration file %' + path.relative(process.cwd(), config.pjson.configFiles.jspm) + '% doesn\'t exist, create it?', true)
    .then(function(create) {
      if (!create)
        throw 'Operation aborted.';

      // ensure config folder exists
      return asp(mkdirp)(path.dirname(config.pjson.configFiles.jspm));
    });
  })
  .then(function() {
    config.loader = new LoaderConfig(config.pjson.configFiles.jspm);
    return readJSON(path.resolve(config.pjson.packages, '.dependencies.json'));
  })
  .then(function(depsJSON) {
    config.deps = setSerializedDeps(depsJSON);

    if (!config.pjson.jspmAware || prompts)
      return Promise.resolve()
      .then(function() {
        if (!promptType)
          return ui.input('%Init Mode (Standard, Quick, Custom)%', 'Standard', {
            info: 'Select an init mode for jspm project configuration.' +
              '\n\nSkip this message in future with %jspm init --<mode>% or %jspm init -<m>%.',
            options: ['Standard', 'Quick', 'Custom']
          })
          .then(function(_promptType) {
            promptType = _promptType.toLowerCase();
          });
      })
      .then(function() {
        return config.pjson.prompt(promptType);
      })
      .then(function() {
        return config.loader.prompt(promptType);
      });
  })
  .then(function() {
    if (!config.loader.upgrade16 || !config.pjson.jspmAware)
      return;
    
    // NB complete testing here
    ui.log('warn', 'This is an alpha release of jspm 0.17, which is not yet fully stable. Make sure you have a backup of your project.');
    return ui.confirm('jspm will now upgrade your project to the 0.17 configuration.\nAre you sure you want to proceed?', true)
    .then(function(doUpgrade) {
      if (!doUpgrade)
        return Promise.reject('jspm 0.17-alpha upgrade cancelled.');

      ui.log('info', 'Checking all overrides into the package.json file to ensure reproducibility independent of the jspm registry...');

      // for each installed package, retreive its override and add it to the package.json file
      // extending the override in the package.json file itself
      var oldOverrides = config.pjson.overrides;
      config.pjson.overrides = {};
      var endpoint = require('./registry').load(require('./global-config').config.defaultRegistry);
      var semver = require('./semver');
      var upgradePackageConfig = require('./package').upgradePackageConfig;
      return Promise.all(Object.keys(config.loader.baseMap).map(function(dep) {
        var pkg = config.loader.baseMap[dep];

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

        var manualOverride = overrideVersion && oldOverrides[pkg.name + '@' + overrideVersion] || {};

        // use registry override + previous package.json manual override
        return endpoint.getOverride(pkg.registry, pkg.package, pkg.version, manualOverride)
        .then(function(override) {
          override = override || {};

          // this is an upgrade by reference
          upgradePackageConfig(override.systemjs || override);

          // persist the override for reproducibility
          config.pjson.overrides[pkg.exactName] = override;
        });
      }))
      .then(function() {
        config.loaded = true;
        ui.log('info', 'Upgrading all installed packages...');
        return require('./install').install(true, {});
      })
      .then(function() {
        // ui.log('info', 'Running project configuration...');
        // return require('./core').init(null, true);
      })
      .then(function() {
        ui.log('ok', 'jspm 0.17-alpha upgrade complete.\nPlease report any issues, questions or feedback to help improve this release.\nThanks for testing it out!\n');
      });
    });
  }))
  .then(function() {
    config.loaded = true;
  });
};

exports.loadSync = function() {
  if (config.loaded)
    return;

  if (loadPromise)
    throw 'Configuration file is already loading.';
  
  config.pjsonPath = process.env.jspmConfigPath || path.resolve(process.cwd(), 'package.json');
  
  config.pjson = new PackageConfig(config.pjsonPath);

  if (!config.pjson.jspmAware)
    throw 'Package.json file has not been initialized by jspm before. Run jspm init first.';

  if (!fs.existsSync(config.pjson.configFiles.jspm))
    throw 'No project configuration file not found looking for `' + config.pjson.configFiles.jspm + '`.';

  config.loader = new LoaderConfig(config.pjson.configFiles.jspm);

  var depsJSON;
  try {
    depsJSON = JSON.parse(fs.readFileSync(path.resolve(config.pjson.packages, '.dependencies.json')));
  }
  catch(e) {
    if (e.code == 'ENOENT')
      depsJSON = {};
    else
      throw e;
  }

  config.deps = setSerializedDeps(depsJSON);

  config.loaded = true;
  loadPromise = Promise.resolve();
};

function getSerializedDeps(deps) {
  var serializedDeps = {};
  Object.keys(deps).forEach(function(dep) {
    var depMap = deps[dep];
    var serializedDepMap = serializedDeps[dep] = {};
    Object.keys(depMap).forEach(function(dep) {
      serializedDepMap[dep] = depMap[dep].exactName;
    });
  });
  return serializedDeps;
}
function setSerializedDeps(serializedDeps) {
  var deps = {};
  Object.keys(serializedDeps).forEach(function(dep) {
    var depMap = deps[dep] = {};
    var serializedDepMap = serializedDeps[dep];
    Object.keys(serializedDepMap).forEach(function(dep) {
      depMap[dep] = new PackageName(serializedDepMap[dep]);
    });
  });
  return deps;
}

exports.save = function() {
  config.loader.write();
  config.pjson.write();
  mkdirp.sync(config.pjson.packages);
  fs.writeFileSync(path.resolve(config.pjson.packages, '.dependencies.json'), stringify(getSerializedDeps(config.deps)));
};

// checks to see if the package.json map config
// is accurately reflected in the config file
// - if the config file has a property not in the package.json, we set it in the package.json
// - if the package.json has a property not in the config, we set it in the config
// - where there is a conflict, we specifically ask which value to use
/*
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
        if (curMap.startsWith(config.name) && curMap.endsWith('/'))
          curMap = config.map[d] = '.' + curMap.substr(config.name.length);

        // maps are package-relative
        if (curMap.startsWith('./'))
          curMap = config.name + curMap.substr(1);

        if (depMap[d] && depMap[d].exactName !== curMap) {
          return ui.confirm('The config file has a mapping, `' + d + ' -> ' + depMap[d].exactName
            + '`, while in the %package.json% this is mapped to `' + curMap + '`. Update the package.json?')
          .then(function(override) {
            if (override) {
              var mapVal = depMap[d].exactName;
              if (mapVal.startsWith(config.name) && mapVal.endsWith('/'))
                mapVal = '.' + mapVal.substr(config.name.length);
              config.map[d] = mapVal;
            }
            else {
              depMap[d] = new PackageName(curMap);
            }
          });
        }
        else if (!depMap[d]) {
          depMap[d] = new PackageName(curMap);
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
    });
  }

  return Promise.resolve();
}
*/
