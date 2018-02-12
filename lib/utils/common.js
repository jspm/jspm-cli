"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const fs = require("graceful-fs");
const path = require("path");
const promiseRetry = require("promise-retry");
const chalk_1 = require("chalk");
const os = require("os");
exports.HOME_DIR = os.homedir();
exports.JSPM_LEGACY_CONFIG_DIR = path.resolve(process.env.JSPM_GLOBAL_PATH || process.env.LOCALAPPDATA || process.env.HOME || process.env.HOMEPATH, '.jspm');
let JSPM_CONFIG_DIR, JSPM_CACHE_DIR;
exports.JSPM_CONFIG_DIR = JSPM_CONFIG_DIR;
exports.JSPM_CACHE_DIR = JSPM_CACHE_DIR;
if (process.env.JSPM_CONFIG_PATH) {
    exports.JSPM_CONFIG_DIR = JSPM_CONFIG_DIR = process.env.JSPM_CONFIG_PATH;
}
else {
    if (process.platform === 'darwin')
        exports.JSPM_CONFIG_DIR = JSPM_CONFIG_DIR = path.join(exports.HOME_DIR, '.jspm');
    else if (process.platform === 'win32')
        exports.JSPM_CONFIG_DIR = JSPM_CONFIG_DIR = path.join(process.env.LOCALAPPDATA || path.join(exports.HOME_DIR, 'AppData', 'Local'), 'jspm');
    else
        exports.JSPM_CONFIG_DIR = JSPM_CONFIG_DIR = process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, 'jspm') : path.join(exports.HOME_DIR, '.jspm');
}
if (process.env.JSPM_CACHE_PATH) {
    exports.JSPM_CACHE_DIR = JSPM_CACHE_DIR = process.env.JSPM_CACHE_PATH;
}
else {
    if (process.platform === 'darwin')
        exports.JSPM_CACHE_DIR = JSPM_CACHE_DIR = path.join(exports.HOME_DIR, 'Library', 'Caches', 'jspm');
    else if (process.platform === 'win32')
        exports.JSPM_CACHE_DIR = JSPM_CACHE_DIR = path.join(process.env.LOCALAPPDATA || path.join(exports.HOME_DIR, 'AppData', 'Local'), 'jspm-cache');
    else
        exports.JSPM_CACHE_DIR = JSPM_CACHE_DIR = path.join(process.env.XDG_CACHE_HOME || path.join(exports.HOME_DIR, '.cache'), 'jspm');
}
exports.isWindows = process.platform === 'win32';
exports.PATH = exports.isWindows ? Object.keys(process.env).find(e => Boolean(e.match(/^PATH$/i))) || 'Path' : 'PATH';
exports.PATHS_SEP = process.platform === 'win32' ? ';' : ':';
exports.winSepRegEx = /\\/g;
function bold(str) {
    return chalk_1.default.bold(str);
}
exports.bold = bold;
function highlight(str) {
    return chalk_1.default.cyan(str);
}
exports.highlight = highlight;
function underline(str) {
    return chalk_1.default.underline(str);
}
exports.underline = underline;
exports.invalidFileCharRegEx = /[<>:"/\|?*^\u0001-\u0031]/g;
function encodeInvalidFileChars(str) {
    // NB check if this is actually a perf shortpath!
    if (!exports.invalidFileCharRegEx.test(str))
        return str;
    return str.replace(exports.invalidFileCharRegEx, char => char === '*' ? '%2A' : encodeURIComponent(char));
}
exports.encodeInvalidFileChars = encodeInvalidFileChars;
class JspmError extends Error {
    constructor(msg, code, childErr) {
        if (!childErr) {
            super(msg);
            this.code = code;
            return;
        }
        let message = (childErr.message || childErr) + '\n     ' + msg;
        super(message);
        this.code = code;
        let originalErr = childErr.originalErr;
        if (!childErr.hideStack) {
            let stack = originalErr ? originalErr.stack : childErr.stack;
            this.stack = message + (stack ? '\n     ' + stack : '');
        }
        this.retriable = childErr.retriable || false;
        this.hideStack = childErr.hideStack || false;
        this.originalErr = originalErr || childErr;
    }
}
exports.JspmError = JspmError;
class JspmRetriableError extends JspmError {
    constructor(msg, code, childErr) {
        super(msg, code, childErr);
        this.retriable = true;
    }
}
exports.JspmRetriableError = JspmRetriableError;
class JspmUserError extends JspmError {
    constructor(msg, code, childErr) {
        super(msg, code, childErr);
        this.hideStack = true;
    }
}
exports.JspmUserError = JspmUserError;
class JspmRetriableUserError extends JspmError {
    constructor(msg, code, childErr) {
        super(msg, code, childErr);
        this.hideStack = true;
        this.retriable = true;
    }
}
exports.JspmRetriableUserError = JspmRetriableUserError;
function retry(opts, operation, timeout) {
    if (!timeout)
        return promiseRetry(async (retry, number) => {
            try {
                return operation(number);
            }
            catch (err) {
                if (err && err.retriable)
                    retry(err);
                throw err;
            }
        }, opts);
    return promiseRetry((retry, number) => {
        let t;
        return Promise.race([
            new Promise((_resolve, reject) => {
                t = setTimeout(() => reject(new JspmRetriableUserError('Operation timeout.')), timeout);
            }),
            (async () => {
                let result = await operation(number);
                clearTimeout(t);
                return result;
            })()
        ])
            .catch(err => {
            clearTimeout(t);
            if (err && err.retriable)
                retry(err);
            else
                throw err;
        });
    }, opts);
}
exports.retry = retry;
function readJSONSync(fileName) {
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
        throw 'Error parsing package.json file ' + fileName;
    }
}
exports.readJSONSync = readJSONSync;
function toFileURL(path) {
    return 'file://' + (exports.isWindows ? '/' : '') + path.replace(/\\/g, '/');
}
exports.toFileURL = toFileURL;
function fromFileURL(url) {
    if (url.substr(0, 7) === 'file://')
        return url.substr(exports.isWindows ? 8 : 7).replace(path.sep, '/');
    else
        return url;
}
exports.fromFileURL = fromFileURL;
/*
 * Object helpers
 */
function objEquals(objA, objB) {
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
exports.objEquals = objEquals;
function hasProperties(obj) {
    for (var p in obj) {
        if (obj.hasOwnProperty(p))
            return true;
    }
    return false;
}
exports.hasProperties = hasProperties;
async function readJSON(file) {
    try {
        var pjson = await new Promise((resolve, reject) => fs.readFile(file, (err, source) => err ? reject(err) : resolve(source.toString())));
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
exports.readJSON = readJSON;
const crypto = require("crypto");
function sha256(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}
exports.sha256 = sha256;
function md5(input) {
    return crypto.createHash('md5').update(input).digest('hex');
}
exports.md5 = md5;
//# sourceMappingURL=common.js.map