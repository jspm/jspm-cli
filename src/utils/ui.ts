/*
 *   Copyright 2014-2019 Guy Bedford (http://guybedford.com)
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
import chalk from 'chalk';
import readline = require('readline');
import stream = require('stream');
import ora = require('ora');
import { isWindows } from './common';

let logging = true;
let logBuffer = '';
let errBuffer = '';
let logged = false;

class MutableStdout extends stream.Writable {
  public muted:boolean = false;
  _write (chunk, encoding, callback) {
    if (!this.muted)
      process.stdout.write(chunk, encoding);
    callback();
  }
}
const mutableStdout = new MutableStdout();

export enum LogType {
  none,
  err,
  warn,
  ok,
  info,
  debug,
  status,
};

export let logLevel = LogType.info;

// if muting any logs, dump them on exit
let inputRedact;
process.on('exit', () => {
  if (spinning && hiddenCnt === 0)
    spinner.clear();
  if (inputRedact) {
    console.log('');
    inputRedact();
  }
  if (logBuffer)
    process.stdout.write(logBuffer);
  if (errBuffer)
    process.stderr.write(errBuffer);
});

// use the default option in all prompts
// throws an error for prompts that don't take a default
export let useDefaults = false;
export function setUseDefaults (_useDefaults: boolean) {
  useDefaults = _useDefaults;
}

export function setLogLevel (level: LogType) {
  logLevel = level;
};

const format = {
  q (msg: string, opt?: string) {
    return moduleMsg(msg + (opt ? ' [' + opt + ']' : '') + ': ');
  },
  [LogType.err] (msg: string) {
    return chalk.red.bold('err ') + '(jspm) ' + moduleMsg(msg, false, false);
  },
  [LogType.info] (msg: string) {
    return '     ' + moduleMsg(msg, true);
  },
  [LogType.warn] (msg: string) {
    return chalk.yellow.bold('warn ') + '(jspm) ' + moduleMsg(msg, true);
  },
  [LogType.ok] (msg: string) {
    return chalk.green.bold('ok ') + moduleMsg(msg, true);
  },
  [LogType.debug] (msg: string) {
    return moduleMsg(msg, true);
  }
};

const spinner = ora({
  text: '',
  color: 'yellow',
  spinner: {
    interval: 200,
    frames: [
      ".   ",
      "..  ",
      "... ",
      " ...",
      "  ..",
      "   .",
      "    "
    ]
  }
});

let spinning = false;
export function startSpinner () {
  spinning = true;
  if (hiddenCnt === 0)
    spinner.start();
}
export function stopSpinner () {
  if (spinning && hiddenCnt === 0) {
    spinner.clear();
    spinner.stop();
    frameIndex = 0;
  }
  spinning = false;
}

let hiddenCnt = 0;
let frameIndex = 0;
function hideSpinner () {
  if (hiddenCnt++ === 0 && spinning && spinner.id) {
    frameIndex = spinner.frameIndex;
    spinner.clear();
    spinner.stop();
  }
}
function showSpinner () {
  if ((hiddenCnt === 0 || --hiddenCnt === 0) && spinning && !spinner.id) {
    spinner.frameIndex = frameIndex;
    spinner.start();
  }
}

export function logErr (msg: string) {
  logged = true;
  hideSpinner();
  if (logging)
    console.error(msg);
  else
    logBuffer += msg + '\n';
  showSpinner();
}

export function ok (msg: string) {
  log(msg, LogType.ok);
}
export function err (msg: string) {
  log(msg, LogType.err);
}
export function warn (msg: string) {
  log(msg, LogType.warn);
}
export function debug (msg: string) {
  log(msg, LogType.debug);
}
export function info (msg: string) {
  log(msg, LogType.info);
}

export function log (msg: string, type = LogType.info) {
  if (<LogType>type === LogType.status) {
    spinner.text = msg.substr(0, process.stdout.columns);
    return;
  }

  logged = true;
  
  if (type === undefined) {
    hideSpinner();
    if (logging)
      console.log(msg);
    else
      logBuffer += msg + '\n';
    showSpinner();
    return;
  }
  
  msg = format[type](msg);

  if (type <= logLevel) {
    hideSpinner();
    if (logging) {
      if (<LogType>type !== LogType.err)
        console.log(msg);
      else
        console.error(msg);
    }
    else {
      if (<LogType>type !== LogType.err)
        logBuffer += msg + '\n';
      else
        errBuffer += msg + '\n';
    }
    showSpinner();
  }
};

const ansiControlCodeRegEx = /(\x9B|\x1B\[)[0-?]*[ -\/]*[@-~]/g;
function wordWrap (text: string, columns: number, leftIndent = 0, rightIndent = 0, skipFirstLineIndent = false) {
  let leftSpaces = '';
  let i;

  for (i = 0; i < leftIndent; i++)
    leftSpaces += ' ';

  // simple word wrapping
  columns = columns - leftIndent - rightIndent;
  let output = [];
  let lastBreak = 0;
  let lastSpace = 0;
  let skipLength = 0; // skip control characters
  // carefully ensure underlines skip tab space added
  let underline = false;
  let underlineNext = false;
  for (i = 0; i < text.length; i++) {
    if (text[i] === '\x1b') {
      ansiControlCodeRegEx.lastIndex = i - 1;
      let controlCodeMatch = ansiControlCodeRegEx.exec(text);
      if (!controlCodeMatch) {
        skipLength = 1;
      }
      else {
        skipLength = controlCodeMatch[0].length;
        if (controlCodeMatch[0] === '\u001b[4m')
          underline = true;
        else if (controlCodeMatch[0] === '\u001b[24m')
          underline = false;
      }
      continue;
    }
    if (text[i] === ' ')
      lastSpace = i;

    // existing newline adds buffer
    if (text[i] === '\n') {
      lastSpace = i;
      output.push(
        (output.length === 0 && skipFirstLineIndent ? '' : leftSpaces) + 
        (underlineNext ? '\x1b[4m' : '') +
        text.substring(lastBreak, i) + 
        (underline ? ((underlineNext = true), '\x1b[24m') : ((underlineNext = false), '')) +
        '\n');
      lastSpace = i;
      lastBreak = i + 1;
      skipLength = 0;
    }

    // on expected breaking point
    else if ((i  - skipLength) !== lastBreak &&
          (i - lastBreak - skipLength) % columns === 0 &&
          lastSpace > lastBreak) {
      output.push(
        (output.length === 0 && skipFirstLineIndent ? '' : leftSpaces) + 
        (underlineNext ? '\x1b[4m' : '') +
        text.substring(lastBreak, lastSpace) + 
        (underline ? ((underlineNext = true), '\x1b[24m') : ((underlineNext = false), '')) +
        '\n');
      lastBreak = lastSpace + 1;
      skipLength = 0;
    }
  }
  output.push(
    (output.length === 0 && skipFirstLineIndent ? '' : leftSpaces) + 
    (underlineNext ? '\x1b[4m' : '') +
    text.substr(lastBreak));
  return output.join('');
}

function moduleMsg (msg: string, tab?, wrap?) {
  if (tab)
    msg = wordWrap(msg, process.stdout.columns + (isWindows ? -1 : 0), tab ? 5 : 0).substr(5);
  else if (wrap)
    msg = wordWrap(msg, process.stdout.columns + (isWindows ? -1 : 0));
  else
    msg.replace(/(\r?\n)/g, '$1     ');

  // formatting
  // msg.replace(/\t/g, '  ');
  return msg;
}

export interface ConfirmOptions {
  edit?: boolean,
  info?: string,
  silent?: boolean
};

let inputQueue = [];
export async function confirm (msg: string, def?: string | ConfirmOptions | boolean, options: ConfirmOptions = {}): Promise<boolean> {
  if (typeof def === 'object' && def !== null) {
    options = def;
    def = undefined;
  }

  let defText;
  if (def === true)
    defText = 'Yes';
  else if (def === false)
    defText = 'No';
  else
    def = undefined;

  if (useDefaults) {
    if (def === undefined)
      defText = 'Yes';
    hideSpinner();
    process.stdout.write(format.q(msg) + defText + '\n');
    showSpinner();
    return Promise.resolve(!!def);
  }

  let reply = await input(msg + (defText ? '' : ' [Yes/No]'), defText, {
    edit: options.edit,
    info: options.info,
    silent: options.silent,
    options: ['Yes', 'No']
  });

  if (reply == 'Yes')
    return true;
  if (reply == 'No')
    return false;
  
  return confirm(msg, def, options);
};

let inputFunc = _key => {};
process.stdin.on('keypress', (_chunk, key) => {
  inputFunc(key);
});

export interface InputOptions extends ConfirmOptions {
  options?: string[],
  clearOnType?: boolean,
  hideInfo?: boolean,
  completer?: (partialLine: string) => [string[], string],
  validate?: (input: string) => string | void,
  validationError?: string,
  optionalOptions?: boolean
}

export function input (msg: string, def: string | InputOptions, options: InputOptions = {}, queue: boolean = false): Promise<string> {
  if (typeof def === 'object' && def !== null) {
    options = def;
    def = undefined;
  }

  const defValue: string = <string>def;

  if (typeof options === 'boolean')
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

  options.completer = partialLine => {
    if (!partialLine.length || !options.options)
      return [[], partialLine];

    partialLine = partialLine.toLowerCase().trim();

    let hits = options.options.filter(c => c.toLowerCase().indexOf(partialLine) === 0);

    // we only return one option, to avoid printing out completions
    return [hits.length ? [hits[0]] : [], partialLine];
  };

  options = options || {};

  if (useDefaults) {
    process.stdout.write(format.q(msg) + (options.silent ? '' : defValue) + '\n');
    return Promise.resolve(defValue);
  }

  hideSpinner();

  return new Promise<string>((resolve, reject) => {
    if (!logging && !queue)
      return inputQueue.push({
        args: [msg, defValue, options, true],
        resolve: resolve,
        reject: reject
      });

    // if there is info text for this question, first write out the hint text below
    // then restore the cursor and write out the question
    let infoLines = 1;
    if (options.info || options.validationError) {
      let infoText = '\n';
      if (options.info)
        infoText += wordWrap(options.info, process.stdout.columns, 5, 5) + '\n';
      if (options.validationError)
        infoText += format[LogType.warn](wordWrap(options.validationError, process.stdout.columns, 0, 5)) + '\n';
      infoText += '\n';
      process.stdout.write(infoText);
      infoLines = infoText.split('\n').length;
    }
    if (!('hideInfo' in options))
      options.hideInfo = true;

    if (logging && logged)
      process.stdout.write('\n');
    logging = false;

    let rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true,
      completer: options.completer
    });

    let questionMessage = format.q(msg, defValue && !options.edit ? defValue : '');
    infoLines += questionMessage.split('\n').length - 1;

    if (options.options)
      var ctrlOpt = new CtrlOption(options.options, rl);
    if (!options.edit)
      inputFunc = key => {
        if (!key)
          return;
        let i;
        if (options.clearOnType && key.name !== 'return' && key.name !== 'backspace' && key.name !== 'left') {
          // this actually works, which was rather unexpected
          for (i = 0; i < (defValue || '').length; i++)
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
        else if (key.name === 'up' || key.name === 'down') {
          rl.write(null, { ctrl: true, name: 'u' });
          for (i = 0; i < defValue.length; i++)
            process.stdin.emit('keypress', defValue[i], { name: defValue[i] });
        }
      };

    rl.question(questionMessage, inputVal => {
      inputFunc = () => {};
      if (mutableStdout.muted)
        console.log('');
      rl.close();

      // run completions by default on enter when provided
      if (options.options && !options.optionalOptions)
        inputVal = options.completer(inputVal)[0][0] || '';

      inputVal = inputVal.trim();

      if (!options.edit)
        inputVal = inputVal || defValue;

      let retryErr;
      if (options.validate)
        retryErr = options.validate(inputVal);

      inputRedact(inputVal, !!retryErr, options.silent);
      inputRedact = null;
      mutableStdout.muted = false;

      if (retryErr)
        return input(msg, defValue, {
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
      let next = inputQueue.shift();
      if (next)
        input.apply(null, next.args).then(next.resolve, next.reject);
      else {
        process.stdout.write(logBuffer);
        process.stderr.write(errBuffer);
        logBuffer = '';
        errBuffer = '';
        logging = true;
        logged = false;
      }

      showSpinner();
      resolve(inputVal);
    });

    inputRedact = (inputVal, retry, silent) => {
      inputVal = inputVal || '';
      let inputText = !retry ? format.q(msg, !options.edit && defValue || '') + (silent ? '' : inputVal) + '\n' : '';
      // erase the help text, rewrite the question above, and begin the next question
      process.stdout.write('\x1b[' + (options.hideInfo || retry ? infoLines : 0) + 'A\x1b[J' + inputText);
    };

    mutableStdout.muted = false;

    if (options.silent)
      mutableStdout.muted = true;

    if (defValue && options.edit)
      rl.write(defValue);
  });
};

class CtrlOption {
  rl: any;
  options: string[];
  
  constructor (options: string[], rl) {
    this.options = options || [];
    this.rl = rl;
  }

  cursol = 0;
  
  moveUp () {
    let next = this.cursol + 1;
    this.cursol = (next >= this.options.length ) ? 0 : next;
    this.move();
  }
  moveDown () {
    let next = this.cursol - 1;
    this.cursol = (next === -1 ) ? (this.options.length - 1) : next;
    this.move();
  }
  move () {
    this.rl.write(null, { ctrl: true, name: 'u' });

    let input = this.options[this.cursol].split('');
    for (let idx in input)
      process.stdin.emit('keypress', input[idx], { name: input[idx] });
  }
}