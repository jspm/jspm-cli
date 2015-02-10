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
var systemBuilder = require('systemjs-builder');
var fs = require('fs');
var asp = require('rsvp').denodeify;
var glob = require('glob');

exports.depCache = function(moduleName) {
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
    for (var d in traceTree) {
      var deps = traceTree[d].deps.map(function(dep) {
        return traceTree[d].depMap[dep];
      });

      if (deps.length)
        depCache[d] = deps;
    }
  })
  .then(config.save)
  .then(function() {
    ui.log('ok', 'Depenency tree injected');
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

function extractBundleName(fileName) {
  return path.relative(config.pjson.baseURL, fileName.replace(/\.js$/, '')).replace(/\\/g, '/');
}

function getModuleName (file) {
  var baseURL =  config.pjson.baseURL + '/';
  var paths =  systemBuilder.loader.paths;

  //todo: cache the sortedPaths for subsequent usage for better performance.
  var sortedPaths = sortPathsByValue(paths); // sort the rules in descending order so that the longest specific rule gets hoisted up top.

  var id = '';
  for (p in sortedPaths) {
    var rule = sortedPaths[p];
    var resolved = path.resolve(baseURL, rule); // resolve the full path from the rule
    resolved = resolved.replace(/\\/g, '/'); // replace  '\' with  '/'

    var ruleDir =  path.dirname(resolved); // find the resolved directory
    var fileDir = path.dirname(file);      // find the file's directory.

    var regex = new RegExp('^' + ruleDir, 'i'); // test if wildcard's directory path has a match with file's directory.

    if(regex.test(fileDir)){
      var parts = p.split('*');
      var moduleName =  file.replace(regex, '');
      moduleName = moduleName.replace(/^\//, ''); //remove the last trailing '/' from the baseURL
      moduleName =  moduleName.replace(new RegExp(path.extname(rule) + '$', 'g'), ''); // remove any extension the rule have from the moduleName.
      id = parts[0] + moduleName;
      break;
    }
  }

  if(id === ''){
    throw new Error('No matching rule defined for file: ' + "'" + file + "'");
  }

  return id;
}

function sortPathsByValue(obj) {
  // convert object into array
  var sortable = [];
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      sortable.push([key, obj[key]]);
    }
  }
  // sort items by path value in descending order
  sortable.sort(function(a, b) {
    var x = a[1].toLowerCase();
    var y = b[1].toLowerCase();

    if (x.length > y.length) return -1;
    if (x.length < y.length) return 1;
    return 0;
  });

  var sorted = {};
  sortable.forEach(function(arr) {
    sorted[arr[0]] = arr[1];
  });

  return sorted;
};

function expandGlob(moduleName) {
  var loader = systemBuilder.loader;

  return loader.normalize(moduleName)
    .then(function (normalized) {
      return loader.locate({name: normalized})
    })
    .then(function (address) {

      var normalizedAddress = path.normalize(address).replace(new RegExp('\\' + path.sep, 'g'), '/'); // glob does not like `\`
      normalizedAddress = normalizedAddress.replace(new RegExp('^file:'), '');

      var files = glob.sync(normalizedAddress, {});

      var modules = files.map(function (file) {
        return getModuleName(file);
      });

      return modules;

    });
}

function getOperatorFunc(op) {
  var operatorFunction;
  if (op.operator == '+')
    operatorFunction = systemBuilder.addTrees;
  else if (op.operator == '-')
    operatorFunction = systemBuilder.subtractTrees;
  else
    throw 'Unknown operator ' + op.operator;
  return operatorFunction;
}

// options.inject, options.sourceMaps, options.minify
exports.bundle = function(moduleExpression, fileName, opts) {
  var args = moduleExpression.split(' ');

  var firstModule = args[0];

  var operations = extractOperations(args);

  systemBuilder.reset();

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
    operations.forEach(function (op) {
      operationPromise = operationPromise
        .then(function (curTree) {

          var operatorFunction = getOperatorFunc(op);
          var moduleName = op.moduleName;

            return expandGlob(moduleName)
              .then(function(modules){
                var p = Promise.resolve(curTree);
                modules.forEach(function(module){
                    p = p.then(function(_curTree){
                      return  systemBuilder.trace(module)
                        .then(function(nextTrace){
                           return operatorFunction(_curTree, nextTrace.tree);
                        });
                    });
                });
                return p;
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
    var buildPath = path.relative(process.cwd(), fileName);
    var resolution = opts.lowResSourceMaps ? 'low-res ' : '';
    ui.log('ok', 'Built into `' + buildPath + '`' +
      (opts.sourceMaps ? ' with ' + resolution + 'source maps' : '') + ', ' +
      (opts.minify ? '' : 'un') + 'minified' + 
      (opts.minify ? (opts.mangle ? ', ' : ', un') + 'mangled.' : '.'));
  })
  .catch(function(e) {
    ui.log('err', e.stack || e);
    throw e;
  });
}

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
}

// options.minify, options.sourceMaps
exports.bundleSFX = function(moduleName, fileName, opts) {
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
  .then(config.save)
  .then(function() {
    ui.log('ok', 'Built into `' + path.relative(process.cwd(), fileName) + '`' + (opts.sourceMaps ? ' with source maps' : '') + ', ' + (opts.minify ? '' : 'un') + 'minified' + ', ' + (opts.mangle ? '' : 'un') + 'mangled.');
  })
  .catch(function(e) {
    ui.log('err', e.stack || e);
    throw e;
  });
}

function removeExistingSourceMap(fileName) {
  return asp(fs.unlink)(fileName + '.map')
  .catch(function(e) {
    if (e.code == 'ENOENT')
      return;
    throw e;
  });
}
