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
const { spawn } = require('child_process');
export const version = require('../package.json').version;
import { bold, JspmUserError, isWindows, JSPM_CONFIG_DIR } from './utils/common';
import { log, LogType, logErr } from './utils/ui';

export * from './project';
export { serve, ServerOptions } from './serve';
import { serverRunning } from './serve';

import { build as buildFunc } from './build';
import path = require('path');

export const JSPM_GLOBAL_PATH = path.resolve(JSPM_CONFIG_DIR, 'global-project');

export const build: typeof buildFunc = function () {
  return require('./build').build.apply(this, arguments);
}

if (process.env.globalJspm !== undefined) {
  process.once('unhandledRejection', err => {
    log('Internal Error: Unhandled promise rejection.', LogType.err);
    logErr(err.stack || err);
    process.exit(1);
  });
  process.once('SIGINT', () => {
    if (serverRunning)
      log('jspm server terminated.');
    else
      log('jspm process terminated.');
    process.exit(1);
  });
  process.once('SIGTERM', () => {
    if (serverRunning)
      log('jspm server terminated.');
    else
      log('jspm process terminated.');
    process.exit(1);
  });
}
else {
  process.on('unhandledRejection', err => {
    console.error('Internal Error: Unhandled promise rejection.');
    throw err;
  });
}

export async function resolve (name: string, parent?: string, env?: any, relativeFallback?: boolean) {
  const jspmResolve = require('jspm-resolve');
  return jspmResolve(name, parent, { env, relativeFallback });
}

export function resolveSync (name: string, parent?: string, env?: any, relativeFallback?: boolean) {
  const jspmResolve = require('jspm-resolve');
  return jspmResolve.sync(name, parent, { env, relativeFallback });
}

export async function execNode (args = [], projectPath = process.cwd()) {
  if (typeof args === 'string')
    throw new Error('Args must be an array');
  
  const nodeVersion = process.versions.node.split('.');
  const nodeMajor = parseInt(nodeVersion[0]);
  const nodeMinor = parseInt(nodeVersion[1]);
  if (nodeMajor < 8 || nodeMajor === 8 && nodeMinor < 9)
    throw new JspmUserError(`${bold('jspm node')} requires NodeJS 8.9.0 or greater.`, 'ERR_INVALID_NODE_VERSION');

  const node = process.argv[0];

  // resolve the module argument
  for (let i = 0; i < args.length; i++) {
    let arg = args[i];
    if (arg === '-e')
      break;
    if (arg[0] === '-')
      continue;
    const jspmResolve = require('jspm-resolve');
    const resolved = jspmResolve.sync(arg, projectPath + '/', { env: { bin: true }, relativeFallback: true });
    if (!resolved.resolved)
      throw new JspmUserError(`@empty resolution found for ${arg}.`);
    args[i] = resolved.resolved;
    break;
  }
  
  const loaderPath =  require.resolve('jspm-resolve').replace(/resolve\.js$/, 'loader.mjs');

  return new Promise<number>((resolve, reject) => {
    spawn(node, ['--experimental-modules', '--harmony-dynamic-import', '--loader', (isWindows ? '/' : '') + loaderPath, ...args], {
      stdio: 'inherit'
    })
    .on('close', code => resolve(code))
    .on('error', err => reject(err));
  });
}