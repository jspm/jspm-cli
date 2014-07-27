var Promise = require('rsvp').Promise;
global.assert = require('assert');

var fs = require('graceful-fs');
var rimraf = require('rimraf');
var path = require('path');

var pkg = require('../lib/package');
var Package = pkg.Package;

global.jspm = require('../api');
global.ui = require('../lib/ui');
var config = require('../lib/config');

var tmpDir = path.resolve('test-tmp');

if (!fs.existsSync(tmpDir))
  fs.mkdirSync(tmpDir);

global.project = function(callback) {
  project.clearHandlers();
  config.loaded = false;
  rimraf(tmpDir, function(e) {
    fs.mkdirSync(tmpDir);
    process.chdir(tmpDir);
    callback();
  });
}

project.log = function(msg) {
  if (project.showLogs)
    console.log(msg);
}

project.showLogs = false;

project.clearHandlers = function() {
  inputHandlers = [];
  criticalInputHandlers = [];
  
  logHandlers = {
    err: [],
    info: [],
    ok: [],
    warn: []
  }
}

function applyHandler(msg) {
  var curHandler = this.shift();

  var args = [];
  msg = msg.replace(/(\`[^\`]+\`|\%[^\%]+\%)/g, function(match) {
    args.push(match.substr(1, match.length - 2));
    var c = match.substr(0, 1);
    return c + args.length + c;
  });

  arguments[0] = msg;
  arguments[arguments.length] = args;
  arguments.length++;

  return Promise.resolve(curHandler && curHandler.apply(null, arguments));
}

var currentInput;
var inputQueue = [];
function inputHandler(msg, def) {
  if (project.showInputs)
    console.log(msg + ' [' + def + ']');

  if (currentInput)
    return inputQueue.push([msg, def]);
  if (!inputHandlers.length && !def && !criticalInputHandlers.length)
    throw 'No CLI handler or default for: \n' + msg;

  return (currentInput = applyHandler.apply(inputHandlers.length || def ? inputHandlers : criticalInputHandlers, arguments))
  .then(function(val) {
    currentInput = null;
    if (inputQueue.length)
      inputHandler.apply(null, inputQueue.shift());
    return val || def; 
  });
}

ui.input = inputHandler;
ui.confirm = inputHandler;

var oldLog = ui.log;
ui.log = function(type, msg) {
  if (type == 'err' && !logHandlers.err.length) {
    oldLog.apply(this, arguments);
    throw new Error(msg);
  }

  if (logHandlers[type].length)
    applyHandler.call(logHandlers[type], msg);

  if (project.showLogs)
    oldLog.apply(this, arguments);
}

var inputHandlers = [];
project.addInputHandler = function(fn) {
  inputHandlers.push(fn);
}

var criticalInputHandlers = [];
project.addCriticalInputHandler = function(fn) {
  criticalInputHandlers.push(fn);
}


var logCnt = 0;
var logHandlers = {
  err: [],
  info: [],
  warn: [],
  ok: []
};
project.assertLog = function(type, msg, args) {
  logCnt++;
  logHandlers[type].push(function(_msg, _args) {
    if (msg)
      assert.equal(msg, _msg);
    if (args)
      assert.equal(args, _args);
    logCnt--;
  });
}
project.assertLogsCalled = function() {
  assert.equal(logCnt, 0);
}




project.registry = {};
pkg.locate = function(target) {
  if (target.endpoint)
    return Promise.resolve(target);

  if (!project.registry[target.name])
    throw 'No mock registry for ' + target.name;

  var p = new Package(project.registry[target.name]);
  p.setVersion(target.version);

  return Promise.resolve(p);
}
pkg.checkOverride = function(fullName, cdn) {
  return Promise.resolve();
}

project.versions = {};

pkg.loadEndpoint = function(endpoint) {
  return {
    getVersions: function(repo, callback, errback) {
      if (!project.versions[endpoint + ':' + repo])
        throw 'No project.versions["' + endpoint + ':' + repo + '"]';
      process.nextTick(function() {
        callback(project.versions[endpoint + ':' + repo]);
      });
    },
    download: function(repo, version, hash, outDir, callback, errback) {
      process.nextTick(function() {
        callback({});
      });
    }
  };
}



