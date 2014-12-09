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

// if storing any logs, dump them on exit
process.on('exit', function() {
  if (logBuffer && !apiResolver)
    console.log(logBuffer);
})

var cli = module.exports;

var apiResolver;
exports.setResolver = function(resolver) {
  apiResolver = resolver;
}

// use the default option in all prompts
// throws an error for prompts that don't take a default
var useDefaults;
exports.useDefaults = function() {
  useDefaults = true;
}


var logging = true;
var logBuffer = '';
var logged = false;
var log = exports.log = function(type, msg) {
  if (apiResolver)
    return apiResolver.emit('log', type, msg);

  logged = true;
  if (arguments.length == 1) {
    msg = type;
    type = null;
  }

  if (typeof(msg) !== 'string')
    msg = String(msg);

  if (type)
    msg = format[type](msg);

  if (logging)
    return console.log(msg);
  logBuffer += msg + '\n';
}

function moduleMsg(msg, color) {
  return (color || '\033[0m')
    + msg
      .replace(/(\s|\`|^)%([^%\n]+)%/g, '$1\033[1m$2\033[0m' + color || '')
      .replace(/(\s|^)\`([^\`\n]+)\`/g, '$1\033[36m$2\033[0m' + color || '')
      .replace(/\n\r?( {0,4}\w)/g, '\n     $1')
    + '\033[0m';
}
var format = exports.format = {
  q: function(msg, opt) {
    return moduleMsg(msg, '') + '' + (opt ? ' [' + opt + ']' : '') + '\033[39m:\033[0m ';
  },
  err: function(msg) {
    return '\n\033[31m\033[1merr  \033[0m' + moduleMsg(msg, '\033[0m');
  },
  info: function(msg) {
    return '     ' + moduleMsg(msg, '\033[0m');
  },
  warn: function(msg) {
    return '\n\033[33m\033[1mwarn \033[0m' + moduleMsg(msg, '\033[0m');
  },
  ok: function(msg) {
    return '\033[32m\033[1mok   \033[0m' + moduleMsg(msg, '\033[0m');
  }
};

var inputQueue = [];
var confirm = exports.confirm = function(msg, def) {
  if (useDefaults) {
    if (def !== true && def !== false)
      def = true;
    process.stdout.write(format.q(msg) + (def ? 'Yes' : 'No') + '\n');
    return Promise.resolve(def);
  }

  if (apiResolver) 
    return new Promise(function(resolve, reject) {
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
  if (useDefaults) {
    process.stdout.write(format.q(msg) + def + '\n');
    return Promise.resolve(def);
  }

  if (apiResolver)
    return new Promise(function(resolve, reject) {
      apiResolver.emit('prompt', {
        type: 'input',
        message: msg,
        default: def
      }, function(answer) {
        resolve(answer.input);
      });
    });

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

        resolve(inputVal.trim() || def);
      }
      inputVal += chunk;
    });

  });  
}