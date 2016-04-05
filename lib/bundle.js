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
var ui = require('./ui');
var path = require('path');
var config = require('./config');
var SystemJSBuilder = require('systemjs-builder');
var fs = require('fs');
var asp = require('bluebird').Promise.promisify;
var extendSystemConfig = require('./common').extendSystemConfig;

function camelCase(name, capitalizeFirst) {
  return name.split('-').map(function(part, index) {
    return index || capitalizeFirst ? part[0].toUpperCase() + part.substr(1) : part;
  }).join('');
}


// new Builder(baseURL)
// new Builder(baseURL, {cfg})
// new Builder({cfg})
function Builder(baseURL, cfg) {
  if (typeof baseURL == 'object') {
    cfg = baseURL;
    baseURL = null;
  }
  config.loadSync(true);
  cfg = extendSystemConfig(config.getLoaderConfig(), cfg || {});
  if (baseURL)
    cfg.baseURL = baseURL;
  SystemJSBuilder.call(this, cfg);
}
Builder.prototype = Object.create(SystemJSBuilder.prototype);

// extend build functions with jspm 0.16 compatibility options
Builder.prototype.bundle = function(expressionOrTree, outFile, opts) {
  if (outFile && typeof outFile === 'object') {
    opts = outFile;
    outFile = undefined;
  }

  opts = opts || {};

  if (outFile)
    opts.outFile = outFile;

  /* jspm default bundle options */

  // by default we build for the browser
  if (!('browser' in opts) && !('node' in opts))
    opts.browser = true;

  if (!('lowResSourceMaps' in opts))
    opts.lowResSourceMaps = true;

  opts.buildConfig = true;

  return SystemJSBuilder.prototype.bundle.call(this, expressionOrTree, opts)
  .then(function(output) {
    // Add the bundle to config if the inject flag was given.
    if (opts.injectConfig) {
      config.loaderBrowser.file.setValue(['bundles', output.bundleName], output.modules);
      return Promise.resolve(config.save())
      .then(function() {
        return output;
      });
    }

    return output;
  });
};

Builder.prototype.buildStatic = function(expressionOrTree, outFile, opts) {
  if (outFile && typeof outFile === 'object') {
    opts = outFile;
    outFile = undefined;
  }

  opts = opts || {};

  if (outFile)
    opts.outFile = outFile;

  /* jspm default build options */

  if (!('browser' in opts) && !('node' in opts))
    opts.browser = true;

  if (!('lowResSourceMaps' in opts))
    opts.lowResSourceMaps = true;

  opts.format = opts.format || 'umd';

  if (!('rollup' in opts))
    opts.rollup = true;

  return SystemJSBuilder.prototype.buildStatic.call(this, expressionOrTree, opts);
};


exports.Builder = Builder;

exports.depCache = function(expression) {
  var systemBuilder = new Builder();

  expression = expression || config.loader.main;

  ui.log('info', 'Injecting the traced dependency tree for `' + expression + '`...');

  return systemBuilder.trace(expression, { browser: true })
  .then(function(tree) {
    var depCacheConfig = config.loaderBrowser.file.getObject(['depCache']) || {};
    var depCache = systemBuilder.getDepCache(tree);
    Object.keys(depCache).forEach(function(dep) {
      depCacheConfig[dep] = depCache[dep];
    });
    var modules = Object.keys(tree).filter(function(moduleName) {
      return tree[moduleName] && !tree[moduleName].conditional;
    });
    logTree(modules);
    config.loaderBrowser.file.setObject(['depCache'], depCacheConfig);
  })
  .then(config.save)
  .then(function() {
    ui.log('ok', 'Dependency tree injected');
  })
  .catch(function(e) {
    ui.log('err', e.stack || e);
  });
};

// options.inject, options.sourceMaps, options.minify
exports.bundle = function(moduleExpression, fileName, opts) {
  var systemBuilder = new Builder();

  opts = opts || {};
  fileName = fileName || path.resolve(config.pjson.baseURL, 'build.js');

  function bundle() {
    return Promise.resolve()
    .then(function() {
      if (!opts.sourceMaps)
        return removeExistingSourceMap(fileName);
    })
    .then(function() {
      ui.log('info', 'Building the bundle tree for %' + moduleExpression + '%...');

      return systemBuilder.bundle(moduleExpression, fileName, opts);
    })
    .then(function(output) {
      logTree(output.modules);

      if (opts.injectConfig)
        ui.log('ok', '`' + output.bundleName + '` added to config bundles.');

      logBuild(path.relative(process.cwd(), fileName), opts);
      return output;
    })
    .catch(function(e) {
      ui.log('err', e.stack || e);
      throw e;
    })
    .then(function(output) {
      if (!opts.watch)
        return output;

      // create a watcher
      buildWatch(output.modules.map(function(name) {
        return output.tree[name] && output.tree[name].path;
      }).filter(function(name) {
        return name;
      }).map(function(file) {
        return path.resolve(config.pjson.baseURL, file);
      }), function(invalidated, rebuild) {
        if (invalidated)
          systemBuilder.invalidate(invalidated);
        if (rebuild)
          return bundle();
      });
    });
  }

  return bundle();
};

exports.unbundle = function() {
  return config.load()
  .then(function() {
    config.loaderBrowser.file.remove(['bundles']);
    config.loaderBrowser.file.remove(['depCache']);
    return config.save();
  })
  .then(function() {
    ui.log('ok', 'Bundle configuration removed.');
  });
};

function logBuild(outFile, opts) {
  var resolution = opts.lowResSourceMaps ? '' : 'high-res ';
  ui.log('ok', 'Built into `' + outFile + '`' +
    (opts.sourceMaps ? ' with ' + resolution + 'source maps' : '') + ', ' +
    (opts.minify ? '' : 'un') + 'minified' +
    (opts.minify ? (opts.mangle ? ', ' : ', un') + 'mangled' : '') +
    (opts.extra ? opts.extra : '') + '.');
}

// options.minify, options.sourceMaps
exports.build = function(expression, fileName, opts) {
  var systemBuilder = new Builder();

  opts = opts || {};
  fileName = fileName || path.resolve(config.pjson.baseURL, 'build.js');

  function build() {
    return Promise.resolve()
    .then(function() {
      if (!opts.sourceMaps)
        return removeExistingSourceMap(fileName);
    })
    .then(function() {
      ui.log('info', 'Creating the single-file build for %' + expression + '%...');

      return systemBuilder.buildStatic(expression, fileName, opts);
    })
    .then(function(output) {
      logTree(output.modules, output.inlineMap ? output.inlineMap : opts.rollup);
      opts.extra = ' as %' + opts.format + '%';
      logBuild(path.relative(process.cwd(), fileName), opts);
      return output;
    })
    .catch(function(e) {
      // catch sfx globals error to give a better error message
      if (e.toString().indexOf('globalDeps option') != -1) {
        var module = e.toString().match(/dependency "([^"]+)"/);
        module = module && module[1];
        throw 'Build exclusion "' + module + '" needs an external reference.\n\t\t\tEither output to a module format like %--format amd% or map the external module to an environment global ' +
            'via %--global-deps "{\'' + module + '\': \'' + camelCase(module, true) + '\'}"%';
      }
      if (e.toString().indexOf('globalName option') != -1)
        throw 'Build output to %' + opts.format + '% requires the global name to be set.\n\t\t\t' +
          'Try adding %--global-name ' + camelCase((expression.substr(expression.length - 3, 3) == '.js' ? expression.substr(0, expression.length - 3) : expression).split(/ |\//)[0]) + '% or setting %--format amd%';
      else
        throw e;
    })
    .catch(function(e) {
      ui.log('err', e.stack || e);
      throw e;
    })
    .then(function(output) {
      if (!opts.watch)
        return output;

      // create a watcher
      buildWatch(output.modules.map(function(name) {
        return output.tree[name] && output.tree[name].path;
      }).filter(function(name) {
        return name;
      }), function(invalidated, rebuild) {
        if (invalidated)
          systemBuilder.invalidate(invalidated);
        if (rebuild)
          return build();
      });
    });
  }

  return build();
};

var watchman = true;
function buildWatch(files, fn) {
  var sane = require('sane');

  // get the lowest directory from the files listing
  var lowestDir = path.dirname(files[0]);
  files.forEach(function(file) {
    if (path.dirname(file).length < lowestDir.length)
      lowestDir = path.dirname(file);
  });

  var relFiles = files.map(function(file) {
    if (lowestDir == '.')
      return file;
    return file.substr(lowestDir.length + 1);
  });

  var watcher = sane(lowestDir, { glob: relFiles, watchman: watchman });
  watcher.on('error', function(e) {
    if (e.toString().indexOf('Watchman was not found in PATH') == -1) {
      ui.log('err', e.stack || e);
      return;
    }

    watchman = false;
    buildWatch(files, fn);
  });

  watcher.on('ready', function() {
    ui.log('info', 'Watching %' + lowestDir + '% for changes ' + (watchman ? 'with Watchman' : 'with Node native watcher') + '...');
  });
  watcher.on('add', function(filepath) {
    var file = path.join(lowestDir, filepath);
    ui.log('ok', 'File `' + file + '` created, rebuilding...');
    fn(file, true)
    .then(function() {
      watcher.close();
    });
  });
  watcher.on('delete', function(filepath) {
    var file = path.join(lowestDir, filepath);
    ui.log('warn', 'File `' + file + '` removed, cache invalidated pending rebuild...');
    fn(file, false);
  });
  watcher.on('change', function(filepath) {
    var file = path.join(lowestDir, filepath);
    ui.log('ok', 'File `' + file + '` changed, rebuilding...');
    fn(file, true)
    .then(function() {
      watcher.close();
    });
  });
}

function logTree(modules, inlineMap) {
  inlineMap = inlineMap || {};
  var inlinedModules = [];

  Object.keys(inlineMap).forEach(function(inlineParent) {
    inlinedModules = inlinedModules.concat(inlineMap[inlineParent]);
  });

  ui.log('info', '');

  if (inlineMap['@dummy-entry-point'])
    logDepTree(inlineMap['@dummy-entry-point'], false);

  if (inlineMap !== true)
    modules.sort().forEach(function(name) {
      if (inlinedModules.indexOf(name) == -1)
        ui.log('info', '  `' + name + '`');

      if (inlineMap[name])
        logDepTree(inlineMap[name], true);
    });
  else
    logDepTree(modules, false);

  if (inlinedModules.length || inlineMap === true)
    ui.log('info', '');

  if (inlinedModules.length)
    ui.log('ok', '%Optimized% - modules in bold inlined via Rollup static optimizations.');
  if (inlineMap === true)
    ui.log('ok', '%Fully-optimized% - entire tree built via Rollup static optimization.');
  ui.log('info', '');
}

function logDepTree(items, firstParent) {
  items.forEach(function(item, index) {
    ui.log('info', '  `' + (items.length == 1 ? '──' : index == items.length - 1 ? '└─' : index == 0 && !firstParent ? '┌─' : '├─') + ' %' + item + '%`');
  });
}

function removeExistingSourceMap(fileName) {
  return asp(fs.unlink)(fileName + '.map')
  .catch(function(e) {
    if (e.code === 'ENOENT')
      return;
    throw e;
  });
}
