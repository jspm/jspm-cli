/*
 *   Copyright 2014-2016 Guy Bedford (http://guybedford.com)
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

var chalk = require('chalk');

var apiResolver;
var logging = true;

var logBuffer = '';
var errBuffer = '';

var logged = false;
var cli = module.exports;
var Promise = require('bluebird');

var ui = exports;

var readline = require('readline');

var Writable = require('stream').Writable;

var isWin = require('./common').isWin;

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
    return '\n' + chalk.red.bold('err  ') + moduleMsg(msg, false, false);
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
    msg = (format[type] || format.info)(msg.toString());

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

function isControlTerminateChar(c, control) {
  var formatChars = ['%', '`', '_'];
  formatChars.splice(formatChars.indexOf(control), 1);
  return !c || ('\r\n ,.:?' + formatChars.join('')).indexOf(c) != -1;
}

function highlight(text) {
  text = text.replace(/([\s\`\(]|^)%([^%]+)%/g, function(match, prefix, capture, index) {
    if (isControlTerminateChar(text[index + match.length], '%'))
      return match.replace('%' + capture + '%', chalk.bold(capture));
    else
      return match;
  });
  text = text.replace(/([\s\`\(]|^)\`([^\`]+)\`/g, function(match, prefix, capture, index) {
    if (isControlTerminateChar(text[index + match.length], '`'))
      return match.replace('`' + capture + '`', chalk.cyan(capture));
    else
      return match;
  });
  text = text.replace(/([\s\`\%]|^)\_([^\_]+)\_/g, function(match, prefix, capture, index) {
    if (isControlTerminateChar(text[index + match.length], '_'))
      return match.replace('_' + capture + '_', chalk.underline(capture));
    else
      return match;
  });
  return text.replace(/\t/g, '  ');
}

exports.wordWrap = wordWrap;
function wordWrap(text, columns, leftIndent, rightIndent, skipFirstLineIndent) {
  leftIndent = leftIndent || 0;
  rightIndent = rightIndent || 0;

  var leftSpaces = '';
  var i;

  for (i = 0; i < leftIndent; i++)
    leftSpaces += ' ';

  // simple word wrapping
  columns = columns - leftIndent - rightIndent;
  var output = [];
  var lastBreak = 0;
  var lastSpace = 0;
  var skipLength = 0; // skip control characters
  var controlStart = false;
  for (i = 0; i < text.length; i++) {
    if (text[i] == '`' || text[i] == '%' || text[i] == '_') {
      if (controlStart && isControlTerminateChar(text[i + 1], text[i])) {
        controlStart = false;
        skipLength++;
        continue;
      }
      else if (lastBreak == lastSpace || !text[i - 1] || (' `.,:?' + (text[i] == '_' ? '%' : '(')).indexOf(text[i - 1]) != -1) {
        controlStart = true;
        skipLength++;
        continue;
      }
    }
    if (text[i] == ' ')
      lastSpace = i;

    // existing newline adds buffer
    if (text[i] == '\n') {
      lastSpace = i;
      output.push((output.length == 0 && skipFirstLineIndent ? '' : leftSpaces) + text.substring(lastBreak, i) + '\n');
      lastSpace = i;
      lastBreak = i + 1;
      skipLength = 0;
    }

    // on expected breaking point
    else if ((i  - skipLength) != lastBreak &&
          (i - lastBreak - skipLength) % columns == 0 &&
          lastSpace > lastBreak) {
      output.push((output.length == 0 && skipFirstLineIndent ? '' : leftSpaces) + text.substring(lastBreak, lastSpace) + '\n');
      lastBreak = lastSpace + 1;
      skipLength = 0;
    }
  }
  output.push((output.length == 0 && skipFirstLineIndent ? '' : leftSpaces) + text.substr(lastBreak));
  return output.join('');
}

function moduleMsg(msg, tab, wrap) {
  if (tab)
    msg = wordWrap(msg, process.stdout.columns + (isWin ? -1 : 0), tab ? 5 : 0).substr(5);
  else if (wrap)
    msg = wordWrap(msg, process.stdout.columns + (isWin ? -1 : 0));

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

  if (apiResolver) {
    if (useDefaults) {
      apiResolver.emit('prompt', {
        type: 'confirm',
        message: msg,
        default: def
      });
      return Promise.resolve(!!def);
    }
    else {
      return new Promise(function(resolve) {
        apiResolver.emit('prompt', {
          type: 'confirm',
          message: msg,
          default: def
        }, function(answer) {
          resolve(answer);
        });
      });
    }
  }

  var defText;
  if (def === true)
    defText = 'Yes';
  else if (def === false)
    defText = 'No';
  else
    def = undefined;

  if (useDefaults) {
    if (def === undefined)
      defText = 'Yes';
    process.stdout.write(format.q(msg) + defText + '\n');
    return Promise.resolve(!!def);
  }

  return cli.input(msg + (defText ? '' : ' [Yes/No]'), defText, {
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

var inputFunc = function() {};
process.stdin.on('keypress', function(chunk, key) {
  inputFunc(key);
});

exports.input = function(msg, def, options, queue) {
  if (typeof def == 'object' && def !== null) {
    options = def;
    def = undefined;
  }
  options = options || {};
  if (typeof options == 'boolean')
    options = {
      silent: true,
      edit: false,
      clearOnType: false,
      info: undefined,
      hideInfo: true,
      completer: undefined,
      validate: undefined,
      validationError: undefined,
      optionalOptions: false
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
        infoText += highlight(wordWrap(options.info, process.stdout.columns, 5, 5)) + '\n';
      if (options.validationError)
        infoText += format.warn(wordWrap(options.validationError, process.stdout.columns, 0, 5)) + '\n';
      infoText += '\n';
      process.stdout.write(infoText);
      infoLines = infoText.split('\n').length;
    }
    if (!('hideInfo' in options))
      options.hideInfo = true;

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

    if (options.options)
      var ctrlOpt = new CtrlOption(options.options, rl);
    if (!options.edit)
      inputFunc = function(key) {
        if (!key)
          return;
        var i;
        if (options.clearOnType && key.name != 'return' && key.name != 'backspace' && key.name != 'left') {
          // this actually works, which was rather unexpected
          for (i = 0; i < (def || '').length; i++)
            process.stdin.emit('keypress', '\b', { name: 'backspace' });
        }
        // allow scrolling through default options
        if (ctrlOpt) {
          if (key.name === 'up')
            ctrlOpt.moveUp();
          if (key.name === 'down')
            ctrlOpt.moveDown();
        }
        // for no default options, allow backtracking to default
        else if (key.name == 'up' || key.name == 'down') {
          rl.write(null, { ctrl: true, name: 'u' });
          for (i = 0; i < def.length; i++)
            process.stdin.emit('keypress', def[i], { name: def[i] });
        }
      };

    rl.question(questionMessage, function(inputVal) {
      inputFunc = function() {};
      if (mutableStdout.muted)
        console.log('');
      rl.close();

      // run completions by default on enter when provided
      if (options.options && !options.optionalOptions)
        inputVal = options.completer(inputVal)[0][0] || '';

      inputVal = inputVal.trim();

      if (!options.edit)
        inputVal = inputVal || def;

      var retryErr;
      if (options.validate)
        retryErr = options.validate(inputVal);

      inputRedact(inputVal, !!retryErr, options.silent);
      inputRedact = null;
      mutableStdout.muted = false;

      if (retryErr)
        return cli.input(msg, def, {
          info: options.info,
          silent: options.silent,
          edit: options.edit,
          clearOnType: options.clearOnType,
          completer: options.completer,
          validate: options.validate,
          validationError: retryErr.toString(),
          optionalOptions: options.optionalOptions,
          hideInfo: options.hideInfo
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

    inputRedact = function(inputVal, retry, silent) {
      inputVal = inputVal || '';
      var inputText = !retry ? format.q(msg, !options.edit && def || '') + (silent ? '' : inputVal) + '\n' : '';
      // erase the help text, rewrite the question above, and begin the next question
      process.stdout.write('\033[' + (options.hideInfo || retry ? infoLines : 0) + 'A\033[J' + inputText);
    };

    mutableStdout.muted = false;

    if (options.silent)
      mutableStdout.muted = true;

    if (def && options.edit)
      rl.write(def);
  });
};

function CtrlOption(options, rl) {
  this.options = options || {};
  this.rl = rl;
}
CtrlOption.prototype = {
  cursol: 0,
  moveUp: function(){
      var next = this.cursol + 1;
      this.cursol = (next >= this.options.length ) ? 0 : next;
      this.move();
  },
  moveDown: function(){
      var next = this.cursol - 1;
      this.cursol = (next === -1 ) ? (this.options.length - 1) : next ;
      this.move();
  },
  move: function() {
    this.rl.write(null, {ctrl: true, name: 'u'});

    var input = this.options[this.cursol].split('');
    for (var idx in input)
      process.stdin.emit('keypress', input[idx], { name: input[idx] });
  },
};
