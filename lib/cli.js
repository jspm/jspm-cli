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

var Promise = require('rsvp').Promise;

process.on('uncaughtException', function(err) {
  log('err', err.stack || err);
});

// if storing any logs, dump them on exit
process.on('exit', function() {
  if (logBuffer)
    console.log(logBuffer);
})

var cli = module.exports;

var logging = true;
var logBuffer = '';
var logged = false;
var log = exports.log = function(type, msg) {
  if (logged == false)
    process.stdout.write('\n');
  logged = true;
  if (arguments.length == 1) {
    msg = type;
    type = null;
  }
  if (type)
    msg = format[type](msg);

  if (logging)
    return console.log(msg);
  logBuffer += msg + '\n';
}

function moduleMsg(msg, color) {
  return (color || '\033[0m')
    + msg
      .replace(/(\s|^)%([^%\n]+)%/g, '$1\033[1m$2\033[0m' + color || '')
      .replace(/(\s|^)\`([^\`\n]+)\`/g, '$1\033[36m$2\033[0m' + color || '')
      .replace(/\n\r?( {0,4}\w)/g, '\n     $1')
    + '\033[0m';
}
var format = exports.format = {
  q: function(msg, opt) {
    return moduleMsg(msg, '') + '\033[90m' + (opt ? ' [' + opt + ']' : '') + '\033[39m:\033[0m ';
  },
  err: function(msg) {
    return '\n\033[31m\033[1merr  \033[0m' + moduleMsg(msg, '\033[90m');
  },
  info: function(msg) {
    return '     ' + moduleMsg(msg, '\033[90m');
  },
  warn: function(msg) {
    return '\n\033[33m\033[1mwarn \033[0m' + moduleMsg(msg, '\033[90m');
  },
  ok: function(msg) {
    return '\033[32m\033[1mok   \033[0m' + moduleMsg(msg, '\033[90m');
  }
};

var inputQueue = [];
var confirm = exports.confirm = function(msg, def) {
  var defText = 'y/n';
  if (def === true)
    defText = 'yes';
  else if (def === false)
    defText = 'no';
  else
    def = undefined;

  var p = cli.input(msg, defText);
  return p.then(function(reply) {
    if (reply.match(/^\b(no|n)\b$/i))
      return false;
    else if (reply.match(/^\b(yes|y\b)$/i))
      return true;
    else if (def !== undefined)
      return def;
    else
      return confirm(msg, def);
  });
}

exports.input = function(msg, def, disableOutput, queue) {
  if (arguments.length == 2)
    disableOutput = false;
  return new Promise(function(resolve, reject) {
    if (!logging && !queue)
      return inputQueue.push({
        args: [msg, def, disableOutput, true],
        resolve: resolve, 
        reject: reject
      });

    if (logging && logged)
      process.stdout.write('\n');
    logging = false;
    process.stdout.write(format.q(msg, def));
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(disableOutput);
    var inputVal = '';
    process.stdin.on('data', function(chunk) {
      var lastChar = chunk.substr(chunk.length - 1, 1);
      if (lastChar == '\n' || lastChar == '\r' || lastChar == '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeAllListeners('data');
        inputVal += chunk.substr(0, chunk.length - 1);

        // bump the input queue
        var next = inputQueue.shift();
        if (next)
          cli.input.apply(null, next.args).then(next.resolve, next.reject);
        else {
          process.stdout.write(logBuffer);
          logBuffer = '';
          logging = true;
          logged = false;
        }

        resolve(inputVal || def);
      }
      inputVal += chunk;
    });

  });  
}


exports.readOptions = function(args, flags, settings) {
  settings = settings || [];
  var argOptions = { args: [] };
  for (var i = 0; i < args.length; i++) {
    if (args[i].substr(0, 2) == '--') {
      for (var j = 0; j < flags.length; j++)
        if (flags[j] == args[i])
          argOptions[flags[j].substr(2)] = i;
      for (var j = 0; j < settings.length; j++)
        if (settings[j] == args[i])
          argOptions[settings[j].substr(2)] = args[++i];
    }
    else if (args[i].substr(0, 1) == '-') {
      var opts = args[i].substr(1);
      for (var j = 0; j < opts.length; j++) {
        for (var k = 0; k < flags.length; k++) {
          if (flags[k].substr(2, 1) == opts[j])
            argOptions[flags[k].substr(2)] = argOptions.args.length;
        }
      }
    }
    else
      argOptions.args.push(args[i]);
  }
  return argOptions;
}