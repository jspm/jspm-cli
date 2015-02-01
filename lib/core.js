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

var Promise = require('rsvp').Promise;
var path = require('path');
var nodeSemver = require('semver');
var ui = require('./ui');
var config = require('./config');
var ep = require('./endpoint');
var build = require('./build');
var PackageName = require('./config/package-name');
var request = require('request');
var fs = require('graceful-fs');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var ncp = require('ncp');
var link = require('./link');
var asp = require('rsvp').denodeify;
var System = require('systemjs');


var core = module.exports;

exports.run = function(moduleName) {
  return config.load()
  .then(function() {
    var cfg = config.loader.getConfig();
    delete cfg.bundles;
    cfg.baseURL = config.pjson.baseURL;
    System.config(cfg);

    return System.import(moduleName);
  })
  .catch(function(e) {
    ui.log('err', e.stack || e);
  });
}

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
}

exports.setMode = function(modes) {
  if (!(modes instanceof Array))
    modes = [modes];

  var msg = '';

  return config.load()
  .then(function() {
    if (modes.indexOf('local') == -1)
      return true;
    
    // set local
    Object.keys(config.loader.endpoints).forEach(function(e) {
      config.loader.endpoints[e].setLocal();
    });

    msg += 'Loader set to local library sources\n';
  })
  .then(function(unmatched) {
    if (modes.indexOf('remote') == -1)
      return unmatched;

    // set remote
    Object.keys(config.loader.endpoints).forEach(function(e) {
      config.loader.endpoints[e].setRemote();
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
}

// checks if we need to download the loader files
// if so, it does
// supports custom transpilerNames -> '6to5', 'traceur' (default)
exports.checkDlLoader = function() {
  var transpilerName;
  return config.load()
  .then(function() {
    transpilerName = config.loader.transpiler;
    return asp(fs.readFile)(path.resolve(config.pjson.packages, '.loaderversions'));
  })
  .catch(function(err) {
    if (err.code === 'ENOENT')
      return '';
    throw err;
  })
  .then(function(cacheVersions) {
    if (cacheVersions.toString() != [lVersions.esml, lVersions.system, transpilerName == '6to5' ? '' : lVersions.traceur, transpilerName == '6to5' ? lVersions['6to5'] : ''].join(','))
      return exports.dlLoader(transpilerName);

    // even if version file is fresh, still check files exist
    return asp(fs.readdir)(config.pjson.packages)
    .catch(function(err) {
      if (err.code === 'ENOENT')
        return [];
      throw err;
    })
    .then(function(files) {
      var found = 0;
      files.forEach(function(file) {
        if (file.match(/^system|es6-module-loader|traceur|6to5/))
          found++;
      });
      if (found < 3)
        return exports.dlLoader(transpilerName);
    });
  });
}

var ghh = 'https://raw.githubusercontent.com/';

// we always download the latest semver compatible version
var lVersions = {
  esml: '^0.13.0',
  system: '^0.13.0',
  traceur: '^0.0.82',
  '6to5': '~3.3.2'
};

// mini endpoint API usage implementation
var loaderFilesCacheDir = path.join(config.HOME, '.jspm', 'loader-files');
function dl(name, repo, version) {
  var pkg = new PackageName(repo);
  var endpoint = ep.load(pkg.endpoint);
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
      return _hash.toString() == vMatchLookup.hash;
    }, function (e) {
      if (e.code == 'ENOENT')
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
    })
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


exports.dlLoader = function(transpilerName, unminified, edge) {
  ui.log('info', 'Looking up loader files...');
  var min1 = unminified ? '.src' : '';
  var min2 = unminified ? '' : '.min';

  var using = {};
  var to5;

  return config.load()
  .then(function() {
    transpilerName = transpilerName || config.loader.transpiler;
    to5 = transpilerName == '6to5';
    return asp(mkdirp)(config.pjson.packages);
  })
  .then(function() {
    // delete old versions
    return asp(fs.readdir)(config.pjson.packages)
  })
  .then(function(files) {
    return Promise.all(files.filter(function(file) {
      return file.match(/^(system-csp|system|es6-module-loader|traceur|traceur-runtime)/);
    }).map(function(file) {
      return asp(fs.unlink)(path.resolve(config.pjson.packages, file));
    }));
  })
  .then(function() {
    return Promise.all([
      dl('esml', 'github:ModuleLoader/es6-module-loader', !edge ? lVersions.esml : 'master')
      .then(function(version) {
        using.esml = version;
        return Promise.all([
          cp('esml/dist/es6-module-loader' + min1 + '.js', 'es6-module-loader.js'),
          unminified || cp('esml/dist/es6-module-loader.src.js', 'es6-module-loader.src.js'),
          unminified || cp('esml/dist/es6-module-loader.js.map', 'es6-module-loader.js.map')
        ]);
      }),
      dl('systemjs', 'github:systemjs/systemjs', !edge ? lVersions.system : 'master')
      .then(function(version) {
        using.system = version;
        return Promise.all([
          cp('systemjs/dist/system' + min1 + '.js', 'system.js'),
          unminified || cp('systemjs/dist/system.src.js', 'system.src.js'),
          unminified || cp('systemjs/dist/system.js.map', 'system.js.map')
        ]);
      }),
      to5 ? dl('6to5', 'npm:6to5', !edge ? lVersions['6to5'] : 'latest').then(function(version) {
        using['6to5'] = version;
        return Promise.all([
          cp('6to5/browser.js', '6to5.js'),
          cp('6to5/runtime.js', '6to5-runtime.js'),
          cp('6to5/browser-polyfill.js', '6to5-polyfill.js')
        ]);
      }) : dl('traceur', 'github:jmcriffey/bower-traceur', !edge ? lVersions.traceur : 'master').then(function(version) {
        using.traceur = version;
        return Promise.all([
          cp('traceur/traceur' + min2 + '.js', 'traceur.js', 
              function(s) { return s.replace('traceur.min.map', 'traceur.js.map'); }),
          unminified || cp('traceur/traceur.js', 'traceur.src.js'),
          unminified || cp('traceur/traceur.min.map', 'traceur.js.map', 
              function(s) { return s.replace('"traceur.js"', '"traceur.src.js"').replace('"traceur.min.js"', '"traceur.js"'); })
        ]);
      }),
      to5 ? Promise.resolve() : dl('traceur-runtime', 'github:jmcriffey/bower-traceur-runtime', !edge ? lVersions.traceur : 'master').then(function() {
        return Promise.all([
          cp('traceur-runtime/traceur-runtime' + min2 + '.js', 'traceur-runtime.js', 
              function(s) { return s.replace('traceur-runtime.min.map', 'traceur-runtime.js.map'); }),
          unminified || cp('traceur-runtime/traceur-runtime.js', 'traceur-runtime.src.js'),
          unminified || cp('traceur-runtime/traceur-runtime.min.map', 'traceur-runtime.js.map', 
              function(s) { return s.replace('"traceur-runtime.js"', '"traceur-runtime.src.js"').replace('"traceur-runtime.min.js"', '"traceur-runtime.js"'); })
        ]);
      })
    ]);
  })
  .then(function() {
    ui.log('info', '\nUsing loader versions:');
    ui.log('info', '  `es6-module-loader@' + using.esml + '`');
    ui.log('info', '  `systemjs@' + using.system + '`');
    ui.log('info', '  `' + transpilerName + '@' + using[transpilerName] + '`');

    return asp(fs.writeFile)(path.resolve(config.pjson.packages, '.loaderversions'), 
        [lVersions.esml, lVersions.system, transpilerName == '6to5' ? '' : lVersions.traceur, transpilerName == '6to5' ? lVersions['6to5'] : ''].join(','));
  })
  .then(function() {
    if (config.loader.transpiler != transpilerName) {
      config.loader.transpiler = transpilerName;
      return config.save()
      .then(function() {
        ui.log('ok', 'ES6 transpiler set to %' + transpilerName + '%.');
      });
    }
  })
  .then(function() {
    ui.log('ok', 'Loader files downloaded successfully');
  }, function(err) {
    ui.log('err', 'Error downloading loader files \n' + (err.stack || err));
  });
}

exports.init = function init(basePath, ask) {
  if (basePath)
    process.env.jspmConfigPath = path.resolve(basePath, 'package.json');
  var relBase = path.relative(process.cwd(), path.dirname(process.env.jspmConfigPath));
  if (relBase != '')
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
    ui.log('err', err.stack || err);
  });
}
