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
var Builder = require('systemjs-builder');
var fs = require('fs');
var asp = require('rsvp').denodeify;

exports.depCache = function(moduleName) {
  var systemBuilder = new Builder();

  return config.load()
  .then(function() {
    moduleName = moduleName || config.loader.main;
  })
  .then(function() {
    ui.log('info', 'Injecting the traced dependency tree for `' + moduleName + '`...');

    // trace the starting module
    var cfg = config.loader.getConfig();
    cfg.baseURL = path.relative(process.cwd(), config.pjson.baseURL);

    return systemBuilder.trace(moduleName, cfg);
  })
  .then(function(output) {
    var traceTree = output.tree;
    moduleName = output.moduleName;
    var depCache = config.loader.depCache = config.loader.depCache || {};

    function mapDeps(dep) {
      return this.traceTree[this.d].depMap[dep];
    }

    for (var d in traceTree) {
      if (traceTree.hasOwnProperty(d)) {
        var deps = traceTree[d].deps.map(mapDeps, {d: d, traceTree: traceTree});
        if (deps.length)
          depCache[d] = deps;
      }
    }
  })
  .then(config.save)
  .then(function() {
    ui.log('ok', 'Depenency tree injected');
  })
  .catch(function(e) {
    ui.log('err', e.stack || e);
  });
};

// options.inject, options.sourceMaps, options.minify
exports.bundle = function(moduleExpression, fileName, opts) {
  var args = moduleExpression.split(' ');
  var systemBuilder = new Builder();

  var firstModule = args[0];

  var operations = extractOperations(args);

  return config.load()
  .then(function() {
    fileName = fileName || path.resolve(config.pjson.baseURL, 'build.js');

    if (!opts.sourceMaps)
      return removeExistingSourceMap(fileName);
  })
  .then(function() {
    ui.log('info', 'Building the bundle tree for `' + moduleExpression + '`...');

    // trace the starting module
    var cfg = config.loader.getConfig();
    cfg.baseURL = path.relative(process.cwd(), config.pjson.baseURL);

    return systemBuilder.trace(firstModule, cfg);
  })
  .then(function(trace) {

    // if there are no other operations, then we have the final tree
    if (!operations.length)
      return trace.tree;

    // chain the operations, applying them with the trace of the next module
    var operationPromise = Promise.resolve(trace.tree);
    operations.forEach(function(op) {
      operationPromise = operationPromise
      .then(function(curTree) {
        return systemBuilder.trace(op.moduleName)
        .then(function(nextTrace) {

          var operatorFunction;

          if (op.operator === '+')
            operatorFunction = systemBuilder.addTrees;
          else if (op.operator === '-')
            operatorFunction = systemBuilder.subtractTrees;
          else
            throw 'Unknown operator ' + op.operator;

          return operatorFunction(curTree, nextTrace.tree);
        });
      });
    });

    return operationPromise;
  })
  .then(function(buildTree) {
    if (opts.inject) {
      // Add the bundle to config if the inject flag was given.
      var bundleName = extractBundleName(fileName);
      if (!config.loader.bundles) {
        config.loader.bundles = {};
      }
      config.loader.bundles[bundleName] = Object.keys(buildTree).filter(function(moduleName) {
        return buildTree[moduleName].metadata.build !== false;
      });
      ui.log('ok', '`' + bundleName + '` added to config bundles.');
    }
    if (!('lowResSourceMaps' in opts))
      opts.lowResSourceMaps = true;
    return systemBuilder.buildTree(buildTree, fileName, opts);
  })
  .then(function() {
    delete config.loader.depCache;
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
exports.bundleSFX = function(moduleName, fileName, opts) {
  if (fileName === '+' || fileName === '-') {
    ui.log('err', 'Bundle arithmetic is not supported for SFX builds. Use standard bundling to support dynamic loading.');
    return Promise.reject();
  }

  var systemBuilder = new Builder();

  return config.load()
  .then(function() {
    fileName = fileName || path.resolve(config.pjson.baseURL, 'build.js');

    if (!opts.sourceMaps)
      return removeExistingSourceMap(fileName);
  })
  .then(function() {
    ui.log('info', 'Building the single-file sfx bundle for `' + moduleName + '`...');

    // trace the starting module
    var cfg = config.loader.getConfig();
    cfg.baseURL = path.relative(process.cwd(), config.pjson.baseURL);

    opts.config = cfg;
    if (!('lowResSourceMaps' in opts))
      opts.lowResSourceMaps = true;

    return systemBuilder.buildSFX(moduleName, fileName, opts);
  })
  .then(function() {
    logBuild(path.relative(process.cwd(), fileName), opts);
  })
  .catch(function(e) {
    ui.log('err', e.stack || e);
    throw e;
  });
};

function extractOperations(args) {
  var operations = [];

  for (var i = 1; i < args.length - 1; i = i + 2) {
    var operator = args[i];
    var moduleName = args[i + 1];

    operations.push({
      operator: operator,
      moduleName: moduleName
    });
  }

  return operations;
}

function extractBundleName(fileName) {
  return path.relative(config.pjson.baseURL, fileName.replace(/\.js$/, '')).replace(/\\/g, '/');
}

function removeExistingSourceMap(fileName) {
  return asp(fs.unlink)(fileName + '.map')
  .catch(function(e) {
    if (e.code === 'ENOENT')
      return;
    throw e;
  });
}
