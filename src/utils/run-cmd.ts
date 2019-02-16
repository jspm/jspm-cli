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
import childProcess = require('child_process');
import process = require('process');
import { isWindows, PATH, PATHS_SEP } from './common';
import path = require('path');

export async function runCmd (script: string, cwd: string, pipe: true): Promise<childProcess.ChildProcess>
export async function runCmd (script: string, cwd = process.env.PWD || process.cwd(), pipe = false): Promise<childProcess.ChildProcess | number> {
  const env = Object.create(null);
  
  const pathArr = [];
  pathArr.push(path.join(cwd, 'jspm_packages', '.bin'));
  pathArr.push(path.join(__dirname, 'node-gyp-bin'));
  pathArr.push(path.join(cwd, 'node_modules', '.bin'));
  pathArr.push(process.env[PATH]);

  Object.assign(env, process.env);
  env[PATH] = pathArr.join(PATHS_SEP);
  const sh = isWindows ? process.env.comspec || 'cmd' : 'sh';
  const shFlag = isWindows ? '/d /s /c' : '-c';
  const ps = childProcess.spawn(sh, [shFlag, script], { cwd, env, stdio: pipe ? 'pipe' : 'inherit', windowsVerbatimArguments: true });
  if (pipe)
    return ps;
  return new Promise<number>((resolve, reject) => ps.on('close', resolve).on('error', reject));
}
