"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/*
 *   Copyright 2014-2018 Guy Bedford (http://guybedford.com)
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
const { spawn } = require('child_process');
const common_1 = require("../utils/common");
exports.version = require('../../package.json').version;
const path = require("path");
const project_1 = require("../project");
const package_1 = require("../install/package");
exports.JSPX_PATH = path.resolve(common_1.JSPM_CACHE_DIR, 'jspx');
async function jspx(target, args, opts) {
    ensureNodeLoaderSupport();
    const project = new project_1.Project(exports.JSPX_PATH, { userInput: opts.userInput, offline: opts.offline, preferOffline: true, cli: false });
    // we always start fresh
    const existingDependencies = Object.keys(project.config.pjson.dependencies);
    if (existingDependencies.length)
        await project.uninstall(existingDependencies);
    await project.install([{
            name: 'main',
            target,
            parent: undefined,
            type: package_1.DepType.primary
        }], { latest: opts.latest });
    // read the package.json bin
    let binScript;
    const packagePath = project.installer.getPackagePath('main');
    var pjson = await common_1.readJSON(path.resolve(packagePath, 'package.json'));
    if (!pjson.bin)
        throw new common_1.JspmUserError(`Package ${common_1.highlight(target)} has no ${common_1.bold('bin')} defined to execute.`);
    if (typeof pjson.bin === 'string') {
        binScript = pjson.bin;
    }
    else if (typeof pjson.bin === 'object') {
        binScript = pjson.bin[pjson.name];
        if (!binScript)
            for (let name in pjson.bin)
                binScript = pjson.bin[name];
    }
    if (!binScript)
        throw new common_1.JspmUserError(`Package ${common_1.highlight(target)} has no ${common_1.bold('bin')} defined to execute.`);
    binScript = path.resolve(packagePath, binScript);
    const node = process.argv[0];
    const loaderPath = require.resolve('@jspm/resolve').replace(/resolve\.js$/, 'loader.mjs');
    return new Promise((resolve, reject) => {
        spawn(node, [binScript, ...args], {
            stdio: 'inherit',
            env: Object.assign({}, process.env, {
                NODE_OPTIONS: `--experimental-modules --loader ${(common_1.isWindows ? '/' : '') + loaderPath}`
            })
        })
            .on('close', code => resolve(code))
            .on('error', err => reject(err));
    });
}
exports.jspx = jspx;
function ensureNodeLoaderSupport() {
    const nodeVersion = process.versions.node.split('.');
    const nodeMajor = parseInt(nodeVersion[0]);
    const nodeMinor = parseInt(nodeVersion[1]);
    if (nodeMajor < 8 || nodeMajor === 8 && nodeMinor < 9)
        throw new common_1.JspmUserError(`${common_1.bold('jspm node')} requires NodeJS 8.9.0 or greater.`, 'ERR_INVALID_NODE_VERSION');
}
exports.ensureNodeLoaderSupport = ensureNodeLoaderSupport;
async function execNode(args = [], projectPath = process.cwd()) {
    if (typeof args === 'string')
        throw new Error('Args must be an array');
    ensureNodeLoaderSupport();
    // resolve the module argument
    for (let i = 0; i < args.length; i++) {
        let arg = args[i];
        if (arg === '-e')
            break;
        if (arg[0] === '-')
            continue;
        const jspmResolve = require('@jspm/resolve');
        try {
            args[i] = jspmResolve.sync(arg, projectPath + '/', { env: { bin: true } }).resolved;
        }
        catch (e) {
            if (e.code !== 'MODULE_NOT_FOUND' || path.isAbsolute(arg) || arg.startsWith('./') || arg.startsWith('/') || arg.startsWith('../'))
                throw e;
            args[i] = jspmResolve.sync('./' + arg, projectPath + '/', { env: { bin: true } }).resolved;
        }
        break;
    }
    const node = process.argv[0];
    const loaderPath = require.resolve('@jspm/resolve').replace(/resolve\.js$/, 'loader.mjs');
    return new Promise((resolve, reject) => {
        spawn(node, args, {
            stdio: 'inherit',
            env: Object.assign({}, process.env, {
                NODE_OPTIONS: `${process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : ''}--experimental-modules --loader ${(common_1.isWindows ? '/' : '') + loaderPath}`
            })
        })
            .on('close', code => resolve(code))
            .on('error', err => reject(err));
    });
}
exports.execNode = execNode;
//# sourceMappingURL=index.js.map