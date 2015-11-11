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
var inputRedact;
process.on('exit', function() {
  if (!apiResolver) {
    if (inputRedact) {
      console.log('');
      inputRedact();
    }
    if (logBuffer)
      process.stdout.write(logBuffer);
    if (errBuffer)
      process.stderr.write(errBuffer);
    console.log('');
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
    return moduleMsg(msg + (opt ? ' [' + opt + ']' : '') + ': ');
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

function highlight(text) {
  return text
    .replace(/([\s\`\(\)]|^)%([^%]+)%/g, '$1' + chalk.bold('$2'))
    .replace(/([\s\`\(\)]|^)\`([^\`]+)\`/g, '$1' + chalk.cyan('$2'))
    .replace(/\t/g, '  ');
}

function wordWrap(text, leftIndent, rightIndent) {
  leftIndent = leftIndent || 0;
  rightIndent = rightIndent || 0;

  var leftSpaces = '';
  var i;

  for (i = 0; i < leftIndent; i++)
    leftSpaces += ' ';

  // simple word wrapping
  var columns = process.stdout.columns - leftIndent - rightIndent;
  var lines = [];
  var lastBreak = 0;
  var lastSpace = 0;
  var skipLength = 0; // skip control characters
  for (i = 0; i < text.length; i++) {
    if (text[i] == '`' || text[i] == '%') {
      skipLength++;
      continue;
    }
    if (text[i] == ' ')
      lastSpace = i;
    if ((i  - skipLength) != lastBreak && (i - lastBreak - skipLength) % columns == 0 && text[i + 1] != '\n') {
      if (lastSpace <= lastBreak)
        lastSpace = lastBreak + columns + skipLength;
      var line = text.substring(lastBreak, lastSpace + 1);
      lines.push(line);
      lastBreak = lastSpace + 1;
      skipLength = 0;
    }
    else if (text[i] == '\n') {
      lines.push(text.substring(lastBreak, i));
      lastBreak = lastSpace = ++i;
      skipLength = 0;
      if (text[i] == '\n')
        i--;
    }
  }
  lines.push(text.substr(lastBreak));
  return leftSpaces + lines.join('\n' + leftSpaces);
}

function moduleMsg(msg, tab) {
  if (tab)
    msg = wordWrap(msg, tab ? 5 : 0).substr(5);
  else
    msg = wordWrap(msg);

  // formatting
  return highlight(msg);
}

var inputQueue = [];
var confirm = exports.confirm = function(msg, def, options) {
  if (typeof def == 'object') {
    options = def;
    def = undefined;
  }
  options = options || {};

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

  var defText = 'Yes/No';
  if (def === true)
    defText = 'Yes';
  else if (def === false)
    defText = 'No';
  else
    def = undefined;

  return cli.input(msg + ' [' + defText + ']', {
    edit: options.edit,
    info: options.info,
    silent: options.silent,
    options: ['Yes', 'No']
  })
  .then(function(reply) {
    if (reply == 'Yes')
      return true;
    if (reply == 'No')
      return false;
    return confirm(msg, def, options);
  });
};

exports.input = function(msg, def, options, queue) {
  if (typeof def == 'object') {
    options = def;
    def = undefined;
  }
  options = options || {};
  if (typeof options == 'boolean')
    options = {
      silent: true,
      edit: false,
      info: undefined,
      completer: undefined,
      validate: undefined,
      validationError: undefined
    };

  options.completer = function(partialLine) {
    if (!partialLine.length || !options.options)
      return [[], partialLine];
    
    partialLine = partialLine.toLowerCase().trim();

    var hits = options.options.filter(function(c) {
      return c.toLowerCase().indexOf(partialLine) == 0;
    });

    // we only return one option, to avoid printing out completions
    return [hits.length ? [hits[0]] : [], partialLine];
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

    // if there is info text for this question, first write out the hint text below
    // then restore the cursor and write out the question
    var infoLines = 1;
    if (options.info || options.validationError) {
      var infoText = '\n';
      if (options.info)
        infoText += highlight(wordWrap(options.info, 5, 5)) + '\n';
      if (options.validationError)
        infoText += format.warn(wordWrap(options.validationError, 0, 5)) + '\n';
      infoText += '\n';
      process.stdout.write(infoText);
      infoLines = infoText.split('\n').length;
    }

    if (logging && logged)
      process.stdout.write('\n');
    logging = false;
    
    var rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true,
      completer: options.completer
    });

    var questionMessage = format.q(msg, !options.edit && def || '');
    infoLines += questionMessage.split('\n').length - 1;

    rl.question(questionMessage, function(inputVal) {
      if (mutableStdout.muted)
        console.log('');
      rl.close();

      // run completions by default on enter when provided
      if (options.options)
        inputVal = options.completer(inputVal)[0][0] || '';

      inputVal = inputVal.trim();

      if (!options.edit)
        inputVal = inputVal || def;

      var retryErr;
      if (options.validate)
        retryErr = options.validate(inputVal);

      inputRedact(inputVal, !!retryErr);
      inputRedact = null;

      if (retryErr)
        return cli.input(msg, def, {
          info: options.info,
          silent: options.silent,
          edit: options.edit,
          completer: options.completer,
          validate: options.validate,
          validationError: retryErr
        }, true).then(resolve, reject);

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

      resolve(inputVal);
    });

    inputRedact = function(inputVal, retry) {
      inputVal = inputVal || '';
      var inputText = !retry ? format.q(msg, !options.edit && def || '') + inputVal + '\n' : '';
      // erase the help text, rewrite the question above, and begin the next question
      process.stdout.write('\033[' + infoLines + 'A\033[J' + inputText);
    };

    mutableStdout.muted = false;

    if (options.silent)
      mutableStdout.muted = true;

    if (def && options.edit)
      rl.write(def);
  });
};
