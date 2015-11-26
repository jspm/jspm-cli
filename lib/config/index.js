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
var asp = require('bluebird').Promise.promisify;
var readJSON = require('../common').readJSON;
var PackageName = require('../package-name');
var stringify = require('../common').stringify;
var inDir = require('../common').inDir;
var toFileURL = require('../common').toFileURL;
var absURLRegEx = require('../common').absURLRegEx;

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

  cfg.baseURL = toFileURL(config.pjson.baseURL);

  // set the package map for the package itself
  // NB complete this
  cfg.map = cfg.map || {};
  // cfg.map[pkgName] = local lib path

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
      if (typeof serializedDepMap[dep] == 'string')
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

  var libPath;
  var packagesPath;
  var configFolder;

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
  // jspm prefix
  .then(function() {
    if (promptType != 'custom')
      return;

    return ui.confirm('%Prefix package.json properties under jspm?%', !!pjson.jspmPrefix)
    .then(function(jspmPrefix) {
      // unprefixing existing flattens
      if (pjson.jspmPrefix && !jspmPrefix)
        return ui.confirm('%Flatten existing package.json jspm properties?%', true, {
          info: 'Are you sure you want to flatten the %jspm% package.json properties? Any duplicate package.json property names will be overwritten.'
        })
        .then(function(confirm) {
          if (confirm)
            pjson.setPrefix(false);
        });
      // prefixing existing applies to new properties only
      pjson.setPrefix(jspmPrefix);
    });
  })
  // Project name
  .then(function() {
    return ui.input('%package.json name (recommended, optional)%', pjson.name, {
      edit: true,
      clearOnType: true,
      info: 'Enter a name for the project.\n\nThis name will be used for importing local code.\neg via %System.import(\'' + pjson.name + '/module.js\')%.',
      validate: function(name) {
        if (name.indexOf(' ') != -1)
          return 'The package name should not contain any spaces.';
        if (name.match(/!|#/))
          return 'The package name should not contain characters ! or #.';
      }
    })
    .then(function(name) {
      pjson.name = name;
    });
  })
  // baseURL
  .then(function() {
    return ui.input('%package.json directories.baseURL' + (pjson.name ? ' (optional)%' : '%'), path.relative(base, pjson.baseURL), {
      info: 'Enter the file path to the public folder served to the browser.',
      validate: function(baseURL) {
        if (path.resolve(baseURL) != base && !inDir(path.resolve(baseURL), base))
          return 'The directories.baseURL path should be a subfolder within the project.';
      }
    })
    .then(function(baseURL) {
      pjson.baseURL = path.resolve(base, baseURL);
      // populate default paths given the new baseURL value
      pjson.populateDefaultPaths(true);
    });
  })
  // Local package path
  .then(function() {
    if (!pjson.name)
      return;

    return ui.input('%package.json directories.lib%', path.relative(base, pjson.lib) || '.', {
      info: 'Enter the path to the folder containing the local project code.\n\nThis folder forms the SystemJS package for the project.',
      validate: function(lib) {
        if (!inDir(path.resolve(base, lib), pjson.baseURL))
          return 'The directories.lib path should be a subfolder within ' + (pjson.baseURL == base ? 'the project.' : 'the baseURL.');
      }
    })
    .then(function(lib) {
      pjson.lib = path.resolve(base, lib);
      libPath = path.relative(base, pjson.lib);
      return mkdirp(pjson.lib);
    });
  })
  // jspm_packages folder path
  .then(function() {
    return ui.input('%package.json directories.packages%', path.relative(base, pjson.packages), {
      info: 'Enter the path to the jspm packages folder.\n\nOnly necessary if you would like to customize this folder name or location.',
      validate: function(packages) {
        if (!inDir(path.resolve(base, packages), pjson.baseURL))
          return 'The directories.packages path should be a subfolder within ' + (pjson.baseURL == base ? 'the project.' : 'the baseURL.');
      }
    })
    .then(function(packages) {
      pjson.packages = path.resolve(base, packages);
      packagesPath = path.relative(base, pjson.packages);
    });
  })
  // jspm config folder
  .then(function() {
    if (promptType == 'custom')
      return;

    // to make the prompts simple, we assume the config files are called jspm.js and
    // jspm.browser.js the question here is then just what folder they are located in
    if (path.dirname(pjson.configFile) == path.dirname(pjson.configFileBrowser) &&
        path.basename(pjson.configFile) == 'jspm.js' && 
        path.basename(pjson.configFileBrowser) == 'jspm.browser.js')
      configFolder = path.relative(base, path.dirname(pjson.configFile)) || '.';
    else
      return;

    return ui.input('%package.json configFiles folder%', configFolder, {
      info: 'Enter the path to the folder to contain the SystemJS config files for jspm.',
      validate: function(configFolder) {
        if (path.relative(base, path.resolve(base, configFolder))[0] == '.')
          return 'The config file path should be a subfolder within the project.';
      }
    })
    .then(function(configFolder) {
      pjson.configFile = path.resolve(base, configFolder, 'jspm.js');
      pjson.configFileBrowser = path.resolve(base, configFolder, 'jspm.browser.js');
    });
  })
  // (custom) jspm config file path
  .then(function() {
    if (promptType != 'custom')
      return;

    return ui.input('%package.json configFiles.jspm%', path.relative(base, pjson.configFile), {
      info: 'Enter a custom config file path.\n\nOnly necessary if you would like to customize the config file name or location.',
      validate: function(configFile) {
        if (!inDir(path.resolve(base, configFile), base))
          return 'The config file path should be a subfolder within the project.';
      }
    })
    .then(function(configFile) {
      pjson.configFile = path.resolve(base, configFile);
    });
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
  // baseURL in browser
  .then(function() {
    return ui.input('%System.config browser baseURL' + (pjson.name ? ' (optional)%' : '%'), loaderBrowser.baseURL || (pjson.jspmAware && pjson.name ? '' : '/'), {
      edit: !!pjson.name,
      info: 'Enter the browser baseURL.\n\nThis is the absolute URL of the directories.baseURL public folder in the browser.'
    })
    .then(function(baseURL) {
      // when removing baseURL, alter lib and packages URLs to be absolute if not already
      if (!baseURL && loaderBrowser.baseURL) {
        if (loaderBrowser.libURL && !loaderBrowser.libURL.match(absURLRegEx) && loaderBrowser.libURL[0] != '.')
          loaderBrowser.libURL = loaderBrowser.baseURL + loaderBrowser.libURL;
        if (loaderBrowser.packagesURL && !loaderBrowser.packagesURL.match(absURLRegEx) && loaderBrowser.packagesURL[0] != '.')
          loaderBrowser.packagesURL = loaderBrowser.baseURL + loaderBrowser.packagesURL;
      }
      loaderBrowser.baseURL = baseURL;
    });
  })
  // URL to local package in browser
  .then(function() {
    if (!pjson.name)
      return;

    return ui.input('%System.config browser URL to ' + libPath + ' %', loaderBrowser.libURL || (loaderBrowser.baseURL ? '' : '/') + path.relative(pjson.baseURL, pjson.lib), {
      info: 'Enter the browser URL for the folder containing the local project code.\n\nThis should be the served directories.lib folder.',
      validate: function(libURL) {
        if (libURL[0] == '.')
          return 'The local package URL should not be a relative URL.';
      }
    })
    .then(function(libURL) {
      loaderBrowser.libURL = libURL;
    });
  })
  // URL to jspm_packages in browser
  .then(function() {
    return ui.input('%System.config browser URL to ' + packagesPath + '%', loaderBrowser.packagesURL || (loaderBrowser.baseURL ? '' : '/') + path.relative(base, pjson.packages), {
      info: 'Enter the browser URL for the jspm_packages folder.',
      validate: function(packagesURL) {
        if (packagesURL[0] == '.')
          return 'The jspm_packages URL should not be a relative URL.';
      }
    })
    .then(function(packagesURL) {
      loaderBrowser.packagesURL = packagesURL;
    });
  })
  // (custom) main entry point
  .then(function() {
    if (promptType != 'custom')
      return;

    return ui.input('%System.config local package main%', pjson.main || (pjson.name || 'app' + '.js'), {
      info: 'Enter the main entry point of your package within the %' + libPath + '% folder.'
    })
    .then(function(main) {
      loader.package.main = main;
    });
  })
  // (custom) format
  .then(function() {
    if (promptType != 'custom')
      return;

    return ui.input('%System.config local package format (esm, cjs, amd)%', loader.package.format || 'esm', {
      info: 'Enter the module format of your local project code (within `' + libPath + '`).\n\nThe default option is esm (ECMAScript Module).',
      options: ['esm', 'cjs', 'amd', 'global', 'system', 'systemjs', 'register']
    })
    .then(function(format) {
      format = format.toLowerCase();
      if (format == 'system' || format == 'systemjs')
        format = 'register';
      loader.package.format = format;
    });
  })
  // transpiler
  .then(function() {
    var transpilers = ['babel', 'typescript', 'traceur', 'none'];

    var curTranspiler = loader.package.meta && 
        (loader.package.meta['*.js'] && loader.package.meta['*.js'].loader) ||
        (loader.package.meta['*.ts'] && loader.package.meta['*.ts'].loader == 'typescript' && 'typescript');
    
    if (transpilers.indexOf(curTranspiler) == -1)
      curTranspiler = null;

    return ui.input('%Which transpiler would you like to use (Babel, TypeScript, Traceur, None)%', curTranspiler || 'none', {
      options: transpilers
    })
    .then(function(transpiler) {
      transpiler = transpiler.toLowerCase();

      // do transpiler install process
      loader.package.meta = loader.package.meta || {};

      var transpilerMeta;

      if (transpiler == 'typescript')
        transpilerMeta = loader.package.meta['*.ts'] = loader.package.meta['*.ts'] || {};
      else
        transpilerMeta = loader.package.meta['*.js'] = loader.package.meta['*.js'] || {};

      transpilerMeta.loader = transpiler;
      // var babelOptions = jsMeta.babelOptions = jsMeta.babelOptions || {};
      // add default system optimize transformer
    });
  })
  // additional plugins -> templates, css, etc
  .then(function() {

  });
}