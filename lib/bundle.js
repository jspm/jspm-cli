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
var ui = require('./ui');
var path = require('path');
var config = require('./config');
var systemBuilder = require('systemjs-builder');

var oldPaths = {};
function setLocalPaths() {
  // set local
  var jspmPackages = path.relative(config.dir, config.jspmPackages);
  config.endpoints.forEach(function(e) {
    if (config.paths[e + ':*'])
      oldPaths[e + ':*'] = config.paths[e + ':*'];
    config.paths[e + ':*'] = jspmPackages + '/' + e + '/*.js';
  });
}
function revertLocalPaths() {
  var jspmPackages = path.relative(config.dir, config.jspmPackages);
  config.endpoints.forEach(function(e) {
    config.paths[e + ':*'] = oldPaths[e + ':*'];
  });
}

exports.depCache = function(moduleName) {
  var oldPaths;
  return config.load()
  .then(function() {
    moduleName = moduleName || config.main;
    if (!moduleName)
      return ui.input('No main entry point is provided, please specify the module to trace', '~/app').then(function(main) {
        config.main = main;
      });
  })
  .then(function() {
    ui.log('info', 'Injecting the traced dependency tree for `' + moduleName + '`...');
    setLocalPaths();
    return systemBuilder.trace(moduleName, config.curConfig);
  })
  .then(function(output) {
    var traceTree = output.tree;
    moduleName = output.moduleName;
    var depCache = config.curConfig.depCache = config.curConfig.depCache || {};
    for (var d in traceTree)
      depCache[d] = traceTree[d].deps.map(function(dep) {
        return traceTree[d].depMap[dep];
      });
    revertLocalPaths();
  })
  .then(config.save)
  .then(function() {
    ui.log('ok', 'Depenency tree injected');
    // ui.log('info', '\n' + logTree(config.curConfig.depCache, moduleName, 1) + '\n');
  })
  .catch(function(e) {
    ui.log('err', e.stack || e);
  });
}

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

function extractBundleName(fileName){
    return fileName.replace(/\.js$/, "");
}

exports.bundle = function(moduleExpression, fileName, inject) {
  fileName = fileName || 'build.js';
  inject = inject || false;

  var args = moduleExpression.split(' ');

  var firstModule = args[0];

  var operations = extractOperations(args);

  return config.load()
  .then(function() {
    ui.log('info', 'Building the bundle tree for `' + moduleExpression + '`...');
    setLocalPaths();

    // trace the starting module
    return systemBuilder.trace(firstModule, config.curConfig);
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

          if (op.operator == '+')
            operatorFunction = systemBuilder.addTrees;
          else if (op.operator == '-')
            operatorFunction = systemBuilder.subtractTrees;
          else
            throw 'Unknown operator ' + op.operator;

          return operatorFunction(curTree, nextTrace.tree);
        })
      });
    });

    return operationPromise;
  })
  .then(function(buildTree) {
    if (inject) {
      // Add the bundle to config if the inject flag was given.
      var bundleName = extractBundleName(fileName);
      if (!config.curConfig.bundles) {
        config.curConfig.bundles = {};
      }
      config.curConfig.bundles[bundleName] = Object.keys(buildTree).filter(function(moduleName) {
        return buildTree[moduleName].metadata.build !== false;
      });
      ui.log('ok', '`' + bundleName + '` added to config bundles.');
    }
    return systemBuilder.buildTree(buildTree, fileName);
  })
  .then(function() {
    delete config.curConfig.depCache;
    revertLocalPaths();
  })
  .then(config.save)
  .then(function() {
    ui.log('ok', 'Built into `' + fileName + '`');
  })
  .catch(function(e) {
    ui.log('err', e.stack || e);
  });
}

exports.bundleSFX = function(moduleName, fileName) {
  fileName = fileName || 'build.js';

  return config.load()
  .then(function() {
    ui.log('info', 'Building the single-file sfx bundle for `' + moduleName + '`...');
    setLocalPaths();

    return systemBuilder.buildSFX(moduleName, config.curConfig, fileName);
  })
  .then(function() {
    revertLocalPaths();
  })
  .then(config.save)
  .then(function() {
    ui.log('ok', 'Built into `' + fileName + '`');
  })
  .catch(function(e) {
    ui.log('err', e.stack || e);
  });
}