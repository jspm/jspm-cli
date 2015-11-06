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
require('core-js/es6/string');

var Promise = require('rsvp').Promise;
var path = require('path');
var nodeSemver = require('semver');
var ui = require('./ui');
var config = require('./config');
var registry = require('./registry');
var build = require('./build');
var PackageName = require('./config/package-name');
var fs = require('graceful-fs');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var ncp = require('ncp');
var asp = require('rsvp').denodeify;
var System = require('systemjs');
var install = require('./install');
var globalConfig = require('./global-config');
var toFileURL = require('./common').toFileURL;


var core = module.exports;

// we always download the latest semver compatible version
var systemVersion = require('../package.json').dependencies.systemjs;

var tPackages = {
  'babel':           'npm:babel-core@^5.8.24',
  'babel-runtime':   'npm:babel-runtime@^5.8.24',
  'core-js':         'npm:core-js@^1.1.4',
  'traceur':         'github:jmcriffey/bower-traceur@0.0.92',
  'traceur-runtime': 'github:jmcriffey/bower-traceur-runtime@0.0.92',
  'typescript':      'npm:typescript@^1.6.2'
};

exports.run = function(moduleName) {
  return config.load()
  .then(function() {
    var cfg = config.loader.getConfig();
    delete cfg.bundles;
    cfg.baseURL = toFileURL(config.pjson.baseURL);
    System.config(cfg);

    return System.import(moduleName);
  })
  .catch(function(e) {
    ui.log('err', e.stack || e);
  });
};

exports.build = function() {
  var saveConfig = false;

  return config.load()
  .then(function() {
    if (config.pjson.buildConfig.transpileES6 === undefined) {
      saveConfig = true;
      return ui.confirm('Transpile ES6?', true);
    }
  })
  .then(function(doTranspile) {
    if (doTranspile)
      config.pjson.buildConfig.transpileES6 = true;

    if (!config.pjson.buildConfig || config.pjson.buildConfig.minify === undefined) {
      saveConfig = true;
      return ui.confirm('Minify?', true);
    }
  })
  .then(function(doMinify) {
    if (doMinify)
      config.pjson.buildConfig.minify = true;

    if (saveConfig)
      return config.save();
  })
  .then(function() {
    return asp(rimraf)(config.pjson.dist);
  })
  .then(function() {
    return asp(ncp)(config.pjson.lib, config.pjson.dist);
  })
  .then(function() {
    return build.compileDir(config.pjson.dist, {
      format: config.pjson.format,
      map: config.pjson.map,
      transpile: config.pjson.buildConfig.transpileES6,
      minify: config.pjson.buildConfig.minify,
      removeJSExtensions: config.pjson.useJSExtensions
    });
  })
  .then(function(compileErrors) {
    if (compileErrors)
      ui.log('warn', 'Compile Errors:\n' + compileErrors);
    else
      ui.log('ok', 'Build Completed');
  }, function(err) {
    ui.log('err', err.stack || err);
  });
};

exports.setMode = function(modes) {
  if (!(modes instanceof Array))
    modes = [modes];

  var msg = '';

  return config.load()
  .then(function() {
    if (modes.indexOf('local') === -1)
      return true;

    // set local
    Object.keys(config.loader.registries).forEach(function(e) {
      config.loader.registries[e].setLocal();
    });

    msg += 'Loader set to local library sources\n';
  })
  .then(function(unmatched) {
    if (modes.indexOf('remote') === -1)
      return unmatched;

    // set remote
    Object.keys(config.loader.registries).forEach(function(e) {
      config.loader.registries[e].setRemote();
    });

    msg += 'Loader set to CDN library sources\n';
  })
  .then(function(unmatched) {
    if (unmatched)
      return ui.log('warn', 'Invalid mode');

    return config.save()
    .then(function() {
      return msg;
    });
  });
};

exports.dlTranspiler = function(transpilerName, update) {
  return config.load()
  .then(function() {
    var installObj = {};

    transpilerName = transpilerName || config.loader.transpiler || globalConfig.config.defaultTranspiler;
    
    // skip download if not using a transpiler
    if (transpilerName === 'none')
      return;
    
    // read existing transpiler from package.json install
    var target = !update && (config.pjson.devDependencies[transpilerName] || config.pjson.dependencies[transpilerName]);
    if (target)
      installObj[transpilerName] = target.exactName;
    else
      installObj[transpilerName] = transpilerName === 'traceur' ? tPackages.traceur : transpilerName === 'typescript' ? tPackages.typescript : tPackages.babel;
    
    // typescript does not have runtime library
    if (transpilerName !== 'typescript') {
      target = !update && (config.pjson.devDependencies[transpilerName + '-runtime'] || config.pjson.dependencies[transpilerName + '-runtime']);
      if (target)
        installObj[transpilerName + '-runtime'] = target.exactName;
      else
        installObj[transpilerName + '-runtime'] = transpilerName === 'traceur' ? tPackages['traceur-runtime'] : tPackages['babel-runtime'];
    }
    
    if (transpilerName === 'babel') {
      target = !update && (config.pjson.devDependencies['core-js'] || config.pjson.dependencies['core-js']);
      if (target)
        installObj['core-js'] = target.exactName;
      else
        installObj['core-js'] = tPackages['core-js'];
    }
    
    // just do a quick install which checks basic existence
    return install.install(installObj, { quick: !update, dev: true, summary: false });
  })
  .then(function() {
    if (config.loader.transpiler !== transpilerName) {
      config.loader.transpiler = transpilerName;
      
      if (transpilerName !== 'none')
        ui.log('ok', 'ES6 transpiler set to %' + transpilerName + '%.');
    }
    if (transpilerName === 'babel')
      if (!config.loader.babelOptions.optional)
        config.loader.babelOptions.optional = ['runtime', 'optimisation.modules.system'];
    return config.save();
  });
};

// check and download module loader files
exports.checkDlLoader = function(transpilerName) {
  return config.load()
  .then(function() {
    transpilerName = transpilerName || config.loader.transpiler || globalConfig.config.defaultTranspiler;
    var tPkgs = [];
    if (transpilerName === 'traceur')
      tPkgs = ['traceur', 'traceur-runtime'];
    else if (transpilerName === 'babel')
      tPkgs = ['babel', 'babel-runtime', 'core-js'];
    else if (transpilerName === 'typescript')
      tPkgs = ['typescript'];
      
    tPkgs.forEach(function(p) {
      if (config.loader.baseMap[p])
        if (config.loader.baseMap[p].version !== tPackages[p].split('@').pop() && !nodeSemver.satisfies(config.loader.baseMap[p].version, tPackages[p].split('@').pop()))
          ui.log('warn', '`' + p + '@' + config.loader.baseMap[p].version + '` is unsupported for this version of jspm. Use %jspm dl-loader --latest% to update.');
    });
  })
  .then(function() {
    return asp(fs.readFile)(path.resolve(config.pjson.packages, '.loaderversions'));
  })
  .catch(function(err) {
    if (err.code === 'ENOENT')
      return '';
    throw err;
  })
  .then(function(cacheVersions) {
    if (cacheVersions.toString() !== systemVersion)
      return exports.dlLoader(transpilerName);

    // even if version file is fresh, still check files exist
    return asp(fs.readdir)(config.pjson.packages)
    .catch(function(err) {
      if (err.code === 'ENOENT')
        return [];
      throw err;
    })
    .then(function(files) {
      if (files.indexOf('system.js') === -1)
        return exports.dlLoader(transpilerName);
      return exports.dlTranspiler(transpilerName);
    });
  });
};

// mini registry API usage implementation
var loaderFilesCacheDir = path.join(config.HOME, '.jspm', 'loader-files');

function dl(name, repo, version) {
  var pkg = new PackageName(repo);
  var endpoint = registry.load(pkg.registry);
  var vMatch, vMatchLookup;
  var dlDir = path.resolve(loaderFilesCacheDir, name);

  return endpoint.lookup(pkg.package)
  .then(function(lookup) {
    if (!(nodeSemver.validRange(version)))
      vMatch = version;
    else
      vMatch = Object.keys(lookup.versions)
      .filter(nodeSemver.valid)
      .sort(nodeSemver.compare).reverse()
      .filter(function(v) {
        return nodeSemver.satisfies(v, version);
      })[0];

    vMatchLookup = lookup.versions[vMatch];

    return asp(fs.readFile)(path.resolve(dlDir, '.hash'))
    .then(function(_hash) {
      return _hash.toString() === vMatchLookup.hash;
    }, function (e) {
      if (e.code === 'ENOENT')
        return;
      throw e;
    });
  })
  .then(function(cached) {
    if (cached)
      return;

    return endpoint.download(pkg.package, vMatch, vMatchLookup.hash, vMatchLookup.meta, dlDir)
    .then(function() {
      return fs.writeFile(path.resolve(dlDir, '.hash'), vMatchLookup.hash);
    });
  })
  .then(function() {
    return vMatch;
  });
}

// file copy implementation
function cp(file, name, transform) {
  return asp(fs.readFile)(path.resolve(loaderFilesCacheDir, file)).then(function(source) {
    if (transform)
      source = transform(source.toString());
    ui.log('info', '  `' + name + '`');
    return asp(fs.writeFile)(path.resolve(config.pjson.packages, name), source);
  });
}

exports.dlLoader = function(transpilerName, unminified, edge, latest) {
  ui.log('info', 'Looking up loader files...');
  var min = unminified ? '.src' : '';

  var using = {};

  return config.load()
  .then(function() {
    return asp(mkdirp)(config.pjson.packages);
  })
  .then(function() {
    // delete old versions
    return asp(fs.readdir)(config.pjson.packages);
  })
  .then(function(files) {
    return Promise.all(files.filter(function(file) {
      return file.match(/^(system-csp|system-csp-production|system|es6-module-loader|traceur|babel|system-polyfills|typescript)/);
    }).map(function(file) {
      return asp(fs.unlink)(path.resolve(config.pjson.packages, file));
    }));
  })
  .then(function() {
    return dl('systemjs', 'github:systemjs/systemjs', !edge ? (!latest ? systemVersion : '^' + systemVersion) : 'master')
    .then(function(version) {
      using.system = version;
      return Promise.all([
        cp('systemjs/dist/system' + min + '.js', 'system.js'),
        unminified || cp('systemjs/dist/system.src.js', 'system.src.js'),
        unminified || cp('systemjs/dist/system.js.map', 'system.js.map'),
        cp('systemjs/dist/system-csp-production' + min + '.js', 'system-csp-production.js'),
        unminified || cp('systemjs/dist/system-csp-production.src.js', 'system-csp-production.src.js'),
        unminified || cp('systemjs/dist/system-csp-production.js.map', 'system-csp-production.js.map'),
        cp('systemjs/dist/system-polyfills' + min + '.js', 'system-polyfills.js'),
        unminified || cp('systemjs/dist/system-polyfills.src.js', 'system-polyfills.src.js'),
        unminified || cp('systemjs/dist/system-polyfills.js.map', 'system-polyfills.js.map')
      ]);
    });
  })
  .then(function() {
    ui.log('info', '\nUsing loader versions:');
    ui.log('info', '  `systemjs@' + using.system + '`');

    return asp(fs.writeFile)(path.resolve(config.pjson.packages, '.loaderversions'), systemVersion);
  })
  .then(function() {
    return exports.dlTranspiler(transpilerName, latest);
  })
  .then(function() {
    ui.log('ok', 'Loader files downloaded successfully');
  }, function(err) {
    ui.log('err', err);
    ui.log('err', 'Error downloading loader files.');
    throw err;
  });
};

exports.init = function init(basePath, ask) {
  if (basePath)
    process.env.jspmConfigPath = path.resolve(basePath, 'package.json');
  var relBase = path.relative(process.cwd(), path.dirname(process.env.jspmConfigPath));
  if (relBase !== '')
    ui.log('info', 'Initializing package at `' + relBase + '/`\nUse %jspm init .% to intialize into the current folder.');
  return config.load(ask)
  .then(function() {
    return config.save();
  })
  .then(function() {
    ui.log('ok', 'Verified package.json at %' + path.relative(process.cwd(), config.pjsonPath) + '%\nVerified config file at %' + path.relative(process.cwd(), config.pjson.configFile) + '%');
  })
  .then(function() {
    return core.checkDlLoader();
  })
  .catch(function(err) {
    ui.log('err', err && err.stack || err);
  });
};

exports.cacheClear = function() {
  var jspmDir = path.resolve(config.HOME, '.jspm'),
      packagesCacheDir = path.join(jspmDir, 'packages'),
      loaderCacheDir = path.join(jspmDir, 'loader-files'),
      files, filesLength, fileName, i;

  // Clear loader files
  if (fs.existsSync(loaderCacheDir))
    rimraf.sync(loaderCacheDir);
  ui.log('ok', 'Loader file cache cleared.');

  // Clear packages cache folder
  if (fs.existsSync(packagesCacheDir))
    rimraf.sync(packagesCacheDir);
  ui.log('ok', 'Package cache cleared.');

  // Clear registry cache folders
  files = fs.readdirSync(jspmDir);
  filesLength = files.length;
  for (i = 0; i < filesLength; i++) {
    fileName = files[i];
    if (fileName.endsWith('-cache')) {
      rimraf.sync(path.join(jspmDir, fileName));
      ui.log('ok', '%' + fileName.substr(0, fileName.length - '-cache'.length) + '% cache cleared.');
    }
  }

  ui.log('warn', 'All caches cleared.');
  ui.log('info', 'Please post an issue if you suspect the cache isn\'t invalidating properly.');
  ui.log('info', '%jspm install -f% is equivalent to running a cache clear for that specific package tree.');
};
