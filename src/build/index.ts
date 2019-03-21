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
import * as rollup from 'rollup';
import jspmRollup = require('rollup-plugin-jspm');
import rimraf = require('rimraf');
import mkdirp = require('mkdirp');
import { ModuleFormat } from 'rollup';
import { bold, winSepRegEx } from '../utils/common';
import path = require('path');
import { ok, info } from '../utils/ui';

export interface BuildOptions {
  log: boolean;
  projectPath?: string;
  removeDir?: boolean;
  env?: any;
  // minify: boolean;
  sourcemap?: boolean;
  mjs?: boolean;
  dir?: 'string';
  format?: 'esm' | 'cjs' | 'amd' | 'system' | 'iife' | 'umd';
  external?: string[];
  globals?: { [id: string]: string };
  banner?: string;
  showGraph?: boolean;
  watch?: boolean;
  target?: boolean | string[];
}

export async function build (input: string[] | Record<string,string>, opts: BuildOptions) {
  if (!opts.format)
    opts.format = 'esm';

  let ext = opts.mjs ? '.mjs' : '.js';

  let inputObj;
  if (input instanceof Array === false) {
    inputObj = input;
  }
  else {
    inputObj = {};
    for (const module of <string[]>input) {
      if ('mjs' in opts === false && module.endsWith('.mjs'))
        ext = '.mjs';
      let basename = path.basename(module);
      basename = basename.substr(0, basename.lastIndexOf('.'));
      let inputName = basename;
      let i = 0;
      while (inputName in inputObj)
        inputName = basename + i++;
      inputObj[inputName] = module;
    }
  }

  const rollupOptions: any = {
    input: inputObj,
    dir: opts.dir,
    external: opts.external,
    onwarn: () => {},
    sourcemap: opts.sourcemap,
    plugins: [jspmRollup({
      projectPath: opts.projectPath || process.cwd(),
      externals: opts.external,
      env: opts.env
    })]
  };

  if (opts.watch) {
    rollupOptions.output = {
      exports: 'named',
      dir: opts.dir,
      format: <ModuleFormat>opts.format,
      sourcemap: opts.sourcemap,
      indent: true,
      banner: opts.banner
    };
    const watcher = await rollup.watch(rollupOptions);
    let firstRun = true;
    (<any>watcher).on('event', event => {
      if (firstRun)
        firstRun = false;
      else if (event.code === 'BUNDLE_START')
        info(`Rebuilding...`);
      else if (event.code === 'BUNDLE_END')
        ok(`Built into ${bold(opts.dir)}`);
    });
    // pause indefinitely
    await new Promise((_resolve, _reject) => {});
  }

  const build = await rollup.rollup(rollupOptions);
  if (opts.removeDir) {
    rimraf.sync(opts.dir);
    mkdirp.sync(opts.dir);
  }
  const { output } = await build.write({
    entryFileNames: '[name]' + ext,
    chunkFileNames: 'chunk-[hash]' + ext,
    exports: 'named',
    dir: opts.dir,
    format: <ModuleFormat>opts.format,
    sourcemap: opts.sourcemap,
    indent: true,
    banner: opts.banner
  });
  if (opts.log)
    ok(`Built into ${bold(opts.dir + '/')}`);

  if (opts.showGraph && opts.log) {
    console.log('');
    // Improvements to this welcome! sizes in KB? Actual graph display? See also index.ts in es-module-optimizer
    for (const chunk of output) {
      const entry = <rollup.OutputChunk>chunk;
      const deps = entry.imports;
      console.log(`${bold(name)}${deps.length ? ' imports ' : ''}${deps.sort().join(', ')}:`);

      const modules = Object.keys(entry.modules).sort((m1, m2) => m1 > m2 ? 1 : -1);
      for (let module of modules) {
        console.log(`  ${path.relative(process.cwd(), module).replace(winSepRegEx, '/')}`);
      }
      console.log('');
    }
  }
}