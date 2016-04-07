/*
 *   Copyright 2014-2016 Guy Bedford (http://guybedford.com)
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
var readJSON = require('../common').readJSON;
var PackageName = require('../package-name');
var stringify = require('../common').stringify;
var inDir = require('../common').inDir;
var toFileURL = require('../common').toFileURL;
var absURLRegEx = require('../common').absURLRegEx;
var install = require('../install');
var wordWrap = require('../ui').wordWrap;

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
      cfg.paths[registryName + ':*'] = toFileURL(config.pjson.packages + '/' + registryName + '/*');
  });

  cfg.baseURL = toFileURL(config.pjson.baseURL);

  // set the package map for the package itself
  cfg.map = cfg.map || {};

  if (config.loader.package)
    cfg.paths[config.pjson.name + '/'] = cfg.paths[config.pjson.name + '/'] || toFileURL(config.pjson.lib + '/');

  // no depCache or bundles
  delete cfg.depCache;
  // delete cfg.bundles;

  return cfg;
};

var loadPromise;
exports.loaded = false;
exports.allowNoConfig = false;
exports.load = function(prompts, allowNoConfig) {
  if (config.loaded)
    return Promise.resolve();

  if (loadPromise)
    return loadPromise;

  return (loadPromise = Promise.resolve()
  .then(function() {
    config.allowNoConfig = !!allowNoConfig;

    if (process.env.globalJspm === 'true')
      ui.log('warn', 'Running jspm globally, it is advisable to locally install jspm via %npm install jspm --save-dev%.');

    if (!process.env.jspmConfigPath && !allowNoConfig)
      return ui.confirm('Package.json file does not exist, create it?', true)
      .then(function(create) {
        if (!create)
          throw 'Operation aborted.';
      });
  })
  .then(function() {
    config.pjsonPath = process.env.jspmConfigPath || path.resolve(process.cwd(), 'package.json');

    config.pjson = new PackageConfig(config.pjsonPath);
    config.loader = new JspmSystemConfig(config.pjson.configFile);

    // beta upgrade of jspm.js -> jspm.config.js
    if (config.loader.emptyConfig) {
      var jspmConfig = new JspmSystemConfig(path.resolve(config.pjson.baseURL, 'jspm.js'));
      if (!jspmConfig.emptyConfig) {
        config.loader = jspmConfig;
        config.loader.file.rename(config.pjson.configFile);
      }
    }

    // load jspm 0.16 default config path for upgrade
    if (config.loader.emptyConfig) {
      var upgradeConfig = new JspmSystemConfig(path.resolve(config.pjson.baseURL, 'config.js'));
      if (upgradeConfig.upgrade16 && !upgradeConfig.emptyConfig)
        config.loader = upgradeConfig;
      else
        config.loader.upgrade16 = false;
    }

    if (allowNoConfig && !config.pjson.jspmAware && !config.loader.upgrade16)
      config.loader.transpiler = 'none';

    config.loaderBrowser = new JspmBrowserConfig(config.pjson.configFileBrowser);
  })
  .then(function() {
    return readJSON(path.resolve(config.pjson.packages, '.dependencies.json'));
  })
  .then(function(depsJSON) {
    config.deps = setSerializedDeps(depsJSON);

    if (!config.pjson.jspmAware && !allowNoConfig || prompts)
      return initPrompts();
  })
  .then(function(initInstalls) {
    if (!config.loader.upgrade16 || !config.pjson.jspmAware)
      return initInstalls;

    if (allowNoConfig)
      throw new Error('The current project needs to be upgraded to jspm 0.17 before any further operations can run. Run %jspm init% to start the upgrade.');
    
    // NB complete testing here
    return ui.confirm('jspm will now attempt to upgrade your project to the 0.17 configuration.\nAre you sure you want to proceed?', true, {
      info: 'This is an beta release of jspm 0.17, which is not yet fully stable. Make sure you have a backup of your project.'
    })
    .then(function(doUpgrade) {
      if (!doUpgrade)
        return Promise.reject('jspm 0.17-beta upgrade cancelled.');

      config.loader.file.rename(config.pjson.configFile);

      // copy browser configurations from config.loader to config.loaderBrowser
      var baseURL = config.loader.file.getValue(['baseURL'], 'string');
      if (baseURL) {
        config.loader.file.remove(['baseURL']);
        config.loaderBrowser.file.setValue(['baseURL'], baseURL);
      }
      var paths = config.loader.file.getObject(['paths']);
      if (paths) {
        config.loader.file.remove(['paths']);
        config.loaderBrowser.file.setObject(['paths'], paths);
      }

      ui.log('info', '');

      ui.log('info', 'Upgrading jspm 0.16 Node core libraries to jspm 0.17 universal implementations...\n');

      Object.keys(config.loader.baseMap).forEach(function(key) {
        var target = config.loader.baseMap[key];

        if (target.name.substr(0, 21) == 'github:jspm/nodelibs-')
          target.setVersion('0.2.0-alpha');
      });

      Object.keys(config.loader.depMap).forEach(function(key) {
        var curMap = config.loader.depMap[key];

        Object.keys(curMap).forEach(function(key) {
          var target = curMap[key];

          if (target.name.substr(0, 21) == 'github:jspm/nodelibs-') {
            if (key == target.name.substr(21))
              delete curMap[key];
            else
              target.setVersion('0.2.0-alpha');
          }
        });
      });

      Object.keys(config.pjson.dependencies).forEach(function(key) {
        var target = config.pjson.dependencies[key];

        if (target.name.substr(0, 21) == 'github:jspm/nodelibs-') {
          target.setVersion('^0.2.0-alpha');

          config.pjson.peerDependencies[key] = target;
          delete config.pjson.dependencies[key];
        }
      });

      Object.keys(config.pjson.devDependencies).forEach(function(key) {
        var target = config.pjson.devDependencies[key];

        if (target.name.substr(0, 21) == 'github:jspm/nodelibs-') {
          target.setVersion('^0.2.0-alpha');

          config.pjson.peerDependencies[key] = target;
          delete config.pjson.devDependencies[key];
        }
      });

      ui.log('info', 'Checking all overrides into the package.json file to ensure reproducibility independent of the jspm registry...\n');

      var allInstalledPackages = [];

      Object.keys(config.loader.baseMap).forEach(function(key) {
        var dep = config.loader.baseMap[key];
        if (allInstalledPackages.indexOf(dep.exactName) == -1)
          allInstalledPackages.push(dep.exactName);
      });
      Object.keys(config.loader.depMap).forEach(function(key) {
        var curMap = config.loader.depMap[key];
        Object.keys(curMap).forEach(function(key) {
          var dep = curMap[key];
          if (allInstalledPackages.indexOf(dep.exactName) == -1)
            allInstalledPackages.push(dep.exactName);
        });
      });

      // for each installed package, retreive its override and add it to the package.json file
      // extending the override in the package.json file itself
      var endpoint = require('../registry').load(require('./global-config').config.defaultRegistry);
      var semver = require('../semver');
      var upgradePackageConfig = require('../package').upgradePackageConfig;
      return Promise.all(allInstalledPackages.map(function(dep) {
        var pkg = new PackageName(dep);

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

        var manualOverride = overrideVersion && config.pjson.overrides[pkg.name + '@' + overrideVersion] || {};

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
        ui.log('info', 'Re-downloading all installed packages...\n');
        return require('../install').install(true);
      })
      .then(function() {
        // uninstall babel transpiler 
        if (config.loader.transpiler == 'babel') {
          ui.log('info', 'Uninstalling jspm 0.16 Babel transpiler...\n');
          return require('../install').uninstall('babel');
        }
      })
      .then(function() {
        ui.log('info', 'Running jspm 0.17 project configuration prompts...\n');
        return initPrompts();
      })
      .then(function() {
        // always force transpiler download after init
        if (config.loader.transpiler == 'none')
          return;
        if (config.loader.transpiler.substr(0, 7) != 'plugin-')
          config.loader.transpiler = 'plugin-' + config.loader.transpiler;
        var installObj = {};
        installObj[config.loader.transpiler] = 'jspm:' + config.loader.transpiler;
        return require('../install').install(installObj, { dev: true });
      })
      .then(function() {
        return require('../core').checkDlLoader();
      })
      .then(function() {
        ui.log('ok', 'jspm 0.17-beta upgrade complete.\n\n' +
          'Some important breaking changes to note:\n\n' +
          wordWrap('• The %config.js% file has been renamed to %jspm.config.js% unless you were already using a custom config path for this.\n', process.stdout.columns - 4, 2, 0, true) + '\n' + 
          wordWrap('• There is now a new config file, %jspm.browser.js%, which must be included _before_ %jspm.config.js% in the browser.\n', process.stdout.columns - 4, 2, 0, true) + '\n' + 
          wordWrap('• js extensions are required for module imports not inside packages. Eg %System.import(\'./test\')% will need to become %System.import(\'./test.js\')%.', process.stdout.columns - 4, 2, 0, true) + '\n' + 
          '\nThere are also other smaller breaking changes in this release, described in the full changelog at https://github.com/jspm/jspm-cli/releases/tag/0.17.0-beta.\n' + '\n' + 
          'Please report any issues or feedback to help improve this release and thanks for testing it out.');
      });
    });
  }))
  .then(function(initInstalls) {
    config.loaded = true;

    if (initInstalls)
      return install.install(initInstalls, { dev: true });
  });
};

exports.loadSync = function(allowNoConfig) {
  if (config.loaded)
    return;

  if (loadPromise)
    throw 'Configuration file is already loading.';

  config.allowNoConfig = !!allowNoConfig;
  
  config.pjsonPath = process.env.jspmConfigPath || path.resolve(process.cwd(), 'package.json');
  
  config.pjson = new PackageConfig(config.pjsonPath);

  if (!allowNoConfig) {
    if (!config.pjson.jspmAware)
      throw 'Package.json file has not been initialized by jspm before. Run jspm init first.';

    if (!fs.existsSync(config.pjson.configFile))
      throw 'No project configuration file not found looking for `' + config.pjson.configFile + '`.';
  }
  config.loader = new JspmSystemConfig(config.pjson.configFile);
  config.loaderBrowser = new JspmBrowserConfig(config.pjson.configFileBrowser);

  if (!config.pjson.jspmAware && allowNoConfig)
    config.loader.transpiler = 'none';

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
  // builder init only needs to save loaderBrowser
  if (config.allowNoConfig) {
    if (config.loaderBrowser.file.changed)
      config.loaderBrowser.write();
  }
  else {
    config.loader.write();
    config.loaderBrowser.write();
    config.pjson.write();
    mkdirp.sync(config.pjson.packages);
    fs.writeFileSync(path.resolve(config.pjson.packages, '.dependencies.json'), stringify(getSerializedDeps(config.deps)));
  } 
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
    return ui.input('%Init Mode (Quick, Standard, Custom)%', 'Quick', {
      info: 'Select an init mode for jspm project configuration.',
      options: ['Quick', 'Standard', 'Custom']
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
      if (pjson.jspmPrefix && !jspmPrefix && pjson.file.has(['jspm']))
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
    return ui.input('%Local package name (recommended, optional)%', pjson.name, {
      edit: true,
      clearOnType: true,
      info: 'Enter a name for the project package.\n\nThis name will be used for importing local code.\neg via %System.import(\'' + pjson.name + '/module.js\')%.',
      validate: function(name) {
        if (name.indexOf(' ') != -1)
          return 'The package name should not contain any spaces.';
        if (name.match(/!|#/))
          return 'The package name should not contain characters ! or #.';
      }
    })
    .then(function(name) {
      pjson.name = name;
      if (name)
        loader.package = loader.package || {};
      else
        loader.package = null;
    });
  })
  // Local package path
  .then(function() {
    if (!loader.package)
      return;

    return ui.input('%package.json directories.lib%', path.relative(base, pjson.lib) || '.', {
      info: 'Enter the path to the folder containing the local project code.\n\nThis is the folder containing the %' + pjson.name + '% package code.',
      validate: function(lib) {
        if (!inDir(path.resolve(base, lib), pjson.baseURL))
          return 'The directories.lib path should be a subfolder within ' + (pjson.baseURL == base ? 'the project.' : 'the baseURL.');
      }
    })
    .then(function(lib) {
      pjson.hasLib = true;
      pjson.lib = path.resolve(base, lib);
      libPath = path.relative(base, pjson.lib);
      // clear libURL so it is regenerated
      loaderBrowser.libURL = null;
      return mkdirp(pjson.lib);
    });
  })
  // baseURL
  .then(function() {
    if (promptType == 'quick')
      return;

    return ui.input('%package.json directories.baseURL' + (loader.package ? ' (optional)%' : '%'), path.relative(base, pjson.baseURL), {
      info: 'Enter the file path to the public folder served to the browser.\n\nBy default this is taken to be the root project folder.',
      validate: function(baseURL) {
        if (path.resolve(baseURL) != base && !inDir(path.resolve(baseURL), base))
          return 'The directories.baseURL path should be a subfolder within the project.';
        if (pjson.lib && !inDir(pjson.lib, path.resolve(base, baseURL)))
          return 'The directories.baseURL path should contain the %' + path.relative(base, pjson.lib) + '% project path.\nTry using %' + (path.relative(base, path.dirname(pjson.lib)) || '.') + '%';
      }
    })
    .then(function(baseURL) {
      pjson.baseURL = path.resolve(base, baseURL);
      // populate default paths given the new baseURL value
      pjson.populateDefaultPaths(true);
    });
  })
  // jspm_packages folder path
  .then(function() {
    if (promptType == 'quick')
      return;

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
    if (promptType == 'custom' || promptType == 'quick')
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
      loader.file.rename(pjson.configFile);
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
      loaderBrowser.file.rename(pjson.configFileBrowser);
    });
  })
  // baseURL in browser
  .then(function() {
    return ui.input('%System.config browser baseURL' + (loader.package ? ' (optional)%' : '%'), loaderBrowser.baseURL || (pjson.jspmAware && loader.package ? '' : '/'), {
      edit: !!loader.package,
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
    if (!loader.package)
      return;

    var defaultLibURL = loaderBrowser.libURL || (loaderBrowser.baseURL ? '' : '/') + path.relative(pjson.baseURL, pjson.lib);

    if (promptType == 'quick') {
      loaderBrowser.libURL = defaultLibURL;
      return;
    }

    return ui.input('%System.config browser URL to ' + libPath + ' %', loaderBrowser.libURL || defaultLibURL, {
      info: 'Enter the browser URL for the folder containing the local project code.\n\nThis should be the served directories.lib folder.' +
        (loaderBrowser.baseURL ? ' Leave out the leading %/% to set a baseURL-relative path.' : ''),
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

    var defaultPackagesURL = loaderBrowser.packagesURL || (loaderBrowser.baseURL ? '' : '/') + path.relative(base, pjson.packages);

    if (promptType == 'quick') {
      loaderBrowser.packagesURL = defaultPackagesURL;
      return;
    }

    return ui.input('%System.config browser URL to ' + packagesPath + '%', loaderBrowser.packagesURL || defaultPackagesURL, {
      info: 'Enter the browser URL for the jspm_packages folder.' + (loaderBrowser.baseURL ? '\n\nLeave out the leading %/% to set a baseURL-relative path.' : ''),
      validate: function(packagesURL) {
        if (packagesURL[0] == '.')
          return 'The jspm_packages URL should not be a relative URL.';
      }
    })
    .then(function(packagesURL) {
      loaderBrowser.packagesURL = packagesURL;
    });
  })
  // main entry point
  .then(function() {
    if (!loader.package)
      return;

    return ui.input('%System.config local package main%', loader.package.main || pjson.main || (pjson.name + '.js'), {
      info: 'Enter the main entry point of your package within the %' + libPath + '% folder.'
    })
    .then(function(main) {
      pjson.main = main;
      loader.package.main = main;
    });
  })
  // format
  .then(function() {
    if (promptType == 'quick')
      return;

    if (!loader.package)
      return;

    return ui.input('%System.config local package format (esm, cjs, amd)%', loader.package.format || 'esm', {
      info: 'Enter the module format of your local project code (within `' + libPath + '`).\n\nThe default option is esm (ECMAScript Module).',
      options: ['esm', 'cjs', 'amd', 'global', 'system', 'systemjs', 'register'],
      edit: true,
      optionalOptions: true
    })
    .then(function(format) {
      format = format.toLowerCase();
      if (format == 'system' || format == 'systemjs')
        format = 'register';
      if (format)
        loader.package.format = format;
      else
        delete loader.package.format;
    });
  })
  // transpiler
  .then(function() {
    var transpilers = ['babel', 'traceur', 'typescript', 'none'];

    var curTranspiler = loader.transpiler;

    if (curTranspiler && (curTranspiler.substr(0, 7) == 'plugin-' || curTranspiler.substr(0, 7) == 'loader-') && 
        transpilers.indexOf(curTranspiler.substr(7).toLowerCase()) != -1)
      curTranspiler = curTranspiler.substr(7).toLowerCase();
    else if (curTranspiler)
      transpilers.push(curTranspiler);

    return ui.input('%System.config transpiler (Babel, Traceur, TypeScript, None)%', curTranspiler || 'babel', {
      info: 'Select a transpiler to use for ES module conversion.\n\n' +
          'The transpiler is used when detecting modules with %import% or %export% statements, or ' +
          'for modules with %format: "esm"% metadata set.',
      options: transpilers,
      validate: function(transpiler) {
        if (transpiler !== curTranspiler && transpilers.indexOf(transpiler.toLowerCase()) == -1)
          return 'Invalid transpiler option.';
      }
    })
    .then(function(transpiler) {
      if (transpiler === curTranspiler || transpiler == 'none')
        return;

      // set transpiler on BOTH the transpiler and local package loader config
      if (loader.package) {
        var pkgMeta = loader.package.meta = loader.package.meta || {};
        pkgMeta['*.js'] = pkgMeta['*.js'] || {};
        if (!pkgMeta['*.js'].loader || pkgMeta['*.js'].loader == loader.transpiler)
          pkgMeta['*.js'].loader = pkgMeta['*.js'].loader || 'plugin-' + transpiler.toLowerCase();
      }
      loader.transpiler = 'plugin-' + transpiler.toLowerCase();

      // download transpiler
      var installObj = {};
      installObj[loader.transpiler] = 'jspm:' + loader.transpiler;

      // the init function itself returns an install object, which is run in init
      return installObj;
    });
  });
}
