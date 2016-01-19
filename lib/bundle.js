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
var toFileURL = require('./common').toFileURL;
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

  return SystemJSBuilder.prototype.bundle.call(this, expressionOrTree, opts);
};

Builder.prototype.buildStatic = function(expressionOrTree, outFile, opts) {
  if (outFile && typeof outFile === 'object') {
    opts = outFile;
    outFile = undefined;
  }

  opts = opts || {};

  if (outFile)
    opts.outFile = outFile;

  if (!('format' in opts))
    opts.format = 'global';

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
    logTree(depCache);
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

  return Promise.resolve()
  .then(function() {
    fileName = fileName || path.resolve(config.pjson.baseURL, 'build.js');

    if (!opts.sourceMaps)
      return removeExistingSourceMap(fileName);
  })
  .then(function() {
    ui.log('info', 'Building the bundle tree for %' + moduleExpression + '%...');

    // by default we build for the browser
    if (!('browser' in opts) && !('node' in opts))
      opts.browser = true;

    if (opts.production)
      opts.production = true;

    if (opts.dev)
      opts.development = true;

    if (!('lowResSourceMaps' in opts))
      opts.lowResSourceMaps = true;
    opts.buildConfig = true;

    return systemBuilder.bundle(moduleExpression, fileName, opts);
  })
  .then(function(output) {
    logTree(output.modules);
    delete config.loader.depCache;

    if (opts.inject) {
      // Add the bundle to config if the inject flag was given.
      var bundleName = systemBuilder.getCanonicalName(toFileURL(path.resolve(fileName)));

      config.loaderBrowser.file.setValue(['bundles', bundleName], output.modules);

      ui.log('ok', '`' + bundleName + '` added to config bundles.');
    }
  })
  .then(config.save)
  .then(function() {
    logBuild(path.relative(process.cwd(), fileName), opts);
  })
  .catch(function(e) {
    ui.log('err', e.stack || e);
    throw e;
  });
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

  return Promise.resolve()
  .then(function() {
    fileName = fileName || path.resolve(config.pjson.baseURL, 'build.js');

    if (!opts.sourceMaps)
      return removeExistingSourceMap(fileName);
  })
  .then(function() {
    ui.log('info', 'Creating the single-file build for %' + expression + '%...');

    opts.format = opts.format || 'umd';

    // by default we build for the browser
    if (!('browser' in opts) && !('node' in opts))
      opts.browser = true;

    // and production
    if (opts.production)
      opts.production = true;

    if (opts.dev)
      opts.dev = true;

    if (opts['skip-encode-names'])
      opts.encodeNames = false;

    return systemBuilder.buildStatic(expression, fileName, opts);
  })
  .then(function(output) {
    logTree(output.modules, output.inlineMap ? output.inlineMap : true);
    opts.extra = ' as %' + opts.format + '%';
    logBuild(path.relative(process.cwd(), fileName), opts);
  })
  .catch(function(e) {
    // catch sfx globals error to give a better error message
    if (e.toString().indexOf('globalDeps option') != -1) {
      var module = e.toString().match(/dependency "([^"]+)"/);
      module = module && module[1];
      ui.log('err', 'Build exclusion "' + module + '" needs an external reference.\n\t\t\tEither output to a module format like %--format amd% or map the external module to an environment global ' +
          'via %--global-deps "{\'' + module + '\': \'' + camelCase(module, true) + '\'}"%');
      throw 'Static build input error';
    }
    if (e.toString().indexOf('globalName option') != -1)
      ui.log('err', 'Build output to ' + opts.format + ' requires the global name to be set.\n\t\t\tTry adding %--global-name ' + camelCase(expression.split(' ')[0]) + '%');

    ui.log('err', e.stack || e);
    throw e;
  });
};

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
