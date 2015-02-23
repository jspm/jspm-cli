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
var systemBuilder = new Builder();
var fs = require('fs');
var asp = require('rsvp').denodeify;
var glob = require('glob');

exports.depCache = function (moduleName) {
  return config.load()
    .then(function () {
      moduleName = moduleName || config.loader.main;
    })
    .then(function () {
      ui.log('info', 'Injecting the traced dependency tree for `' + moduleName + '`...');

      // trace the starting module
      var cfg = config.loader.getConfig();
      cfg.baseURL = path.relative(process.cwd(), config.pjson.baseURL);

      return systemBuilder.trace(moduleName, cfg);
    })
    .then(function (output) {
      var traceTree = output.tree;
      moduleName = output.moduleName;
      var depCache = config.loader.depCache = config.loader.depCache || {};
      for (var d in traceTree) {
        var deps = traceTree[d].deps.map(function (dep) {
          return traceTree[d].depMap[dep];
        });

        if (deps.length)
          depCache[d] = deps;
      }
    })
    .then(config.save)
    .then(function () {
      ui.log('ok', 'Depenency tree injected');
    })
    .catch(function (e) {
      ui.log('err', e.stack || e);
    });
};

function extractOperations(args) {
  var i;
  var operations = [];
  var seq = expandGlob(args[0])
    .then(function (moduleNames) {
      moduleNames.forEach(function (mn) {
        operations.push({
          moduleName: mn,
          operator: '+'
        });
      });
    });

  for (i = 1; i < args.length - 1; i += 2) {
    seq = (function (name, operator) {
      return seq.then(function () {
        return expandGlob(name)
          .then(function (moduleNames) {
            moduleNames.forEach(function (mn) {
              operations.push({
                moduleName: mn,
                operator: operator
              });
            });
          });
      });
    })(args[i + 1], args[i]);
  }

  seq = seq.then(function () {
    return operations;
  });

  return seq;
}

function extractBundleName(fileName) {
  return path.relative(config.pjson.baseURL, fileName.replace(/\.js$/, '')).replace(/\\/g, '/');
}

function getModuleName(file) {
  var baseURL = config.pjson.baseURL + '/';
  var paths = systemBuilder.loader.paths;

  var id = '';
  var matchLength = 0;

  for (rule in paths) {
    var resolvedPath = path.resolve(baseURL, paths[rule]).replace(/\\/g, '/'); // replace  '\' with  '/'
    var pathDir = path.dirname(resolvedPath); // find the the directory of the path.
    var fileDir = path.dirname(file); // find the file's directory.
    var pathLength = pathDir.split('/').length;

    var regex = new RegExp('^' + pathDir, 'i');

    if (regex.test(fileDir) && matchLength < pathLength) {
      var parts = rule.split('*');
      var moduleName = file.replace(regex, '').replace(/^\//, '').replace(/\.js$/, '');
      id = parts[0] + moduleName;
      matchLength = pathLength;
    }
  }

  if (id === '') {
    throw new Error('No matching path defined for file: ' + "'" + file + "'");
  }
  return id;
  path.resolve(baseURL, paths[rule]).replace(/\\/g, '/')
}

function expandGlob(moduleName) {
  var loader = systemBuilder.loader;
  return loader.normalize(moduleName)
    .then(function (normalized) {
      return loader.locate({name: normalized});
    })
    .then(function (address) {
      var normalizedAddress = path.normalize(address).replace(/\\/g, '/').replace(/^file:/, '');
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
exports.bundle = function (moduleExpression, fileName, opts) {
  var args = moduleExpression.split(' ');
  var operations = [];
  var cfg;

  systemBuilder.reset();


  return config.load()
    .then(function () {
      cfg = config.loader.getConfig();
      cfg.baseURL = path.relative(process.cwd(), config.pjson.baseURL);
      systemBuilder.config(cfg);

      ui.log('info', 'Extracting operations for `' + moduleExpression + '`...');

      return extractOperations(args)
        .then(function (_operations) {
          operations = _operations;
        });
    })
    .then(function () {
      fileName = fileName || path.resolve(config.pjson.baseURL, 'build.js');

      if (!opts.sourceMaps)
        return removeExistingSourceMap(fileName);
    })
    .then(function () {
      ui.log('info', 'Building the bundle tree for `' + moduleExpression + '`...');

      // trace the starting module

      var firstModule = operations[0].moduleName;
      return systemBuilder.trace(firstModule, cfg);
    })
    .then(function (trace) {

      // if there are no other operations, then we have the final tree
      if (!operations.length)
        return trace.tree;

      // chain the operations, applying them with the trace of the next module
      var operationPromise = Promise.resolve(trace.tree);
      operations.forEach(function (op) {
        operationPromise = operationPromise
          .then(function (curTree) {
            return systemBuilder.trace(op.moduleName)
              .then(function (nextTrace) {
                var operatorFunction = getOperatorFunc(op);
                return operatorFunction(curTree, nextTrace.tree);
              });
          });
      });

      return operationPromise;
    })
    .then(function (buildTree) {
      if (opts.inject) {
        // Add the bundle to config if the inject flag was given.
        var bundleName = extractBundleName(fileName);
        if (!config.loader.bundles) {
          config.loader.bundles = {};
        }
        config.loader.bundles[bundleName] = Object.keys(buildTree).filter(function (moduleName) {
          return buildTree[moduleName].metadata.build !== false;
        });
        ui.log('ok', '`' + bundleName + '` added to config bundles.');
      }
      if (!('lowResSourceMaps' in opts))
        opts.lowResSourceMaps = true;
      return systemBuilder.buildTree(buildTree, fileName, opts);
    })
    .then(function () {
      delete config.loader.depCache;
    })
    .then(config.save)
    .then(function () {
      logBuild(path.relative(process.cwd(), fileName), opts);
    })
    .catch(function (e) {
      ui.log('err', e.stack || e);
      throw e;
    });
};

exports.unbundle = function () {
  return config.load()
    .then(function () {
      config.loader.bundles = {};
      config.loader.depCache = {};
      return config.save();
    })
    .then(function () {
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
exports.bundleSFX = function (moduleName, fileName, opts) {
  return config.load()
    .then(function () {
      fileName = fileName || path.resolve(config.pjson.baseURL, 'build.js');

      if (!opts.sourceMaps)
        return removeExistingSourceMap(fileName);
    })
    .then(function () {
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
    .then(function () {
      logBuild(path.relative(process.cwd(), fileName), opts);
    })
    .catch(function (e) {
      ui.log('err', e.stack || e);
      throw e;
    });
};

function removeExistingSourceMap(fileName) {
  return asp(fs.unlink)(fileName + '.map')
    .catch(function (e) {
      if (e.code == 'ENOENT')
        return;
      throw e;
    });
}
