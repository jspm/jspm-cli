/*
 *   Copyright 2014-2017 Guy Bedford (http://guybedford.com)
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
import { bold, JspmUserError } from './common';

// takes commandline args, space-separated
// flags is array of flag names
// optFlags is array of flags that have option values
// optFlags suck up arguments until next flag
// returns { options: { [flag]: true / false, ..., [optFlag]: value, ...}, args: [all non-flag args] }
export function readOptions (inArgs: string[], flags: string[], optFlags: string[] = []) {
  // output options object
  let options:{
    args: string[],
    options: any
  } = { args: [], options: {} };

  flags = flags || [];
  optFlags = optFlags || [];

  let curOptionFlag;

  function getFlagMatch (arg, flags) {
    let index;

    if (arg.startsWith('--')) {
      index = flags.indexOf(arg.substr(2));
      if (index !== -1)
        return flags[index];
    }
    else if (arg.startsWith('-')) {
      return flags.filter(function(f) {
        return f.substr(0, 1) === arg.substr(1, 1);
      })[0];
    }
  }

  // de-sugar any coupled single-letter flags
  // -abc -> -a -b -c
  var args = [];
  inArgs.forEach(arg => {
    if (arg[0] === '-' && arg.length > 1 && arg[1] !== '-') {
      for (var i = 1; i < arg.length; i++)
        args.push('-' + arg[i]);
    }
    else {
      args.push(arg);
    }
  });

  args.forEach(arg => {
    var flag = getFlagMatch(arg, flags);
    var optFlag = getFlagMatch(arg, optFlags);

    // option flag -> suck up args
    if (optFlag) {
      curOptionFlag = optFlag;
      options.options[dashedToCamelCase(curOptionFlag)] = [];
    }
    // normal boolean flag
    else if (flag) {
      options.options[dashedToCamelCase(flag)] = true;
    }
    // value argument
    else {
      if (curOptionFlag)
        options.options[dashedToCamelCase(curOptionFlag)].push(arg);
      else if (arg.startsWith('--'))
        throw new JspmUserError(`Unknown option flag ${bold(arg)}.`);
      else
        options.args.push(arg);
    }
  });

  // flag values are strings
  Object.keys(options.options).forEach(option => {
    if (Array.isArray(options.options[option]))
      options.options[option] = options.options[option].join(' ');
  });

  return options;
}

// this will get a value in its true type from the CLI
export function readValue (val: string) {
  val = val.trim();
  if (val === 'true' || val === 'false')
    return eval(val);
  else if (parseInt(val, 10).toString() === val)
    return parseInt(val);
  else if (val[0] === '{' && val[val.length - 1] === '}')
    return eval('(' + val + ')');
  else if (val[0] === '[' && val[val.length - 1] === ']')
    if (val.indexOf('\'') === -1 && val.indexOf('\"') === -1)
      return val.substr(1, val.length - 2).split(',').map(item => item.trim());
    else
      return eval('(' + val + ')');
  else
    return val;
}

export function readPropertySetters (str: string, dottedProperties: boolean) {
  var outObj = {};

  function setProperty (target, p, value) {
    var pParts = p.split('.');
    var curPart;
    while (pParts.length) {
      if (curPart !== undefined)
        target = target[curPart] = target[curPart] || {};
      curPart = pParts.shift();

      // allow properties to be indicated by square brackets as well (a.b['c'].d)
      if (curPart.indexOf('[') !== -1) {
        var lastPart = curPart.substr(curPart.indexOf('[') + 1);
        lastPart = lastPart + (lastPart ? '.' : '') + pParts.join('.');
        if (lastPart.indexOf(']') === -1 || lastPart.indexOf(']') === 0)
          continue;

        var bracketPart = lastPart.substr(0, lastPart.indexOf(']'));
        if (bracketPart[0] === '"' && bracketPart[bracketPart.length - 1] === '"' || bracketPart[0] === '\'' && bracketPart[bracketPart.length - 1] === '\'')
          bracketPart = bracketPart.substr(1, bracketPart.length - 2);

        curPart = curPart.substr(0, curPart.indexOf('['));

        lastPart = lastPart.substr(lastPart.indexOf(']') + 1);
        if (lastPart[0] === '.')
          lastPart = lastPart.substr(1);
        pParts = [bracketPart].concat(lastPart ? lastPart.split('.') : []);
      }
    }
    setValue(target, curPart, value);
  }
  function setValue (target, p, value) {
    if (p.substr(p.length - 2, 2) === '[]')
      target[p.substr(0, p.length - 2)] = value.split(',');
    else
      target[p] = value;
  }

  let parts = str.split('=');
  let lastProp;
  parts.forEach((part, index) => {
    if (!lastProp) {
      lastProp = part;
      return;
    }

    let value = readValue(index === parts.length - 1 ? part : part.substr(0, part.lastIndexOf(' ')));
    lastProp = lastProp.trim();
    if (dottedProperties)
      setProperty(outObj, lastProp, value);
    else
      setValue(outObj, lastProp, value);
    lastProp = part.substr(part.lastIndexOf(' ') + 1).trim();
  });

  return outObj;
}

function dashedToCamelCase (str: string) {
  const parts = str.split('-');
  const outParts = [parts[0]];
  for (let i = 1; i < parts.length; i++)
    if (parts[i])
      outParts.push(parts[i][0].toUpperCase() + parts[i].substr(1));
  return outParts.join('');
}