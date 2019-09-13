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
import fs = require('graceful-fs');
import path = require('path');
import chalk from 'chalk';
import os = require('os');

export function readModuleEnv (opts) {
  let env;
  if (opts.browser)
    (env = env || {}).browser = true;
  if (opts.bin)
    (env = env || {}).bin = true;
  if (opts['react-native'])
    (env = env || {})['react-native'] = true;
  if (opts.production)
    (env = env || {}).production = true;
  if (opts.electron)
    (env = env || {}).electron = true;
  return env;
}

export const HOME_DIR = os.homedir();

export const JSPM_LEGACY_CONFIG_DIR = path.resolve(process.env.JSPM_GLOBAL_PATH || process.env.LOCALAPPDATA || process.env.HOME || process.env.HOMEPATH, '.jspm');

let JSPM_CONFIG_DIR, JSPM_CACHE_DIR;

if (process.env.JSPM_CONFIG_PATH) {
  JSPM_CONFIG_DIR = process.env.JSPM_CONFIG_PATH;
}
else {
  if (process.platform === 'darwin')
    JSPM_CONFIG_DIR = path.join(HOME_DIR, '.jspm');
  else if (process.platform === 'win32')
    JSPM_CONFIG_DIR = path.join(process.env.LOCALAPPDATA || path.join(HOME_DIR, 'AppData', 'Local'), 'jspm');
  else
    JSPM_CONFIG_DIR = process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, 'jspm') : path.join(HOME_DIR, '.jspm');
}
if (process.env.JSPM_CACHE_PATH) {
  JSPM_CACHE_DIR = process.env.JSPM_CACHE_PATH;
}
else {
  if (process.platform === 'darwin')
    JSPM_CACHE_DIR = path.join(HOME_DIR, 'Library', 'Caches', 'jspm');
  else if (process.platform === 'win32')
    JSPM_CACHE_DIR = path.join(process.env.LOCALAPPDATA || path.join(HOME_DIR, 'AppData', 'Local'), 'jspm-cache');
  else
    JSPM_CACHE_DIR = path.join(process.env.XDG_CACHE_HOME || path.join(HOME_DIR, '.cache'), 'jspm');
}

export { JSPM_CONFIG_DIR, JSPM_CACHE_DIR }

export const isWindows = process.platform === 'win32';

export const PATH = isWindows ? Object.keys(process.env).find(e => Boolean(e.match(/^PATH$/i))) || 'Path' : 'PATH';
export const PATHS_SEP = process.platform === 'win32' ? ';' : ':';

export const winSepRegEx = /\\/g;

export function bold (str: string): string {
  return chalk.bold(str);
}

export function highlight (str: string): string {
  return chalk.cyan(str);
}

export function underline (str: string): string {
  return chalk.underline(str);
}

export function isURL (str: string, absolute = false) {
  if (absolute && str.startsWith('/'))
    return true;
  try {
    new URL(str);
  }
  catch (e) {
    return false;
  }
  return true;
}

export interface RetryOptions {
  retries?: number,
  factor?: number,
  minTimeout?: number,
  maxTimeout?: number,
  randomize?: boolean
}

export const invalidFileCharRegEx = /[<>:"/\|?*^\u0001-\u0031]/g;
export function encodeInvalidFileChars (str) {
  // NB check if this is actually a perf shortpath!
  if (!invalidFileCharRegEx.test(str))
    return str;
  return str.replace(invalidFileCharRegEx, char => char === '*' ? '%2A' : encodeURIComponent(char));
}

export class JspmError extends Error {
  originalErr: JspmError | Error;
  retriable: boolean;
  hideStack: boolean;
  code: string;
  constructor (msg: string, code?: string, childErr?: JspmError | Error) {
    if (!childErr) {
      super(msg);
      this.code = code;
      return;
    }
    let message = (childErr.message || childErr) + '\n     ' + msg;
    super(message);
    this.code = code;
    let originalErr = (<JspmError>childErr).originalErr;
    if (!(<JspmUserError>childErr).hideStack) {
      let stack = originalErr ? originalErr.stack : childErr.stack;
      this.stack = message + (stack ? '\n     ' + stack : '');
    }
    this.retriable = (<JspmError>childErr).retriable || false;
    this.hideStack = (<JspmError>childErr).hideStack || false;
    this.originalErr = originalErr || childErr;
  }
}

export class JspmRetriableError extends JspmError {
  retriable: true;
  constructor (msg: string, code?: string, childErr?: JspmError | Error) {
    super(msg, code, childErr);
    this.retriable = true;
  }
}

export class JspmUserError extends JspmError {
  hideStack: true;
  constructor (msg: string, code?: string, childErr?: JspmError | Error) {
    super(msg, code, childErr);
    this.hideStack = true;
  }
}

export class JspmRetriableUserError extends JspmError {
  hideStack: true;
  retriable: true;
  constructor (msg: string, code?: string, childErr?: JspmError | Error) {
    super(msg, code, childErr);
    this.hideStack = true;
    this.retriable = true;
  }
}

export function retry<T> (operation: (retryNumber: number) => Promise<T>, retries = 0): Promise<T> {
  async function doOp (attempt: number) {
    try {
      return await operation(attempt);
    }
    catch (err) {
      if (err && err.retriable && attempt < retries)
        return doOp(attempt + 1);
      throw err;
    }
  }
  return doOp(1);
}

export function readJSONSync (fileName: string): any {
  let pjson;
  try {
    pjson = fs.readFileSync(fileName).toString();
  }
  catch (e) {
    if (e.code === 'ENOENT')
      pjson = '';
    else
      throw e;
  }
  if (pjson.startsWith('\uFEFF'))
    pjson = pjson.substr(1);
  try {
    return JSON.parse(pjson);
  }
  catch (e) {
    throw new JspmUserError('Error parsing package.json file ' + fileName);
  }
}

export function toFileURL (path: string) {
  return 'file://' + (isWindows ? '/' : '') + path.replace(/\\/g, '/');
}

export function fromFileURL (url: string) {
  if (url.substr(0, 7) === 'file://')
    return url.substr(isWindows ? 8 : 7).replace(path.sep, '/');
  else
    return url;
}

/*
 * Object helpers
 */
export function objEquals (objA, objB) {
  const aProps = Object.keys(objA);
  for (let p of aProps) {
    const aVal = objA[p];
    const bVal = objB[p];
    if (typeof aVal === 'object' && typeof bVal === 'object')
      return objEquals(aVal, bVal);
    else if (aVal !== bVal)
      return false;
  }
  const bProps = Object.keys(objB);
  for (let p of bProps) {
    if (aProps.includes(p))
      continue;
    const aVal = objA[p];
    const bVal = objB[p];
    if (typeof aVal === 'object' && typeof bVal === 'object')
      return objEquals(aVal, bVal);
    else if (aVal !== bVal)
      return false;
  }
  return true;
}

export function hasProperties (obj) {
  for (var p in obj) {
    if (obj.hasOwnProperty(p))
      return true;
  }
  return false;
}

export async function readJSON (file: string): Promise<any> {
  try {
    var pjson = await new Promise<string>((resolve, reject) => fs.readFile(file, (err, source) => err ? reject(err) : resolve(source.toString())));
  }
  catch (e) {
    if (e.code === 'ENOENT')
      return;
    throw e;
  }
  // remove any byte order mark
  if (pjson.startsWith('\uFEFF'))
    pjson = pjson.substr(1);
  try {
    return JSON.parse(pjson);
  }
  catch (e) {
    throw new JspmError(`Error parsing JSON file ${file}.`);
  }
}

import crypto = require('crypto');
export function sha256 (input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
export function md5 (input: string): string {
  return crypto.createHash('md5').update(input).digest('hex');
}

export const validPkgNameRegEx = /^(@[-_\.a-z\d]+\/)?[-_\.a-z\d]+$/i;
export const validAliasRegEx = /^[@\-_\.a-z\d\/]+$/i;

const simpleIdentifierRegEx = /^[a-zA-Z_$][0-9a-zA-Z_$]*$/;
export function isValidIdentifier (name: string) {
  return name.match(simpleIdentifierRegEx);
}

export function alphabetize<T> (obj: T): T {
  const out: T = <T>{};
  for (const key of Object.keys(obj).sort())
    out[key] = obj[key];
  return out;
}
