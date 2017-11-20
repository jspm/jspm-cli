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

import { JspmUserError, bold } from '../utils/common';
import path = require('path');
import fs = require('graceful-fs');

export interface BuildOptions {
  env: any;
  watch: boolean;
  minify: boolean;
  skipSourceMaps: boolean;
  sourceMapContents: boolean;
  inlineSourceMaps: boolean;
  external: {
    [name: string]: string | boolean
  };
  excludeDeps: boolean;
  format: 'esm' | 'cjs' | 'amd' | 'system' | 'global';
  globalName: string;
  globalDeps: {
    [name: string]: string
  };
  banner: string;
  globalDefs: {
    [name: string]: string
  }
};
export async function build (projectPath: string, moduleName: string, outFile = 'build.js', opts: BuildOptions) {
  const rollup = require('rollup');
  const jspmRollup = require('rollup-plugin-jspm');

  let format, name;
  switch (opts.format) {
    case undefined:
    case 'esm':
      format = 'es';
    break;
    case 'global':
      format = 'iife';
      if (typeof opts.globalName !== 'string')
        throw new JspmUserError(`Global name option must be provided for global format.`);
      name = opts.globalName;
    break;
    case 'amd':
    case 'cjs':
    break;
    case 'system':
      throw new JspmUserError(`System module format not currently supported.`);
    default:
      throw new JspmUserError(`Unknown module format ${bold(format)}.`);
  }

  const outputOptions = {
    file: path.resolve(outFile),
    format,
    name
  };

  const bundle = await rollup.rollup({
    input: moduleName,
    plugins: [jspmRollup({ projectPath, env: opts.env })],
    //external: [],
    format,
    // globals: {},
  });

  const { code, map } = await bundle.generate(outputOptions);
  fs.writeFileSync(path.resolve(outFile), `${code}\n// sourceMappingURL=${path.basename(outFile)}.map`);
  fs.writeFileSync(path.resolve(outFile + '.map'), JSON.stringify(map));
}