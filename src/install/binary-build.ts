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

import path = require('path');
import * as api from '../api';
import { JspmUserError, highlight, bold } from '../utils/common';
import fs = require('graceful-fs');
import { runCmd } from '../utils/run-cmd';

const nodePreGypRegEx = /^node-pre-gyp install( --fallback-to-build)?$/;
const nodeGypRegEx = /node-gyp rebuild/;
const prebuildRegEx = /^prebuild-install \|\| node-gyp rebuild$/;

const nanRefRegEx = /'<\!\(node -e "require\(\\'nan\\'\)"\)'|"<\!\(node -e \\"require\('nan'\)\\"\)"/g;

const NAN = path.dirname(require.resolve('nan'));
const NODE_GYP = require.resolve('node-gyp/bin/node-gyp.js');
const NODE_PRE_GYP = require.resolve('node-pre-gyp/bin/node-pre-gyp');

function binaryError (pkgName, buildName, output) {
  return new JspmUserError(`Error building ${highlight(pkgName)} with ${bold(buildName)}.\n${output}`);
}

async function updateBindingGyp (bindingPath: string) {
  let binding;
  try {
    binding = await new Promise<string>((resolve, reject) => fs.readFile(bindingPath, (err, source) => err ? reject(err) : resolve(source.toString())));
  }
  finally {
    if (binding && binding.match(nanRefRegEx)) {
      await new Promise((resolve, reject) => fs.writeFile(bindingPath, binding.replace(nanRefRegEx, "'" + NAN + "'"), err => err ? reject(err) : resolve()));
    }
  }
}

export async function runBinaryBuild (log: api.Logger, pkgDir: string, name: string, scripts: Record<string, string>) {
  if (!scripts)
    return;
  const bindingPath = path.join(pkgDir, 'binding.gyp');
  if (!scripts.install) {
    const gypExists = await new Promise(resolve => fs.exists(bindingPath, resolve));
    if (gypExists)
      scripts.install = 'node-gyp rebuild';
  }
  if (typeof scripts.install !== 'string')
    return;

  let buildCmd, buildType;

  if (scripts.install.match(nodePreGypRegEx)) {
    await updateBindingGyp(bindingPath);
    buildCmd = NODE_PRE_GYP + scripts.install.substr(12);
    buildType = 'node-pre-gyp';
  }
  else if (scripts.install.match(nodeGypRegEx) || scripts.install.match(prebuildRegEx)) {
    await updateBindingGyp(bindingPath);
    buildCmd = NODE_GYP + ' rebuild';
    buildType = 'node-gyp';
  }

  if (buildCmd) {
    const logEnd = log.taskStart(`Building ${highlight(name)} with ${bold(buildType)}.`);
    log.debug('Running build command: ' + buildCmd);
    log.debug('with cwd: ' + pkgDir);
    const ps = await runCmd(buildCmd, pkgDir, true);
    let stderr = '';
    ps.stdout.on('data', chunk => log.debug(chunk.toString()));
    ps.stderr.on('data', chunk => {
      const str = chunk.toString();
      log.debug(str.substr(0, str.length - (str[str.length - 1] === '\n' ? 1 : 0)));
      stderr += str;
    });
    try {
      await new Promise((resolve, reject) => {
        ps.on('exit', code => code === 0 ? resolve() : reject(binaryError(name, buildType, stderr)));
        ps.on('error', err => reject(binaryError(name, NODE_PRE_GYP, stderr + '\n' + err.toString())));
      });
    }
    finally {
      logEnd();
    }
  }
}