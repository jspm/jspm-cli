var ui = require('./ui');
var path = require('path');
var config = require('./config');
var systemBuilder = require('systemjs-builder');

//duplication from core **refactor out
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
//end duplication from core **refactor out

function extractOperations(args) {
  var operations = [];

  for (var i = 2; i < args.length - 1; i = i + 2) {
    var operator = args[i];
    var moduleName = args[i + 1];
    operations.push({"operator": operator, "moduleName": moduleName});
  }

  return operations;
}

function transformOperations(operations) {
  var verboseOperator, items = [];

  for (var i = 0; i < operations.length; i++) {
    var operator = operations[i].operator;
    if (operator === "-") {
      verboseOperator = systemBuilder.subtractTrees;
    } else if (operator === "+") {
      verboseOperator = systemBuilder.addTrees;
    }
    items.push({"operator": verboseOperator, "moduleName": operations[i].moduleName});
  }

  return items;
}

function arithmeticBundle(args, fileName) {
    if (["+", "-"].indexOf(fileName) != -1) {
      return Promise.resolve(ui.log('warn', 'Operator supplied without module name, please specify the module name after the operator'));
    }

    var moduleName = args[1];
    var operations = extractOperations(args);
    var items = transformOperations(operations);

    return config.load()
    .then(function() {
      config.main = moduleName || config.main;
      if (!config.main)
        return ui.input('No main entry point is provided, please specify the module to build', 'app/main').then(function(main) {
          config.main = main;
        });
    })
    .then(function() {
      ui.log('info', 'Building the single-file dependency tree for `' + config.main + '`...');
      setLocalPaths();

      var started = systemBuilder.trace(moduleName, config.curConfig)
      var operationPromise = Promise.resolve(started);
      items.forEach(function(op) {
          operationPromise = operationPromise
          .then(function(trace) {
              return systemBuilder.trace(op.moduleName).then(function(newTrace) {
                  if (trace.tree) {
                      return op.operator(trace.tree, newTrace.tree);
                  }
                  return op.operator(trace, newTrace.tree);
              });
          })
      });

      return operationPromise
      .then(function(tree) {
          return systemBuilder.buildTree(tree, fileName);
      });
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

function simpleBundle(args, fileName) {
    var moduleName = args[1];

    if (["+", "-"].indexOf(fileName) != -1) {
      return Promise.resolve(ui.log('warn', 'Operator supplied without module name, please specify the module name after the operator'));
    }

    return config.load()
      .then(function() {
        config.main = moduleName || config.main;
        if (!config.main)
          return ui.input('No main entry point is provided, please specify the module to build', 'app/main').then(function(main) {
            config.main = main;
          });
      })
      .then(function() {
        ui.log('info', 'Building the single-file dependency tree for `' + config.main + '`...');
        setLocalPaths();
        return systemBuilder.build(config.main, config.curConfig, fileName);
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

exports.bundle = function(args, fileName) {
  var args = args.split(' ');
  if (args.length < 1) {
      return Promise.resolve(ui.log('warn', 'No main entry point is provided, please specify the module to build'));
  } else if (args.length === 1) {
      return Promise.resolve(ui.log('warn', 'No filename provided, please specify the filename for the output file'));
  } else if (args.length === 2) {
      return simpleBundle(args, fileName);
  } else {
      return arithmeticBundle(args, fileName);
  }
}
