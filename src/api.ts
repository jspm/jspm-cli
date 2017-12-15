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
import { bold, JspmUserError, isWindows } from './utils/common';
import { log, LogType, logErr } from './utils/ui';

export * from './project';
export { devserver, DevserverOptions } from './devserver';
import { devServerRunning } from './devserver';

import { build as buildFunc } from './build';

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
    if (devServerRunning)
      log('jspm dev server terminated.');
    else
      log('jspm process terminated.');
    process.exit(1);
  });
  process.once('SIGTERM', () => {
    if (devServerRunning)
      log('jspm dev server terminated.');
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

const invalidNodeArguments = {
  '-v': true, '--version': true, '-h': true, '--help': true, '-e': true, '--eval': true, '-p': true,
  '--print': true, '-i': true, '--interactive': true, '-r': true, '--require': true
};

export async function resolve (name: string, parent?: string, env?: any, relativeFallback?: boolean) {
  const jspmResolve = require('jspm-resolve');
  return jspmResolve(name, parent, { env, relativeFallback });
}

export function resolveSync (name: string, parent?: string, env?: any, relativeFallback?: boolean) {
  const jspmResolve = require('jspm-resolve');
  return jspmResolve.sync(name, parent, { env, relativeFallback });
}

export async function run (entryModule, args = [], nodeArgs = ['--no-warnings']) {
  const jspmResolve = require('jspm-resolve');
  const nodeVersion = process.versions.node.split('.');
  const nodeMajor = parseInt(nodeVersion[0]);
  const nodeMinor = parseInt(nodeVersion[1]);
  if (nodeMajor < 8 || nodeMajor === 8 && nodeMinor < 9)
    throw new JspmUserError(`${bold('jspm run')} requires NodeJS 8.9.0 or greater.`, 'ERR_INVALID_NODE_VERSION');
  
  const node = process.argv[0];

  const resolved = jspmResolve.sync(entryModule, undefined, { env: { bin: true }, relativeFallback: true });
  if (!resolved.resolved)
    throw new JspmUserError(`@empty resolution found for ${entryModule}.`);
  
  const loaderPath =  require.resolve('jspm-resolve').replace(/resolve\.js$/, 'loader.mjs');

  nodeArgs.forEach(arg => {
    if (arg[0] !== '-' || invalidNodeArguments[arg])
      throw new JspmUserError(`Invalid NodeJS argument ${bold(arg)} for jspm run.`);
  });

  await new Promise((resolve, reject) => {
    spawn(node, [...nodeArgs, '--experimental-modules', '--harmony-dynamic-import', '--loader', (isWindows ? '/' : '') + loaderPath, resolved.resolved, ...args], {
      stdio: 'inherit'
    })
    .on('close', code => code === 0 ? resolve() : reject());
  });
}