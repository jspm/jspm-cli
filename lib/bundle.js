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
var ui = require('./ui');
var path = require('path');
var config = require('./config');
var SystemJSBuilder = require('systemjs-builder');
var fs = require('fs');
var asp = require('rsvp').denodeify;
var extend = require('./common').extend;
var alphabetize = require('./common').alphabetize;
var toFileURL = require('./common').toFileURL;

// jspm version of builder ignores config, baseURL arguments
// just allows cfg object
function Builder(_config) {
  config.loadSync();
  SystemJSBuilder.call(this, toFileURL(config.pjson.baseURL));

  var cfg = config.loader.getConfig();

  if (cfg.depCache)
    delete cfg.depCache;
  if (cfg.bundles)
    delete cfg.bundles;

  this.config(cfg, true);

  if (typeof _config == 'object')
    this.config(_config, true);
}
Builder.prototype = Object.create(SystemJSBuilder.prototype);
exports.Builder = Builder;

exports.depCache = function(expression) {
  var systemBuilder = new Builder();

  return config.load()
  .then(function() {
    expression = expression || config.loader.main;
  })
  .then(function() {
    ui.log('info', 'Injecting the traced dependency tree for `' + expression + '`...');

    return systemBuilder.trace(expression);
  })
  .then(function(tree) {
    logTree(tree);
    var depCache = config.loader.depCache || {};
    extend(depCache, systemBuilder.getDepCache(tree));
    config.loader.depCache = depCache;
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

  return config.load()
  .then(function() {
    fileName = fileName || path.resolve(config.pjson.baseURL, 'build.js');

    if (!opts.sourceMaps)
      return removeExistingSourceMap(fileName);
  })
  .then(function() {
    ui.log('info', 'Building the bundle tree for `' + moduleExpression + '`...');

    return systemBuilder.trace(moduleExpression);
  })
  .then(function(buildTree) {
    logTree(buildTree);
    if (!('lowResSourceMaps' in opts))
      opts.lowResSourceMaps = true;
    return systemBuilder.bundle(buildTree, fileName, opts);
  })
  .then(function(output) {
    delete config.loader.depCache;

    if (opts.inject) {
      // Add the bundle to config if the inject flag was given.
      var bundleName = systemBuilder.getCanonicalName(toFileURL(path.resolve(fileName)));

      if (!config.loader.bundles)
        config.loader.bundles = {};
      config.loader.bundles[bundleName] = output.modules;

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
    config.loader.bundles = {};
    config.loader.depCache = {};
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
    (opts.minify ? (opts.mangle ? ', ' : ', un') + 'mangled.' : '.'));
}

// options.minify, options.sourceMaps
exports.bundleSFX = function(expression, fileName, opts) {
  var systemBuilder = new Builder();
  
  opts = opts || {};

  return config.load()
  .then(function() {
    fileName = fileName || path.resolve(config.pjson.baseURL, 'build.js');

    if (!opts.sourceMaps)
      return removeExistingSourceMap(fileName);
  })
  .then(function() {
    ui.log('info', 'Building the single-file sfx bundle for `' + expression + '`...');

    opts.format = opts.format || 'global';

    if (!('lowResSourceMaps' in opts))
      opts.lowResSourceMaps = true;

    return systemBuilder.buildStatic(expression, fileName, opts);
  })
  .then(function() {
    logBuild(path.relative(process.cwd(), fileName), opts);
  })
  .catch(function(e) {
    // catch sfx globals error to give a better error message
    if (e.toString().indexOf('globalDeps option') != -1) {
      var module = e.toString().match(/dependency "([^"]+)" \(([^)]+)\)/);
      ui.log('err', 'SFX exclusion "' + module[1] + '" needs a reference.\nEither output an SFX module format like %--format amd% or map the module to an environment global via %--globals "{\'test.js\': \'test\'}"%.');
      throw 'SFX Bundle input error';
    }

    ui.log('err', e.stack || e);
    throw e;
  });
};

function logTree(tree) {
  ui.log('info', '');
  tree = alphabetize(tree);
  for (var name in tree) {
    if (tree[name] && tree[name].metadata && tree[name].metadata.build !== false)
      ui.log('info', '  `' + name + '`');
  }
  ui.log('info', '');
}

function removeExistingSourceMap(fileName) {
  return asp(fs.unlink)(fileName + '.map')
  .catch(function(e) {
    if (e.code === 'ENOENT')
      return;
    throw e;
  });
}
