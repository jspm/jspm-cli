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
import { bold, JspmUserError, isWindows, JSPM_CACHE_DIR, readJSON, highlight } from '../utils/common';
export const version = require('../../package.json').version;
import path = require('path');
import { Project } from '../project';
import { DepType } from '../install/package';

export interface JspxOptions {
  bin?: string;
  projectPath?: string;
  latest?: boolean;
  userInput?: boolean;
  offline?: boolean;
}

export const JSPX_PATH = path.resolve(JSPM_CACHE_DIR, 'jspx');

export async function jspx (target: string, args: string[], opts: JspxOptions): Promise<number> {
  ensureNodeLoaderSupport();

  const project = new Project(JSPX_PATH, { userInput: opts.userInput, offline: opts.offline, preferOffline: true, cli: false });
  // we always start fresh
  const existingDependencies = Object.keys(project.config.pjson.dependencies);
  if (existingDependencies.length)
    await project.uninstall(existingDependencies);
  await project.install([{
    name: 'main',
    target,
    parent: undefined,
    type: DepType.primary
  }], { latest: opts.latest });

  // read the package.json bin
  let binScript: string;
  const packagePath = project.installer.getPackagePath('main');
  var pjson = await readJSON(path.resolve(packagePath, 'package.json'));
  
  if (!pjson.bin)
    throw new JspmUserError(`Package ${highlight(target)} has no ${bold('bin')} defined to execute.`);
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
    throw new JspmUserError(`Package ${highlight(target)} has no ${bold('bin')} defined to execute.`);

  binScript = path.resolve(packagePath, binScript);

  const node = process.argv[0];
  const loaderPath =  require.resolve('jspm-resolve').replace(/resolve\.js$/, 'loader.mjs');

  return new Promise<number>((resolve, reject) => {
    spawn(node, [binScript, ...args], {
      stdio: 'inherit',
      env: Object.assign({}, process.env, {
        NODE_OPTIONS: `--experimental-modules --loader ${(isWindows ? '/' : '') + loaderPath}`
      })
    })
    .on('close', code => resolve(code))
    .on('error', err => reject(err));
  });
}

export function ensureNodeLoaderSupport () {
  const nodeVersion = process.versions.node.split('.');
  const nodeMajor = parseInt(nodeVersion[0]);
  const nodeMinor = parseInt(nodeVersion[1]);
  if (nodeMajor < 8 || nodeMajor === 8 && nodeMinor < 9)
    throw new JspmUserError(`${bold('jspm node')} requires NodeJS 8.9.0 or greater.`, 'ERR_INVALID_NODE_VERSION');
}

export async function execNode (args = [], projectPath = process.cwd()) {
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
    const jspmResolve = require('jspm-resolve');
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
  const loaderPath =  require.resolve('jspm-resolve').replace(/resolve\.js$/, 'loader.mjs');

  return new Promise<number>((resolve, reject) => {
    spawn(node, args, {
      stdio: 'inherit',
      env: Object.assign({}, process.env, {
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : ''}--experimental-modules --loader ${(isWindows ? '/' : '') + loaderPath}`
      })
    })
    .on('close', code => resolve(code))
    .on('error', err => reject(err));
  });
}