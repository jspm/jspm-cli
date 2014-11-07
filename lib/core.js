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
var semver = require('./semver');
var nodeSemver = require('semver');
var ui = require('./ui');
var config = require('./config');
var pkg = require('./package');
var build = require('./build');
var PackageName = require('./config/package-name');
var request = require('request');
var fs = require('graceful-fs');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var ncp = require('ncp');
var link = require('./link');
var asp = require('rsvp').denodeify;
var Install = require('./install');


var core = module.exports;

core.uninstall = function() {}

// Primary install function, forms of arguments are documented in first four comments

/*
 * jspm.install('jquery')
 * jspm.install('jquery', 'github:components/jquery@^2.0.0')
 * jspm.install('jquery', '2')
 * jspm.install('jquery', 'github:components/jquery')
 * jspm.install('jquery', { force: true });
 * jspm.install({ jquery: '1.2.3' }, { force: true })
 * jspm.install('jquery', { primary: false }); // not saved to packge.json
 */

// options.force - skip cache
// options.primary
// options.inject
// options.parent (for setting secondary depmaps)
// options.link means symlink linked versions in ranges to jspm_packages where available
exports.install = install;
function install(targets, options) {

  // install('jquery', [{}])
  // install('jquery', 'github:components/jquery', [{}])
  if (typeof targets == 'string') {
    targets = {};
    targets[arguments[0]] = typeof options == 'string' ? options : '';
    options = typeof options == 'object' ? options : arguments[2];
  }
  options = options || {};

  return config.load()
  .then(function() {
    if (options.force)
      config.force = true;

    // install(true) - package.json
    if (targets === true)
      targets = config.pjson.dependencies;

    return Promise.all(Object.keys(targets).map(function(d) {
      var target = targets[d];

      if (!(target instanceof PackageName)) {
        // convert shortcut version-only form
        if (target.indexOf('@') == -1 && target.indexOf(':') == -1)
          target = d + '@' + (target || '');

        target = new PackageName(target);
      }

      return Install.install(d, target, options);
    }))
    .then(function() {
      return Install.saveInstall();
    });
  });
}

exports.build = function() {
  var saveConfig = false;

  return config.load()
  .then(function() {
    if (config.pjson.buildConfig.transpileES6 === undefined) {
      saveConfig = true;
      return ui.input('Transpile ES6?', true);
    }
  })
  .then(function(doTranspile) {
    if (doTranspile)
      config.pjson.buildConfig.transpileES6 = true;
    
    if (!config.pjson.buildConfig || config.pjson.buildConfig.minify === undefined) {
      saveConfig = true;
      return ui.input('Minify?', true);
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
    if (modes.indexOf('production') == -1)
      return unmatched;

    // set production
    config.loader.app.setPath(config.pjson.dist);
    msg += 'Local package URL set to %' + path.relative(process.cwd(), config.pjson.dist) + '%.';
  })
  .then(function(unmatched) {
    if (modes.indexOf('dev') == -1)
      return unmatched;

    // set dev
    config.name = config.name || 'app';
    config.loader.app.setPath(config.pjson.lib);
    msg += 'Local package URL set to %' + path.relative(process.cwd(), config.pjson.lib) + '%.';
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

// attempts to deprecate everything
// resulting in a pruning operation!
exports.prune = function() {
  return config.load()
  .then(function() {
    var deprecated;
    for (var dep in config.loader.depMap) {
      // attempt to deprecate everything!
      for (var subdep in config.loader.depMap[dep])
        if ((deprecated = deprecate(subdep.name, subdep.version)).length)
          ui.log('info', 'Deprecated `' + deprecated.join('`, `') + '`');
    }
  })
  .then(config.save)
  .then(function() {
    ui.log('ok', 'Pruned');
  })
  .catch(function(err) {
    ui.log('err', err.stack || err);
  });
}

// checks if we need to download the loader files
// if so, it does
exports.checkDlLoader = function() {
  return config.load()
  .then(function() {
    return asp(fs.readdir)(config.pjson.packages)
  })
  .catch(function(err) {
    if (err.code === 'ENOENT')
      return [];
    throw err;
  })
  .then(function(files) {
    var found = 0;
    files.forEach(function(file) {
      if (file.match(/^system|es6-module-loader/))
        found++;
    });
    if (found < 2)
      return exports.dlLoader();
  });
}

var ghh = 'https://raw.githubusercontent.com';
var loaderVersions = ['0.9', '0.9', '0.0.72'];

function doLoaderDownload(files) {
  return Promise.all(Object.keys(files).map(function(url) {
    var filename = files[url];
    return asp(request)({
      method: 'get',
      url: ghh + url,
      headers: {
        'user-agent': 'jspm'
      }
    })
    .then(function(res) {
      if (res.statusCode != 200)
        throw 'Request error ' + res.statusCode + ' for ' + ghh + url;

      var source = res.body;

      if (filename == 'traceur.js') {
        source = source.replace('traceur.min.map', 'traceur.js.map');
      }
      else if (filename == 'traceur.js.map') {
        source = source.replace('"traceur.js"', '"traceur.src.js"').replace('"traceur.min.js"', '"traceur.js"');
      }
      else if (filename == 'traceur-runtime.js') {
        source = source.replace('traceur-runtime.min.map', 'traceur-runtime.js.map');
      }
      else if (filename == 'traceur-runtime.js.map') {
        source = source.replace('"traceur-runtime.js"', '"traceur-runtime.src.js"').replace('"traceur-runtime.min.js"', '"traceur-runtime.js"');
      }

      return asp(fs.writeFile)(path.resolve(config.pjson.packages, filename), source);
    })
    .then(function() {
      ui.log('info', '  `' + path.basename(filename) + '`');
    });
  }));
}

exports.dlLoader = function(unminified, edge) {
  var min1 = unminified ? '.src' : '';
  var min2 = unminified ? '' : '.min';

  return config.load()
  .then(function() {
    ui.log('info', 'Downloading loader files to %' + path.relative(process.cwd(), config.pjson.packages) + '%');
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
      pkg.lookup(new PackageName('github:ModuleLoader/es6-module-loader'))
      .then(function(getVersionMatch) {
        var version = getVersionMatch(!edge ? loaderVersions[0] : 'master')
        var downloadFiles = {};
        downloadFiles['/ModuleLoader/es6-module-loader/' + (edge ? '' : 'v') + version.version + '/dist/es6-module-loader' + min1 + '.js'] = 'es6-module-loader.js';
        if (!unminified) {
          downloadFiles['/ModuleLoader/es6-module-loader/' + (edge ? '' : 'v') + version.version + '/dist/es6-module-loader.src.js'] = 'es6-module-loader.src.js';
          downloadFiles['/ModuleLoader/es6-module-loader/' + (edge ? '' : 'v') + version.version + '/dist/es6-module-loader.js.map'] = 'es6-module-loader.js.map';
        }
        return doLoaderDownload(downloadFiles);
      }),

      pkg.lookup(new PackageName('github:systemjs/systemjs'))
      .then(function(getVersionMatch) {
        var version = getVersionMatch(!edge ? loaderVersions[1] : 'master');
        var downloadFiles = {};
        downloadFiles['/systemjs/systemjs/' + version.version + '/dist/system' + min1 + '.js'] = 'system.js';
        if (!unminified) {
          downloadFiles['/systemjs/systemjs/' + version.version + '/dist/system.src.js'] = 'system.src.js';
          downloadFiles['/systemjs/systemjs/' + version.version + '/dist/system.js.map'] = 'system.js.map';
        }
        return doLoaderDownload(downloadFiles);
      }),

      pkg.lookup(new PackageName('github:jmcriffey/bower-traceur'))
      .then(function(getVersionMatch) {
        var version = getVersionMatch(!edge ? loaderVersions[2] : 'master')
        var downloadFiles = {};
        downloadFiles['/jmcriffey/bower-traceur/' + version.version + '/traceur' + min2 + '.js'] = 'traceur.js';
        downloadFiles['/jmcriffey/bower-traceur-runtime/' + version.version + '/traceur-runtime' + min2 + '.js'] = 'traceur-runtime.js';
        if (!unminified) {
          downloadFiles['/jmcriffey/bower-traceur/' + version.version + '/traceur.js'] = 'traceur.src.js';
          downloadFiles['/jmcriffey/bower-traceur/' + version.version + '/traceur.min.map'] = 'traceur.js.map';
          downloadFiles['/jmcriffey/bower-traceur-runtime/' + version.version + '/traceur-runtime.js'] = 'traceur-runtime.src.js';
          downloadFiles['/jmcriffey/bower-traceur-runtime/' + version.version + '/traceur-runtime.min.map'] = 'traceur-runtime.js.map';
        }
        return doLoaderDownload(downloadFiles);
      })
    ]);
  })
  .then(function() {
    ui.log('ok', 'Loader files downloaded successfully');
  }, function(err) {
    ui.log('err', 'Error downloading loader files \n' + (err.stack || err));
  });
}

exports.clean = function clean() {
  // ensure baseMap and dependencies match
  // ensure every baseMap target has a matching version
  // ensure every baseMap target version has a depMap
  // ensure all of these depMap items have a corresponding version
  // etc, basically ensure integrity of the whole tree, removing unused versions at the end
  // finally delete all folders in jspm_packages not matching something we had in this verified tree
}

exports.init = function init() {
  return config.load()
  .then(function() {
    var modes = ['local'];
    if (config.name)
      modes.push('dev');
    return core.setMode(modes);
  })
  .then(function() {
    ui.log('ok', 'Verified package.json at %' + path.relative(process.cwd(), config.pjsonPath) + '%\nVerified config file at %' + path.relative(process.cwd(), config.pjson.configFile) + '%');
  })
  .catch(function(err) {
    ui.log('err', err.stack || err);
  });
}
