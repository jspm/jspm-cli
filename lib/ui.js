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

var Promise = require('rsvp').Promise;
var chalk = require('chalk');

var apiResolver;
var logging = true;

var logBuffer = '';
var errBuffer = '';

var logged = false;
var cli = module.exports;

var ui = exports;

var readline = require('readline');

var Writable = require('stream').Writable;

function MutableStdout(opts) {
  Writable.call(this, opts);
}
MutableStdout.prototype = Object.create(Writable.prototype);
MutableStdout.prototype._write = function(chunk, encoding, callback) {
  if (!this.muted)
    process.stdout.write(chunk, encoding);
  callback();
};

var mutableStdout = new MutableStdout();

ui.logLevel = 3; // corresponds to 'info'
var logTypes = ['err', 'warn', 'ok', 'info', 'debug'];

// if storing any logs, dump them on exit
process.on('exit', function() {
  if (!apiResolver) {
    if (logBuffer)
      process.stdout.write(logBuffer);
    if (errBuffer)
      process.stderr.write(errBuffer);
  }
});

exports.setResolver = function(resolver) {
  apiResolver = resolver;
};

// use the default option in all prompts
// throws an error for prompts that don't take a default
var useDefaults;
exports.useDefaults = function(_useDefaults) {
  if (_useDefaults === undefined)
    _useDefaults = true;
  useDefaults = _useDefaults;
};

exports.setLogLevel = function(level) {
  if (!level)
    return;

  var levelIndex = logTypes.indexOf(level);

  if (levelIndex == -1)
    ui.log('warn', 'Unknown log level: ' + level);
  else
    ui.logLevel = levelIndex;
};

var format = exports.format = {
  q: function(msg, opt) {
    return moduleMsg(msg + '' + (opt ? ' [' + opt + ']' : '') + ': ');
  },
  err: function(msg) {
    return '\n' + chalk.red.bold('err  ') + moduleMsg(msg, true);
  },
  info: function(msg) {
    return '     ' + moduleMsg(msg, true);
  },
  warn: function(msg) {
    return '\n' + chalk.yellow.bold('warn ') + moduleMsg(msg, true);
  },
  ok: function(msg) {
    return chalk.green.bold('ok   ') + moduleMsg(msg, true);
  }
};

exports.log = function(type, msg) {
  if (apiResolver)
    return apiResolver.emit('log', type, msg);

  logged = true;
  
  if (arguments.length === 1) {
    msg = type;
    type = null;
  }
  
  msg = msg || '';

  msg = msg.toString();

  if (type)
    msg = format[type](msg.toString());

  var logLevel = logTypes.indexOf(type);
  if (logLevel == -1)
    logLevel = 3;
  if (logLevel <= ui.logLevel) {
    if (logging) {
      if (type != 'err')
        console.log(msg);
      else
        console.error(msg);
    }
    else {
      if (type != 'err')
        logBuffer += msg + '\n';
      else
        errBuffer += msg + '\n';
    }
  }
};

function moduleMsg(msg, tab) {
  // simple word wrapping
  var columns = process.stdout.columns - (tab ? 5 : 0);
  var lines = [];
  var lastBreak = 0;
  var lastSpace = 0;
  for (var i = 0; i < msg.length; i++) {
    if (msg[i] == ' ')
      lastSpace = i;
    if (i != lastBreak && (i - lastBreak) % columns == 0) {
      if (lastSpace == lastBreak)
        lastSpace = lastBreak + columns;
      var line = msg.substring(lastBreak, lastSpace);
      lines.push(line);
      lastBreak = lastSpace + 1;
    }
    if (msg[i] == '\n') {
      lines.push(msg.substring(lastBreak, i));
      lastBreak = lastSpace = ++i;
    }
  }
  lines.push(msg.substr(lastBreak));
  msg = lines.join('\n');

  // tab alignment
  if (tab)
    msg = msg
      .replace(/\n\r?( {0,4}[^\s])/g, '\n     $1')
      .replace(/\n\r?\t?( {0,4}[^\s])/g, '\n     $1');

  // formatting
  return msg
    .replace(/(\s|\`|^)%([^%\n]+)%/g, '$1' + chalk.bold('$2'))
    .replace(/(\s|^)\`([^\`\n]+)\`/g, '$1' + chalk.cyan('$2'))    
    .replace(/\t/g, '  ');
}

var inputQueue = [];
var confirm = exports.confirm = function(msg, def) {
  if (useDefaults) {
    if (def !== true && def !== false)
      def = true;
    process.stdout.write(format.q(msg) + (def ? 'Yes' : 'No') + '\n');
    return Promise.resolve(def);
  }

  if (apiResolver)
    return new Promise(function(resolve) {
      apiResolver.emit('prompt', {
        type: 'confirm',
        message: msg,
        default: def
      }, function(answer) {
        resolve(answer);
      });
    });

  var defText = 'y/n';
  if (def === true)
    defText = 'yes';
  else if (def === false)
    defText = 'no';
  else
    def = undefined;

  var p = cli.input(msg, defText);
  return p.then(function(reply) {
    if (reply.match(/\b(no|n)\b/i))
      return false;
    else if (reply.match(/\b(yes|y\b)/i))
      return true;
    else if (def !== undefined)
      return def;
    else
      return confirm(msg, def);
  });
};

exports.input = function(msg, def, options, queue) {
  options = options || {};
  if (typeof options == 'boolean')
    options = {
      silent: true,
      edit: false,
      completer: undefined
    };

  if (options.completions)
    options.completer = function(partialLine) {
      var hits = options.completions.filter(function(c) {
        return c.indexOf(partialLine) == 0;
      });
      return [hits.length ? hits : options.completions, partialLine];
    };

  options = options || {};

  if (useDefaults) {
    process.stdout.write(format.q(msg) + def + '\n');
    return Promise.resolve(def);
  }

  if (apiResolver)
    return new Promise(function(resolve) {
      apiResolver.emit('prompt', {
        type: 'input',
        message: msg,
        default: def
      }, function(answer) {
        resolve(answer.input);
      });
    });

  return new Promise(function(resolve, reject) {
    if (!logging && !queue)
      return inputQueue.push({
        args: [msg, def, options, true],
        resolve: resolve,
        reject: reject
      });

    if (logging && logged)
      process.stdout.write('\n');
    logging = false;
    
    var rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true,
      completer: options.completer
    });

    mutableStdout.muted = false;
    rl.question(format.q(msg, !options.edit && def || ''), function(inputVal) {
      if (mutableStdout.muted)
        console.log('');
      rl.close();

      // bump the input queue
      var next = inputQueue.shift();
      if (next)
        cli.input.apply(null, next.args).then(next.resolve, next.reject);
      else {
        process.stdout.write(logBuffer);
        process.stderr.write(errBuffer);
        logBuffer = '';
        errBuffer = '';
        logging = true;
        logged = false;
      }

      resolve(inputVal.trim() || def);
    });

    if (options.silent)
      mutableStdout.muted = true;

    if (def && options.edit)
      rl.write(def);
  });
};
