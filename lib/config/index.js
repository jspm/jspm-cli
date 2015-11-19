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
var JspmSystemConfig = require('./loader').JspmSystemConfig;
var JspmBrowserConfig = require('./loader').JspmBrowserConfig;
var mkdirp = require('mkdirp');
var asp = require('rsvp').denodeify;
var readJSON = require('../common').readJSON;
var PackageName = require('../package-name');
var stringify = require('../common').stringify;
var absURLRegEx = require('../common').absURLRegEx;
var inDir = require('../common').inDir;
var toFileURL = require('../common').toFileURL;

var config = module.exports;

exports.version = require('../../package.json').version;

// package and loader configuration objects that are created
exports.pjson = null;
exports.loader = null;

exports.getLoaderConfig = function() {
  var cfg = config.loader.getConfig();

  cfg.paths = cfg.paths || {};
  (cfg.packageConfigPaths || []).forEach(function(pkgConfigPath) {
    var registryName = pkgConfigPath.substr(0, pkgConfigPath.indexOf(':'));
    if (registryName && !cfg.paths[registryName + ':*'])
      cfg.paths[registryName + ':*'] = toFileURL(config.pjson.packages) + '/' + registryName + '/*';
  });

  // no depCache or bundles
  delete cfg.depCache;
  delete cfg.bundles;

  return cfg;
};

var loadPromise;
exports.loaded = false;
exports.load = function(prompts) {
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

    // ensure config file folders exist
    Promise.all([
      asp(mkdirp)(path.dirname(config.pjson.configFile)),
      asp(mkdirp)(path.dirname(config.pjson.configFileBrowser))
    ]);
  })
  .then(function() {
    config.loader = new JspmSystemConfig(config.pjson.configFile);
    config.loaderBrowser = new JspmBrowserConfig(config.pjson.configFileBrowser);
  })
  .then(function() {
    return readJSON(path.resolve(config.pjson.packages, '.dependencies.json'));
  })
  .then(function(depsJSON) {
    config.deps = setSerializedDeps(depsJSON);

    if (!config.pjson.jspmAware || prompts)
      return initPrompts();
  })
  .then(function() {
    if (!config.loader.upgrade16 || !config.pjson.jspmAware)
      return;
    
    // NB complete testing here
    return ui.confirm('jspm will now attempt to upgrade your project to the 0.17 configuration.\nAre you sure you want to proceed?', true, {
      info: 'This is an alpha release of jspm 0.17, which is not yet fully stable. Make sure you have a backup of your project.'
    })
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

  if (!fs.existsSync(config.pjson.configFile))
    throw 'No project configuration file not found looking for `' + config.pjson.configFile + '`.';

  config.loader = new JspmSystemConfig(config.pjson.configFile);
  config.loaderBrowser = new JspmBrowserConfig(config.pjson.configFileBrowser);

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
  config.loaderBrowser.write();
  config.pjson.write();
  mkdirp.sync(config.pjson.packages);
  fs.writeFileSync(path.resolve(config.pjson.packages, '.dependencies.json'), stringify(getSerializedDeps(config.deps)));
};

/*
 * Project creation prompts
 */
function initPrompts() {
  var pjson = config.pjson;
  var loader = config.loader;
  var loaderBrowser = config.loaderBrowser;

  var base = path.dirname(config.pjsonPath);

  var configPath;
  var configPathBrowser;
  var libPath;

  var promptType;

  return Promise.resolve()
  // Init mode
  .then(function() {
    return ui.input('%Init Mode (Standard, Custom)%', 'Standard', {
      info: 'Select an init mode for jspm project configuration.',
      options: ['Standard', 'Custom']
    })
    .then(function(_promptType) {
      promptType = _promptType.toLowerCase();
    });
  })
  // Project name
  .then(function() {
    return ui.input('%package.json name (recommended, optional)%', pjson.name, {
      info: 'Enter a name for the project.\n\nThis name will be used for importing local code. If unset, then a baseURL must be configured.'
    })
    .then(function(name) {
      pjson.name = name;
    });
  })
  // Local package path
  .then(function() {
    if (!pjson.name)
      return;

    return ui.input('%package.json directories.lib%', path.relative(base, pjson.lib) || '.', {
      info: 'Enter the path to the folder containing your local project code.\n\nThis folder forms the SystemJS package for the project.',
      validate: function(lib) {
        if (!inDir(path.resolve(lib), base))
          return 'The directories.lib path should be a subfolder within the project.';
      }
    })
    .then(function(lib) {
      pjson.lib = path.resolve(base, lib);
      libPath = path.relative(base, pjson.lib);
    });
  })
  // baseURL
  .then(function() {
    if (pjson.name && promptType != 'custom')
      return;

    return ui.input('%package.json directories.baseURL%', path.relative(base, pjson.baseURL) || '.', {
      info: 'Enter the path to the baseURL public folder served to the browser.',
      validate: function(baseURL) {
        if (path.resolve(baseURL) != base && !inDir(path.resolve(baseURL), base))
          return 'The directories.baseURL path should be a subfolder within the project.';
      }
    })
    .then(function(baseURL) {
      pjson.baseURL = baseURL;
      // populate default paths given the new baseURL value
      pjson.populateDefaultPaths();
    });
  })
  // (custom) jspm_packages folder path
  .then(function() {
    if (promptType != 'custom')
      return;

    return ui.input('%package.json directories.packages%', path.relative(base, pjson.packages), {
      info: 'Enter the path to the jspm packages folder.\n\nOnly necessary if you would like to customize this folder name or location.',
      validate: function(packages) {
        if (!inDir(path.resolve(packages), base))
          return 'The directories.packages path should be a subfolder within the project.';
      }
    })
    .then(function(packages) {
      pjson.packages = path.resolve(base, packages);
    });
  })
  // (custom) jspm config file path
  .then(function() {
    if (promptType != 'custom')
      return;

    return ui.input('%package.json configFiles.jspm%', path.relative(base, pjson.configFile), {
      info: 'Enter a custom config file path.\n\nOnly necessary if you would like to customize the config file name or location.'
    })
    .then(function(configFile) {
      pjson.configFile = path.resolve(base, configFile);
    });
  })
  .then(function() {
    configPath = path.relative(base, pjson.configFile);
  })
  // (custom) jspm browser config file path
  .then(function() {
    if (promptType != 'custom')
      return;

    return ui.input('%package.json configFiles.jspm:browser%', path.relative(base, pjson.configFileBrowser), {
      info: 'Enter a custom browser config file path.\n\nThis is also a SystemJS config file, but for browser-only jspm configurations.'
    })
    .then(function(configFile) {
      pjson.configFileBrowser = path.resolve(base, configFile);
    });
  })
  .then(function() {
    configPathBrowser = path.relative(base, pjson.configFileBrowser);
  })
  // URL to local package in browser
  .then(function() {
    if (!pjson.name)
      return;

    return ui.input('%' + configPathBrowser + ' URL to ' + libPath + ' %', '/' + libPath, {
      info: 'Enter the URL to the folder containing your local project code.\n\nThis should be the served directories.lib folder.',
      validate: function(libURL) {
        if (!libURL.match(absURLRegEx))
          return 'The local package URL must be an absolute URL for the browser.';
      }
    })
    .then(function(libURL) {
      loaderBrowser.setPackageURL(libURL);
    });
  })
  // baseURL in browser
  .then(function() {
    if (pjson.name && promptType != 'custom')
      return;

    return ui.input('%' + configPathBrowser + ' baseURL%', loaderBrowser.baseURL || loader.baseURL || '/', {
      edit: true,
      info: 'Enter the baseURL in the browser.\n\nThis is the absolute URL of the directories.baseURL public folder in the browser.',
      validate: function(baseURL) {
        if (baseURL == '' && !pjson.name)
          return 'When not using a local package name, a baseURL value must be provided.';
      }
    })
    .then(function(baseURL) {
      loaderBrowser.setBaseURL(baseURL);
    });
  })
  // (custom) URL to jspm_packages in browser
  .then(function() {
    if (promptType != 'custom')
      return;

    return ui.input('%' + configPathBrowser + ' jspm_packages URL%', '/' + path.relative(base, pjson.packages), {
      info: 'Enter the browser URL to the jspm_packages folder.',
      validate: function(packagesURL) {
        if (!packagesURL.match(absURLRegEx))
          return 'jspm_packages URL must be an absolute URL.';
      }
    })
    .then(function(packagesURL) {
      loaderBrowser.setPackagesURL(packagesURL);
    });
  })
  // (custom) main entry point
  .then(function() {
    if (promptType != 'custom')
      return;

    return ui.input('%' + configPath + ' package main%', pjson.main || (pjson.name || 'app' + '.js'), {
      info: 'Enter the main entry point of your package within the %' + libPath + '% folder.'
    })
    .then(function(main) {
      loader.package.main = main;
    });
  })
  // (custom) format
  /* .then(function() {
    if (promptType != 'custom')
      return;

    return ui.input('%' + configPath + ' package format (esm, cjs, amd)%', pjson.format || 'esm', {
      info: 'Enter the module format of your local project code (within `' + libPath + '`).\n\nThe default option is esm (ECMAScript Module).',
      options: ['esm', 'cjs', 'amd', 'global', 'system', 'systemjs', 'register']
    })
    .then(function(format) {
      format = format.toLowerCase();
      if (format == 'system' || format == 'systemjs')
        format = 'register';
      loader.package.format = format;
    });
  }) */
  // transpiler
  .then(function() {
    var transpilers = ['babel', 'typescript', 'traceur', 'none'];

    var curTranspiler = loader.package.meta && loader.package.meta['*.js'] && loader.package.meta['*.js'].loader;
    curTranspiler = curTranspiler && curTranspiler.toLowerCase();
    if (transpilers.indexOf(curTranspiler) == -1)
      curTranspiler = null;

    return ui.input('%Which transpiler would you like to use (Babel, TypeScript, Traceur, None)%', curTranspiler || 'none', {
      options: transpilers
    })
    .then(function(transpiler) {
      transpiler = transpiler.toLowerCase();

      // do transpiler install process
      loader.package.meta = loader.package.meta || {};
      loader.package.meta['*.js'] = loader.package.meta['*.js'] || {};
      // var jsMeta = loader.package.meta['*.js'].loader = transpiler;

      // var babelOptions = jsMeta.babelOptions = jsMeta.babelOptions || {};
      // add default system optimize transformer, 
    });
  });
}