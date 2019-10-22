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
import * as fs from 'fs';
import gracefulFs = require('graceful-fs');
gracefulFs.gracefulify(fs);

export const version = require('.././package.json').version;
import { JSPM_CONFIG_DIR } from './utils/common';

export * from './project';

export { map, filterMap, renormalizeMap, trace } from './map';
import { exec as execFunc, run as runFunc } from './exec';
import path = require('path');
export { build } from './build';
export { buildPackage } from './build/package-build';

export async function resolve (name: string, parent?: string, targets?: any) {
  const jspmResolve = require('@jspm/resolve');
  return jspmResolve(name, parent, { targets });
}

export function resolveSync (name: string, parent?: string, targets?: any) {
  const jspmResolve = require('@jspm/resolve');
  return jspmResolve.sync(name, parent, { targets });
}

export const JSPM_GLOBAL_PATH = path.resolve(JSPM_CONFIG_DIR, 'global');

export const exec: typeof execFunc = function () {
  return require('./exec').exec.apply(this, arguments);
}

export const run: typeof runFunc = function () {
  return require('./exec').run.apply(this, arguments);
}
