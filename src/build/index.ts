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
import { ModuleFormat } from 'rollup';
import { bold, winSepRegEx } from '../utils/common';
import path = require('path');

export interface BuildOptions {
  projectPath?: string;
  removeDir?: boolean;
  env?: any;
  // minify: boolean;
  sourcemap?: boolean;
  out?: string;
  dir?: 'string';
  format?: 'esm' | 'es6' | 'es' | 'cjs' | 'amd' | 'global' | 'system' | 'iife' | 'umd';
  external?: string[];
  globals?: { [id: string]: string };
  banner?: string;
  footer?: string;
  intro?: string;
  showGraph?: boolean;
}

export async function build (input: string | string[], opts: BuildOptions) {
  if (!opts.format || opts.format === 'esm' || opts.format === 'es6')
    opts.format = 'es';
  if (opts.format === 'global')
    opts.format = 'iife';

  const rollupOptions: any = {
    input,
    external: opts.external,
    onwarn: () => {},
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
  let chunks;
  if (opts.out) {
    chunks = {
      [opts.out]: {
        imports: build.imports,
        exports: build.exports,
        modules: build.modules
      }
    };
    await build.write({
      exports: 'named',
      file: opts.out,
      format: <ModuleFormat>opts.format,
      sourcemap: opts.sourcemap,
      indent: true
    });
  }
  else {
    chunks = (<any>build).chunks;
    if (opts.removeDir) {
      rimraf.sync(opts.dir);
      mkdirp.sync(opts.dir);
    }
    await build.write({
      exports: 'named',
      dir: opts.dir,
      format: <ModuleFormat>opts.format,
      sourcemap: opts.sourcemap,
      indent: true
    });
  }

  if (opts.showGraph) {
    console.log('');
    // Improvements to this welcome! sizes in KB? Actual graph display? See also index.ts in es-module-optimizer
    for (let name of Object.keys(chunks)) {
      const entry = chunks[name];
      const deps = entry.imports;
      console.log(`${bold(name)}${deps.length ? ' imports ' : ''}${deps.sort().join(', ')}:`);
      
      for (let module of entry.modules.sort()) {
        console.log(`  ${path.relative(process.cwd(), module.id).replace(winSepRegEx, '/')}`);
      }
      console.log('');
    }
  }
}