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
exports.HOME = process.env.LOCALAPPDATA || process.env.HOME || process.env.HOMEPATH;

var ui = require('./ui');
var fs = require('graceful-fs');
var path = require('path');
var PackageConfig = require('./config/package');
var LoaderConfig = require('./config/loader');
var mkdirp = require('mkdirp');
var extend = require('./common').extend;
var config = module.exports;
var asp = require('rsvp').denodeify;
var EOL = require('os').EOL;

// default newline to the appropriate value for the system
config.newLine = EOL;

// given a package.json file and an override
// calculate the package.json file jspm will see
exports.derivePackageConfig = function(pjson, override) {
  var dpjson = extend({}, pjson);

  // first derive the override
  if (override || pjson.jspm)
    dpjson.jspm = extend({}, pjson.jspm || {});

  if (override)
    extend(dpjson.jspm, override);

  // then apply the override
  if (override || pjson.jspm)
    extend(dpjson, dpjson.jspm);

  return dpjson;
};

// package and loader configuration objects that are created
exports.pjson = null;
exports.loader = null;

var loadPromise;
exports.loaded = false;
exports.load = function(prompts) {
  if (loadPromise)
    return loadPromise;

  return (loadPromise = Promise.resolve()
  .then(function() {
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
    return config.pjson.read(prompts);
  })
  .then(function(_prompts) {
    // package.json can indicate if we need to run config prompts for a new package
    prompts = prompts || _prompts;

    if (fs.existsSync(config.pjson.configFile))
      return;

    return ui.confirm('Configuration file %' + path.relative(process.cwd(), config.pjson.configFile) + '% doesn\'t exist, create it?', true)
    .then(function(create) {
      if (!create)
        throw 'Operation aborted.';

      // ensure config folder exists
      return asp(mkdirp)(path.dirname(config.pjson.configFile));
    });
  })
  .then(function() {
    config.loader = new LoaderConfig(config.pjson.configFile);
    return config.loader.read(prompts);
  })
  .then(function() {
    config.loaded = true;
  }));
};

exports.loadSync = function() {
  if (config.loaded)
    return;
  if (loadPromise)
    throw 'Configuration file is already loading.';
  if (!process.env.jspmConfigPath)
    throw 'No project package.json file not found.';
  config.pjsonPath = process.env.jspmConfigPath || path.resolve(process.cwd(), 'package.json');
  config.pjson = new PackageConfig(config.pjsonPath);
  config.pjson.read(false, true);

  if (!fs.existsSync(config.pjson.configFile))
    throw 'No project configuration file not found.';

  config.loader = new LoaderConfig(config.pjson.configFile);
  config.loader.read(false, true);
  config.loaded = true;
  loadPromise = Promise.resolve();
};

var savePromise;
exports.save = function() {
  if (savePromise)
    return savePromise.then(exports.save);

  return Promise.resolve()
  .then(function() {
    return config.loader.write();
  })
  .then(function() {
    return config.pjson.write();
  })
  .then(function() {
    savePromise = undefined;
  });
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
