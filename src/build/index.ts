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
import { bold, winSepRegEx, JspmUserError } from '../utils/common';
import path = require('path');
import { ok, info } from '../utils/ui';

const defaultEnvTargets = {
  browser: {
    esm: {
      esmodules: true
    },
    other: {
      browsers: ['> 1%', 'last 2 versions', 'Firefox ESR']
    }
  },
  node: {
    esm: {
      node: '8.9.0'
    },
    other: {
      node: '6.12.3'
    }
  }
};

function getDefaultTarget (env: any, target: boolean | string[], esm: boolean) {
  let envTarget, envTargetName;
  if (env.node === false || env.browser === true) {
    if (target)
      envTarget = { browsers: target };
    else if (esm)
      envTarget = defaultEnvTargets.browser.esm;
    else
      envTarget = defaultEnvTargets.browser.other;
  }
  else {
    if (target)
      envTarget = { node: target };
    else if (esm)
      envTarget = defaultEnvTargets.node.esm;
    else
      envTarget = defaultEnvTargets.node.other;
  }
  if (env.node === false || env.browser === true) {
    envTargetName = 'browser ' + (target && (<string[]>target).join(', ') || envTarget.browsers || 'esmodules baseline');
  }
  else {
    envTargetName = 'NodeJS ' + (target && (<string[]>target).join(', ') || envTarget.node);
  }
  return { envTarget, envTargetName };
}

export interface BuildOptions {
  log: boolean;
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
  showGraph?: boolean;
  watch?: boolean;
  target?: boolean | string[];
}

export async function build (input: string | string[], opts: BuildOptions) {
  if (!opts.format || opts.format === 'esm' || opts.format === 'es6')
    opts.format = 'es';
  if (opts.format === 'global')
    opts.format = 'iife';

  let { envTarget, envTargetName } = getDefaultTarget(opts.env || {}, opts.target, opts.format === 'es');
  
  const rollupOptions: any = {
    input,
    external: opts.external,
    onwarn: () => {},
    sourcemap: opts.sourcemap,
    experimentalDynamicImport: true,
    experimentalCodeSplitting: true,
    plugins: [jspmRollup({
      projectPath: opts.projectPath || process.cwd(),
      env: opts.env,
      envTarget
    })]
  };

  if (opts.out)
    rollupOptions.file = opts.out;
  else
    rollupOptions.dir = opts.dir;

  if (opts.watch) {
    if (!opts.out)
      throw new JspmUserError(`jspm build --watch is only supported for single file builds currently.`);
    rollupOptions.output = {
      exports: 'named',
      file: opts.out,
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
        ok(`Built into ${bold(opts.out)}`);
    });
    // pause indefinitely
    await new Promise((_resolve, _reject) => {});
  }

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
      indent: true,
      banner: opts.banner
    });
    if (opts.log)
      ok(`Built into ${bold(opts.out)}${envTargetName ? ' for ' + envTargetName : ''}`);
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
      indent: true,
      banner: opts.banner
    });
    if (opts.log)
      ok(`Built into ${bold(opts.dir + '/')}${envTargetName ? ' for ' + envTargetName : ''}`);
  }

  if (opts.showGraph && opts.log) {
    console.log('');
    // Improvements to this welcome! sizes in KB? Actual graph display? See also index.ts in es-module-optimizer
    for (let name of Object.keys(chunks)) {
      const entry = chunks[name];
      const deps = entry.imports;
      console.log(`${bold(name)}${deps.length ? ' imports ' : ''}${deps.sort().join(', ')}:`);
      
      for (let module of entry.modules.sort((m1, m2) => m1.id > m2.id ? 1 : -1)) {
        console.log(`  ${path.relative(process.cwd(), module.id).replace(winSepRegEx, '/')}`);
      }
      console.log('');
    }
  }
}