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
import * as rollup from 'rollup';
import jspmRollup = require('rollup-plugin-jspm');
import rimraf = require('rimraf');
import mkdirp = require('mkdirp');

export interface BuildOptions {
  projectPath?: string;
  removeDir?: boolean;
  env?: any;
  // watch: boolean;
  // excludeExternal: boolean;
  // minify: boolean;
  sourcemap?: boolean;
  out?: string;
  dir?: 'string';
  format?: 'esm' | 'es6' | 'es' | 'cjs' | 'amd' | 'global' | 'system';
  external?: string | string[];
  globals?: { [id: string]: string };
  banner?: string;
  footer?: string;
  intro?: string;
  // watch: boolean;
  // excludeExternal: boolean;
}

export async function build (input: string | string[], opts: BuildOptions) {
  if (!opts.format || opts.format === 'esm' || opts.format === 'es6')
    opts.format = 'es';

  const rollupOptions: any = {
    input,
    sourcemap: opts.sourcemap,
    experimentalDynamicImport: true,
    experimentalCodeSplitting: true,
    plugins: [jspmRollup({
      projectPath: opts.projectPath || process.cwd(),
      env: opts.env
    })]
  };

  if (opts.out)
    rollupOptions.file = opts.out;
  else
    rollupOptions.dir = opts.dir;

  const build = await rollup.rollup(rollupOptions);
  if (opts.out) {
    await build.write({
      file: opts.out,
      format: opts.format,
      sourcemap: opts.sourcemap
    })
  }
  else {
    if (opts.removeDir) {
      rimraf.sync(opts.dir);
      mkdirp.sync(opts.dir);
    }
    await build.write({
      dir: opts.dir,
      format: opts.format,
      sourcemap: opts.sourcemap
    })
  }
}