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
import { bold, winSepRegEx, highlight } from '../utils/common';
import path = require('path');
import { ok, info, warn } from '../utils/ui';
import { utils, fs as jspmResolveFs } from '@jspm/resolve';
import process = require('process');
import { ImportMap } from '../map';

export interface BuildOptions {
  log: boolean;
  projectPath?: string;
  clearDir?: boolean;
  env?: any;
  buildDeps?: boolean;
  // minify: boolean;
  sourcemap?: boolean;
  mjs?: boolean;
  dir?: string;
  format?: 'esm' | 'module' | 'cjs' | 'commonjs' | 'amd' | 'system' | 'iife' | 'umd';
  external?: string[];
  globals?: { [id: string]: string };
  banner?: string;
  showGraph?: boolean;
  watch?: boolean;
  target?: boolean | string[];
  hashEntries?: boolean;
  mapBase?: string;
}

export async function build (input: string[] | Record<string,string>, opts: BuildOptions): Promise<ImportMap> {
  // esm / cjs as internal default while not yet widely used in Rollup ecosystem
  if (!opts.format)
    opts.format = 'esm';
  if (opts.format === 'module')
    opts.format = 'esm';
  if (opts.format === 'commonjs')
    opts.format = 'cjs';

  let ext = opts.mjs ? '.mjs' : '.js';

  if (opts.dir && opts.dir.endsWith('/'))
    opts.dir = opts.dir.slice(0, -1);

  let inputObj;
  if (input instanceof Array === false) {
    inputObj = input;
  }
  else {
    if (input.length === 0) {
      warn(`No inputs provided to build.`);
      return;
    }
    inputObj = {};
    for (const module of <string[]>input) {
      if (opts.format === 'esm' && 'mjs' in opts === false && module.endsWith('.mjs'))
        ext = '.mjs';
      let basename = path.basename(module);
      if (basename.indexOf('.') !== -1)
        basename = basename.substr(0, basename.lastIndexOf('.'));
      let inputName = basename;
      let i = 0;
      while (inputName in inputObj)
        inputName = basename + i++;
      inputObj[inputName] = module;
    }
  }

  // use .mjs if the output package boundary requires
  if (opts.format === 'esm' && 'mjs' in opts === false && ext !== '.mjs') {
    const outdir = path.resolve(opts.dir);
    const boundary = utils.getPackageBoundarySync.call(jspmResolveFs, outdir + '/');
    if (boundary) {
      const pjson = utils.readPackageConfigSync.call(jspmResolveFs, boundary);
      if (pjson.type !== 'module') {
        let pjsonPath = path.relative(process.cwd(), boundary + '/package.json');
        if (!pjsonPath.startsWith('..' + path.sep))
          pjsonPath = '.' + path.sep + pjsonPath;
        warn(`Output package scope at ${highlight(pjsonPath)} does not have a ${bold('"type": "module"')} boundary, so outputting mjs.`);
        ext = '.mjs';
      }
    }
  }

  const rollupOptions: any = {
    input: inputObj,
    dir: opts.dir,
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
  if (opts.clearDir) {
    rimraf.sync(opts.dir);
    mkdirp.sync(opts.dir);
  }
  const { output } = await build.write({
    entryFileNames: '[name]' + (opts.hashEntries ? '-[hash]' : '') + ext,
    chunkFileNames: 'chunk-[hash]' + ext,
    dir: opts.dir,
    format: <ModuleFormat>opts.format,
    sourcemap: opts.sourcemap,
    indent: true,
    banner: opts.banner
  });
  if (opts.log)
    ok(`Built into ${highlight(opts.dir + '/')}`);

  if (opts.showGraph && opts.log) {
    console.log('');
    // Improvements to this welcome! sizes in KB? Actual graph display? See also index.ts in es-module-optimizer
    for (const chunk of output) {
      const entry = <rollup.OutputChunk>chunk;
      const deps = entry.imports;
      console.log(`${bold(entry.name)}${deps.length ? ' imports ' : ''}${deps.sort().join(', ')}:`);

      const modules = Object.keys(entry.modules).sort((m1, m2) => m1 > m2 ? 1 : -1);
      for (let module of modules) {
        console.log(`  ${path.relative(process.cwd(), module).replace(winSepRegEx, '/')}`);
      }
      console.log('');
    }
  }

  const imports = Object.create(null);
  const mapBase = opts.mapBase || process.cwd();
  for (const [index, key] of Object.keys(inputObj).entries()) {
    const resolvedFile = path.resolve(opts.dir, output[index].fileName);
    let relMap = path.relative(mapBase, resolvedFile).replace(/\\/g, '/');
    if (!relMap.startsWith('../'))
      relMap = './' + relMap;
    imports[inputObj[key]] = relMap;
  }
  return { imports };
}