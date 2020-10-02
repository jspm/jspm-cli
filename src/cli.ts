/*
 *   Copyright 2020 Guy Bedford
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
import { TraceMap, ImportMap } from './tracemap.js';
import chalk from 'chalk';
import * as fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import * as rollup from 'rollup';
import jspmRollup from './rollup-plugin.js';
import ora from 'ora';
import { logStream } from './log.js';
import { clearCache } from './fetch.js';
import mkdirp from 'mkdirp';
import rimraf from 'rimraf';
import { readHtmlScripts, isPlain, isURL, jsonEquals, jsonParseStyled, jsonStringifyStyled, getIntegrity, SrcScript, SrcScriptParse } from './utils.js';
import * as path from 'path';
import { esmCdnUrl, systemCdnUrl, parseCdnPkg, pkgToStr, parseInstallTarget, getMapMatch, pkgToUrl } from './installtree.js';
import { Installer } from './installer.js';
import clipboardy from 'clipboardy';

function usage (cmd?: string) {
  switch (cmd) {
  case 'install': return `
  jspm install [-m <importmap>]
  
    Options:
      --import-map/-m          Set the path to the import map file
      --out/-o                 Set the path to the output import map
      --minify/-M              Minify import map output
      --system/-s              Use System modules
      --esm/-e                 Use ES modules
      --log/-l=trace,add   Display debugging logs
  `;
  case 'add': return `
  jspm add [-m <importmap>] <pkg>?+
  
    Options:
      --import-map/-m          Set the path to the import map file
      --out/-o                 Set the path to the output import map
      --minify/-M              Minify import map output
      --system/-s              Use System modules
      --esm/-e                 Use ES modules
      --log/-l=trace,add   Display debugging logs
  `;
  case 'cast': return `
  jspm cast <entry>+

    Options:
      --import-map/-m          Set the path to the import map file
      --format/-f              module|systemjs|es-module-shims|json
`;
  case 'build': return `
  jspm build [-m <importmap>] <entry>?+ [-d <outdir>]

    Options
      --import-map/-m          Set the path to the import map file
      --dir/-d                 Set the output directory
      --clear-dir/-c           Clear the output directory before optimizing
      --minify/-M              Minify the buildd modules
      --source-map/-S          Output source maps
      --banner/-b              Provide a banner for the buildd files
      --watch/-w               Watch input files for rebuild on change
      --system/-s              Output system module
      --log/-l=build           Enable the given debug log types
  `;
  }
  const dirname = eval('__dirname');
  const version = JSON.parse(fs.readFileSync(dirname + '/../package.json').toString()).version;
  return `${cmd ? `Unknown command ${chalk.bold(cmd)}\n` : ``}
  > https://jspm.org/cli#v${version} ▪ ES Module Package Management
  
  Manage and build module and import map workflows:

    jspm add [pkgName]+      add a package into an import map

    jspm install             install and validate all imports

    jspm cast [module]+      cast a module graph for serving

    jspm build [module]      build a module graph

  Run "jspm help add" or "jspm help build" for more info.
`;
}

export async function cli (cmd: string | undefined, rawArgs: string[]) {
  // help and version are only commands that support either form in CLI
  if (cmd === '-v' || cmd === '--version')
    cmd = 'version';
  else if (cmd === '-h' || cmd === '--help')
    cmd = 'help';
  switch (cmd) {
    case 'version':
      console.log('jspm-BETA');
      break;

    case 'help':
      console.log(usage(rawArgs[0]));
      break;

    case 'cc':
    case 'cache-clean':
      clearCache();
      console.log(`${chalk.bold.green('OK')}   Cache cleared.`);
      break;
    
    case 't':
    case 'trace':
      try {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['log'],
          strFlags: ['import-map', 'log'],
          aliases: { m: 'import-map', l: 'log' }
        });

        const inMapFile = getInMapFile(opts);
        const inMap = getMapDetectTypeIntoOpts(inMapFile, opts);
        const mapBase = new URL('.', pathToFileURL(inMapFile));
        const traceMap = new TraceMap(mapBase, inMap.map);

        const specifiers = args.length === 0 ? inMap.imports : args;

        if (specifiers.length === 0)
          throw `Nothing to trace.`;

        const { map, trace } = await traceMap.trace(specifiers, <boolean>opts.system);
        logTrace(map, trace, mapBase);
      }
      catch (e) {
        if (typeof e === 'string')
          throw `${chalk.bold.red('ERR')}  ${e}`;
        throw e;
      }
      break;

    case 'ls':
    case 'list':
      try {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['log'],
          strFlags: ['log', 'format'],
          aliases: { l: 'log', f: 'format' }
        });
        
        if (!args.length)
          throw 'No module path provided to list';
        if (args.length > 1)
          throw 'Only one module must be passed to list';

        const installer = new Installer(new TraceMap(pathToFileURL(process.cwd())), opts);
        const { target, subpath } = parseInstallTarget(args[0]);
        const resolved = await installer.resolveLatestTarget(target);
        const pcfg = await installer.getPackageConfig(resolved);
        const matches: string[] = [];
        for (const key of Object.keys(pcfg.exports || {})) {
          if (key.startsWith(subpath) && !key.endsWith('!cjs'))
            matches.push(key);
        }
        if (!matches.length)
          throw `No exports matching ${subpath} in ${pkgToStr(resolved)}`;
        if (opts.format === 'json') {
          const exports = {};
          for (const key of matches)
            exports[key] = pcfg.exports![key];
          console.log(JSON.stringify({ resolved, exports }, null, 2));
          return;
        }
        if (opts.format && opts.format !== 'string')
          throw `Unknown format ${opts.format}`;
        console.log(pkgToStr(resolved));
        const padding = Math.min(Math.max(<number>matches.map(key => key.length).sort((a, b) => a > b ? 1 : -1).pop() + 2, 20), 80);
        for (const key of matches) {
          const value = pcfg.exports![key];
          if (typeof value === 'string') {
            console.log(key + value.padStart(padding - key.length + value.length, ' '));
          }
          else {
            let depth = 0;
            function logNestedObj (obj): string[] {
              depth += 2;
              const curDepth = depth;
              const lines: string[] = [];
              for (const key of Object.keys(obj)) {
                const value = obj[key];
                if (typeof value === 'string') {
                  lines.push(chalk.black.bold(key) + value.padStart(padding - key.length + value.length - curDepth, ' '));
                }
                else {
                  lines.push(key);
                  for (const line of logNestedObj(value))
                    lines.push(line);
                }
              }
              return indentGraph(lines, false);
            }
            console.log(key + '\n' + logNestedObj(value).join('\n'));
          }
        }
      }
      catch (e) {
        if (typeof e === 'string')
          throw `${chalk.bold.red('ERR')}  ${e}`;
        throw e;
      }
      break;

    case 'l':
    case 'locate':
      try {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['log', 'system', 'copy', 'no-crossorigin', 'no-integrity'],
          strFlags: ['log', 'format'],
          arrFlags: ['conditions'],
          aliases: { l: 'log', f: 'format', c: 'copy', u: 'conditions' }
        });
        
        if (!args.length)
          throw 'No module path provided to locate';
        if (args.length > 1)
          throw 'Only one module must be passed to locate';

        if (opts.format === 'system')
          opts.system = true;

        const installer = new Installer(new TraceMap(pathToFileURL(process.cwd()), undefined, <string[] | undefined>opts.conditions), opts);
        const { target, subpath } = parseInstallTarget(args[0]);
        const resolved = await installer.resolveLatestTarget(target);
        const exports = await installer.resolveExports(resolved, await installer.getPackageConfig(resolved), false);

        let url: string;
        if (subpath === './') {
          url = pkgToUrl(resolved, opts.system ? systemCdnUrl : esmCdnUrl) + '/';
        }
        else {
          const exportsMatch = getMapMatch(subpath, exports);
          if (!exportsMatch)
            throw `No exports match for ${subpath} in ${pkgToStr(resolved)}`;
          if (exports[exportsMatch] === null)
            throw `No resolution for ${subpath} with the ${(<string[] | undefined>opts.conditions || ['browser', 'development']).join(', ')} conditions for ${pkgToStr(resolved)}`;
          url = pkgToUrl(resolved, opts.system ? systemCdnUrl : esmCdnUrl) + exports[exportsMatch].slice(1);
        }

        switch (opts.format || (opts.system ? 'script' : 'module')) {
          case 'string':
            output(url + (opts.noIntegrity ? '' : '\n' + await getIntegrity(url)), opts);
            return;
          case 'system':
          case 'script':
            output(`<script src="${url}"${opts.noIntegrity ? '' : ` integrity="${await getIntegrity(url)}"`}${opts.noCrossorigin ? '' : ' crossorigin="anonymous"'}></script>`, opts);
            return;
          case '@import':
            output(`@import url('${url}')`, opts);
            return;
          case 'style':
            output(`<link rel="stylesheet"${opts.noIntegrity ? '' : ` integrity="${await getIntegrity(url)}"`}${opts.noCrossorigin ? '' : ' crossorigin="anonymous"'} href="${url}"/>`, opts);
            return;
          case 'module':
            output(`<script type="module"${opts.noIntegrity ? '' : ` integrity="${await getIntegrity(url)}"`}${opts.noCrossorigin ? '': ' crossorigin="anonymous"'} src="${url}"></script>`, opts);
            return;
          default:
            throw `Unknown format ${opts.format}`;
        }
      }
      catch (e) {
        if (typeof e === 'string')
          throw `${chalk.bold.red('ERR')}  ${e}`;
        throw e;
      }
      break;

    case 'i':
    case 'init':
      throw new Error('TODO: jspm init');

    case 'c':
    case 'cast':
      try {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['log', 'copy', 'no-integrity', 'no-crossorigin', 'no-depcache', 'minify', 'out', 'clear', 'flatten', 'dev', 'no-dynamic'],
          strFlags: ['import-map', 'log', 'format', 'relative', 'out'],
          aliases: { m: 'import-map', l: 'log', f: 'format', c: 'copy', o: 'out', M: 'minify', d: 'depcache', F: 'flatten' }
        });

        const inMapFile = getInMapFile(opts);
        if (inMapFile && inMapFile.endsWith('.importmap') && !opts.out)
          opts.out = true;
        const outMapFile = opts.out !== true ? getOutMapFile(inMapFile, opts) : undefined;
        const inMap = getMapDetectTypeIntoOpts(inMapFile, opts);
        const mapBase = new URL('.', pathToFileURL(inMapFile));
        const traceMap = new TraceMap(mapBase, inMap.map);

        if (!opts.system)
          opts.noDynamic = true;
        if (opts.dev)
          opts.noIntegrity = true;

        const specifiers = args.length === 0 ? inMap.imports : args;

        if (opts.clear) {
          if (args.length !== 0)
            throw `Unexpected module arguments. Use eg ${chalk.bold(`jspm cast ${rawArgs.filter(arg => !args.includes(arg)).join(' ')}`)} without any module arguments to remove existing casts.`;
        }

        let staticSize = 0;
        let dynamicSize = 0;
        let sortedStatic: any[] = [];
        traceMap.clearIntegrity();
        traceMap.clearDepcache();
        if (opts.dev) {
          sortedStatic = specifiers.map(specifier => {
            const resolved = traceMap.resolve(specifier, traceMap.baseUrl);
            if (!resolved)
              throw new Error(`No resolution for ${specifier}.`);
            return traceMap.baseUrlRelative(resolved);
          });
        }
        else if (!opts.clear) {
          const spinner = startSpinnerLog(opts.log);
          if (spinner) spinner.text = `Casting ${specifiers.join(', ').slice(0, process.stdout.columns - 12)}...`;

          try {
            var { trace } = await traceMap.trace(specifiers, <boolean>opts.system, !opts.noDepcache && !opts.noDynamic);
          }
          finally {
            if (spinner) spinner.stop();
          }

          sortedStatic = Object.keys(trace).filter(t => !trace[t].dynamicOnly).sort((a, b) => trace[a].order > trace[b].order ? 1 : -1).map(dep => {
            staticSize += trace[dep].size;
            if (!dep.startsWith('file:'))
              return dep;
            const rel = relModule(new URL(dep), mapBase || pathToFileURL(path.resolve(<string>opts.relative || process.cwd())), false);
            return rel.startsWith('./') ? rel.slice(2) : rel;
          });

          // iterate the dynamic to compute dynamic size and populate their integrity
          for (const m of Object.keys(trace)) {
            const entry = trace[m];
            if (!entry.dynamicOnly)
              continue;
            dynamicSize += trace[m].size;
            if (!opts.noIntegrity && !opts.noDynamic) {
              const resolved = m.startsWith('https:') || m.startsWith('file:') ? new URL(m) : pathToFileURL(path.resolve(<string>opts.relative || process.cwd(), m));
              traceMap.setIntegrity(relModule(resolved, mapBase || pathToFileURL(path.resolve(<string>opts.relative || process.cwd())), false), await getIntegrity(resolved.href));
            }
          }
          if (!opts.noIntegrity && !opts.noDynamic)
            traceMap.sortIntegrity();
        }

        let moduleType;
        switch (opts.format || (opts.system ? 'system' : 'module')) {
          case 'json':
            console.log(JSON.stringify(sortedStatic, null, 2));
            return;
          case 'es-module-shims':
            if (opts.system)
              throw 'ES Module Shims does not support loading SystemJS modules.';
            moduleType = 'module-shim';
            break;
          case 'system':
            if (!opts.system)
              throw 'SystemJS does not support loading ES modules. Run a conversion into System modules first.'
            moduleType = '';
            break;
          case 'module':
            if (opts.system)
              throw 'Native ES modules do not support loading SystemJS modules.';
            moduleType = 'module';
            break;
          default:
            throw `Unknown cast format ${chalk.bold(opts.format)}`;
        }

        const outputPreloads: SrcScript[] = await Promise.all(sortedStatic.map(async dep => ({
          type: moduleType,
          src: dep,
          integrity: opts.noIntegrity ? undefined : await getIntegrity(dep.startsWith('https://') ? dep : pathToFileURL(path.resolve(opts.relative || process.cwd(), dep))),
          crossorigin: !opts.noCrossorigin && (dep.startsWith(systemCdnUrl) || dep.startsWith(esmCdnUrl)) ? true : undefined,
          jspmCast: !dep.startsWith(systemCdnUrl) && !dep.startsWith(esmCdnUrl)
        })));

        if (opts.flatten)
          traceMap.flatten();
        const mapStr = traceMap.toString(<boolean>opts.minify);
        const preloads = outputPreloads.map(({ type, src, integrity, crossorigin, jspmCast }) =>
          `<script ${type ? `type="${type}" ` : ''}src="${src}"${integrity ? ` integrity="${integrity}"` : ''}${crossorigin ? ' crossorigin="anonymous"' : ''}${jspmCast ? ' jspm-cast' : ''}></script>`
        ).join('\n');
        if (outMapFile) {
          if (outMapFile.endsWith('.importmap'))
            throw `Cannot cast into an import map.`;

          if (outMapFile.endsWith('.json')) {
            if (opts.clear)
              throw `Can only clear casts in XML files.`;
            const outObj = {
              importMap: JSON.parse(mapStr),
              preloads
            };
            fs.writeFileSync(outMapFile, opts.minify ? JSON.stringify(outObj) : JSON.stringify(outObj, null, 2));
          }
          else {
            writeMap(outMapFile, mapStr, <boolean>opts.system);
            writePreloads(outMapFile, outputPreloads, opts.minify ? true : false);
          }
          if (opts.clear)
            console.log(`${chalk.bold.green('OK')}   Casts cleared.`);
          else
            console.log(`${chalk.bold.green('OK')}   Cast ${specifiers.map(name => chalk.bold(name)).join(', ')} into ${outMapFile} ${(staticSize || dynamicSize) ? `(${chalk.cyan.bold(`${Math.round(staticSize / 1024 * 10) / 10}KiB`)}${dynamicSize ? ' static, ' + chalk.cyan(`${Math.round(dynamicSize / 1024 * 10) / 10}KiB`) + ' dynamic' : ''}).` : ''}`);
        }
        else {
          output((mapStr === '{}' ? '' : `<script type="${opts.system ? 'systemjs-importmap' : 'importmap'}">\n` + mapStr + '</script>\n') + preloads, opts);
        }
      }
      catch (e) {
        if (typeof e === 'string')
          throw `${chalk.bold.red('ERR')}  ${e}`;
        throw e;
      }
      break;

    case 'r':
    case 'resolve':
      try {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['relative', 'log', 'copy'],
          strFlags: ['relative', 'import-map', 'log'],
          aliases: { m: 'import-map', l: 'log', r: 'relative', c: 'copy' }
        });

        if (args.length > 2)
          throw `Resolve only takes two arguments.`;
        if (args.length === 0)
          throw `Resolve must take a specifier to resolve.`;
        const inMapFile = getInMapFile(opts);
        const inMap = getMapDetectTypeIntoOpts(inMapFile, opts);
        const traceMap = new TraceMap(new URL('.', pathToFileURL(inMapFile)).href, inMap.map);

        const baseUrl = new URL('.', pathToFileURL(inMapFile));
        const parentUrl = args[1] && await traceMap.resolve(args[1], baseUrl) || baseUrl;

        const resolved = await traceMap.resolve(args[0], parentUrl);
        if (resolved === null) {
          output('@empty', opts);
        }
        else if (opts.relative && resolved.protocol === 'file:') {
          output(relModule(resolved, pathToFileURL(opts.relative === true ? process.cwd() : path.resolve(opts.relative))), opts);
        }
        else {
          output(resolved.href, opts);
        }
      }
      catch (e) {
        if (typeof e === 'string')
          throw `${chalk.bold.red('ERR')}  ${e}`;
        throw e;
      }
      break;

    case 'up':
    case 'update':
      throw `${chalk.bold.red('ERR')}  TODO: jspm update`;

    case 'upgrade':
      throw `${chalk.bold.red('ERR')}  TODO: jspm upgrade`;

    case 'r':
    case 'remove': {
      const { args, opts } = readFlags(rawArgs, {
        boolFlags: ['log', 'copy', 'minify'],
        strFlags: ['out', 'log', 'import-map'],
        aliases: { m: 'import-map', o: 'out', l: 'log', c: 'copy', 'M': 'minify' }
      });

      opts.clean = true;

      const inMapFile = getInMapFile(opts);
      const outMapFile = getOutMapFile(inMapFile, opts);
      const inMap = getMapDetectTypeIntoOpts(inMapFile, opts);

      const traceMap = new TraceMap(new URL('.', pathToFileURL(inMapFile)).href, inMap.map);

      for (const arg of args) {
        if (!traceMap.remove(arg))
          throw `${chalk.bold.red('ERR')}  Cannot remove ${chalk.bold(arg)} as it doesn't exist in "imports".`;
      }

      await traceMap.install(opts);

      const imports = traceMap.map.imports;
      for (const arg of args) {
        if (imports[arg])
          throw `${chalk.bold.red('ERR')}  Cannot remove ${chalk.bold(arg)} as it is in use by an existing package.`;
      }

      const mapStr = traceMap.toString(<boolean>opts.minify);
      if (opts.copy) {
        console.log(chalk.bold('(Import map copied to clipboard)'));
        clipboardy.writeSync(mapStr);
      }

      writeMap(outMapFile, mapStr, <boolean>opts.system);
      console.log(`${chalk.bold.green('OK')}   Removed ${args.map(arg => chalk.bold(arg)).join(', ')}.`);
      break;
    }
  
    case undefined:
      cmd = 'install';
    case 'install':
    case 'a':
      if (cmd === 'a')
        cmd = 'install';
    case 'add':
      try {
        // TODO: Flags
        // lock | latest | clean | force | installExports
        // flatten / clean only ones needing dev work?
        // clean works based on tracking which paths were used, removing unused
        // only applies to arguments install (jspm install --clean) and not any other
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['flatten', 'system', 'esm', 'minify', 'log', 'copy'],
          strFlags: ['import-map', 'out', 'log'],
          aliases: { m: 'import-map', o: 'out', l: 'log', f: 'flatten', M: 'minify', s: 'system', e: 'esm', c: 'copy' }
        });

        if (cmd === 'install') {
          if (args.length && args.some(arg => isPlain(arg))) {
            console.log(`Executing ${chalk.bold('jspm add ' + rawArgs.join(' '))}`);
            cmd = 'add';
          }
        }
        else {
          if (!args.length) {
            console.log(`Executing ${chalk.bold('jspm install ' + rawArgs.join(' '))}`);
            cmd = 'install';
          }
        }

        const inMapFile = getInMapFile(opts);
        const outMapFile = getOutMapFile(inMapFile, opts);
        const inMap = getMapDetectTypeIntoOpts(inMapFile, opts);
        const traceMap = new TraceMap(new URL('.', pathToFileURL(inMapFile)).href, inMap.map);

        const spinner = startSpinnerLog(opts.log);
        if (spinner) spinner.text = `${cmd[0].toUpperCase()}${cmd.slice(1)}ing${args.length ? ' ' + args.join(', ').slice(0, process.stdout.columns - 14) : ''}...`;

        let changed: string[] | undefined;
        try {
          if (cmd === 'install') {
            // TODO: changed handling from install
            // can skip map saving when no change
            opts.clean = true;
            await traceMap.install(opts, args.length ? args : inMap.imports);
          }
          else {
            await traceMap.add(args.map(arg => {
              const eqIndex = arg.indexOf('=');
              if (eqIndex === -1) return arg;
              return {
                name: arg.slice(0, eqIndex),
                target: arg.slice(eqIndex + 1)
              };
            }), opts);
          }
        }
        finally {
          if (spinner) spinner.stop();
        }
        if (true) {
          // TODO: Styled JSON read / write
          // TODO: rebase to output map path
          const mapStr = traceMap.toString(<boolean>opts.minify);
          if (opts.copy) {
            console.log(chalk.bold('(Import map copied to clipboard)'));
            clipboardy.writeSync(mapStr);
          }
          writeMap(outMapFile, mapStr, <boolean>opts.system);
          console.log(`${chalk.bold.green('OK')}   Successfully ${cmd}ed${changed && changed.length ? ' ' + changed.map(arg => chalk.bold(arg)).join(', ') : ''}.`);
        }
        else {
          console.log(`${chalk.bold.green('OK')}   Already ${cmd}ed.`);
        }
      }
      catch (e) {
        if (typeof e === 'string')
          throw `${chalk.bold.red('ERR')}  ${e}`;
        throw e;
      }
      break;
  
    case 'o':
    case 'build':
      try {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['clear-dir', 'source-map', 'watch', 'minify', 'out', 'log', 'flatten', 'depcache', 'inline-maps', 'package', 'hash-entries', 'inline'],
          strFlags: ['import-map', 'dir', 'out', 'banner', 'log', 'format'],
          aliases: { m: 'import-map', c: 'clear-dir', S: 'source-map', w: 'watch', M: 'minify', o: 'out', l: 'log', d: 'dir', b: 'banner', i: 'inline', h: 'hash-entries', f: 'format' }
        });

        const dir = opts.dir ? ((<string>opts.dir).endsWith('/') ? (<string>opts.dir).slice(0, -1) : <string>opts.dir) : 'dist';

        const inMapFile = getInMapFile(opts);
        const outMapFile = getOutMapFile(inMapFile, opts);
        const map = getMapDetectTypeIntoOpts(inMapFile, opts);
        const baseUrl = new URL('.', pathToFileURL(inMapFile));

        let distMapRelative = path.relative(path.resolve(inMapFile, '..'), dir).replace(/\//g, '/');
        if (!distMapRelative.startsWith('../'))
          distMapRelative = './' + distMapRelative;

        const inputObj: Record<string, string> = {};
        const modules = args.length ? args : Object.keys(map.imports);
        for (const module of modules) {
          let basename = path.basename(module);
          if (basename.indexOf('.') !== -1)
            basename = basename.substr(0, basename.lastIndexOf('.'));
          let inputName = basename;
          let i = 0;
          while (inputName in inputObj)
            inputName = basename + i++;
          inputObj[inputName] = module;
        }

        if (!opts.format)
          opts.format = 'esm';
        
        const externals = !opts.inline;

        const rollupOptions: any = {
          input: inputObj,
          onwarn: () => {},
          plugins: [jspmRollup({ map: JSON.parse(map.map), baseUrl, externals, format: <string>opts.format, inlineMaps: <boolean>opts.inlineMaps, sourceMap: opts.sourceMap })]
        };

        const outputOptions = {
          entryFileNames: opts.hashEntries ? '[name]-[hash].js' : '[name].js',
          chunkFileNames: 'chunk-[hash].js',
          preserveEntrySignatures: 'allow-extension',
          dir,
          compact: true,
          format: opts.format,
          sourcemap: opts.sourceMap,
          indent: true,
          interop: false,
          banner: opts.banner
        };

        const { json: outMap, style: outMapStyle } = jsonParseStyled(map.map);
        if (opts.minify)
          outMapStyle.indent = outMapStyle.tab = outMapStyle.newline = '';

        if (opts.watch) {
          if (!opts.out) {
           //  throw `Watched builds only supported when using --out separate to the input import map.`;
          }
          const spinner = startSpinnerLog(opts.log);
          spinner.text = `Optimizing${args.length ? ' ' + args.join(', ').slice(0, process.stdout.columns - 12) : ''}...`;

          rollupOptions.output = outputOptions;
          const watcher = await rollup.watch(rollupOptions);
          let firstRun = true;
          (<any>watcher).on('event', event => {
            if (firstRun) {
              firstRun = false;
            }
            else if (event.code === 'BUNDLE_START') {
              if (spinner) {
                spinner.start();
                spinner.text = `Optimizing${args.length ? ' ' + args.join(', ').slice(0, process.stdout.columns - 12) : ''}...`;
              }
            }
            else if (event.code === 'BUNDLE_END') {
              spinner.stop();
              console.log(`${chalk.bold.green('OK')}   Built into ${chalk.bold(dir + '/')}`);

              console.error('TODO: Rollup PR to get output info for saving build map in watch mode.');

              for (const input of Object.keys(inputObj)) {
                const chunk = output.find(chunk => chunk.name === input);
                outMap.imports[inputObj[input]] = `${distMapRelative}/${chunk.fileName}`;
              }
    
              // writeMap(outMapFile, jsonStringifyStyled(outMap, outMapStyle), <boolean>opts.system);

              console.log(`     Watching for changes...`);
            }
          });
          // keep alive
          setInterval(() => {}, 5000);
          return;
        }

        const spinner = startSpinnerLog(opts.log);
        if (spinner) spinner.text = `Building${args.length ? ' ' + args.join(', ').slice(0, process.stdout.columns - 12) : ''}...`;

        try {
          const build = await rollup.rollup(rollupOptions);

          if (opts.clearDir) {
            rimraf.sync(dir);
            mkdirp.sync(dir);
          }

          const { output } = await build.write(outputOptions);

          spinner.stop();
          console.log(`${chalk.bold.green('OK')}   Built into ${chalk.bold(dir + '/')}`);

          let backupName: string = 'jspm.importmap';
          if (!opts.out && false) {
            if (path.resolve(outMapFile) === path.resolve(backupName) || fs.existsSync(backupName) && !jsonEquals(fs.readFileSync(backupName).toString(), map.map)) {
              const basename = path.basename(inMapFile).slice(0, -path.extname(inMapFile).length);
              backupName = basename + '.importmap';
              if (path.resolve(outMapFile) === path.resolve(backupName) || fs.existsSync(backupName) && !jsonEquals(fs.readFileSync(backupName).toString(), map.map)) {
                let idx = 1;
                while (path.resolve(outMapFile) === path.resolve(`${basename}-${idx}.importmap`) || fs.existsSync(`${basename}-${idx}.importmap`) && !jsonEquals(fs.readFileSync(`${basename}-${idx}.importmap`).toString(), map.map)) {
                  idx++;
                }
                backupName = `${basename}-${idx}.importmap`;
              }
            }
            fs.writeFileSync(backupName, map.map);
          }
          if (!opts.out && false) {
            console.log(`     A backup of the previous unbuilt import map has been saved to ${chalk.bold(backupName)}.`);
            console.log(`${chalk.blue('TIP')}  To rebuild, run ${chalk.bold(`jspm build${backupName === 'jspm.importmap' ? '' : ' -m ' + backupName} -o ${opts.importMap || 'jspm.importmap'}`)}`);
            console.log(`     To revert, run ${chalk.bold(`jspm install${backupName === 'jspm.importmap' ? '' : ' -m ' + backupName} -o ${opts.importMap || 'jspm.importmap'}`)}`);
          }

          if (false)
          for (const input of Object.keys(inputObj)) {
            const chunk = output.find(chunk => chunk.name === input);
            outMap.imports[inputObj[input]] = `${distMapRelative}/${chunk.fileName}`;
          }

          const mapBase = new URL('.', pathToFileURL(outMapFile));
          const traceMap = new TraceMap(mapBase, outMap);
          if (false) {
            const { map, trace } = await traceMap.trace(modules, <boolean>opts.system);
            logTrace(map, trace, mapBase);
          }

          // TODO: use trace to filter output map
          // handle case of output map being empty
          const usedExternals = [];
          // NOTE: Disabled because screw this
          // writeMap(outMapFile, jsonStringifyStyled(outMap, outMapStyle), <boolean>opts.system);
        }
        catch (e) {
          if (spinner) spinner.stop();
          throw e;
        }
      }
      catch (e) {
        if (typeof e === 'string')
          throw `${chalk.bold.red('ERR')}  ${e}`;
        throw e;
      }
      break;

    default:
      throw usage(cmd);
  }
}

const nodes = {
  end: chalk.bold('└'),
  middle: chalk.bold('├'),
  skip: chalk.bold('│'),
  item: chalk.bold('╴')
};

function isItemLine (line: string) {
  return  !line.startsWith(nodes.end) && !line.startsWith(nodes.middle) && !line.startsWith(nodes.skip) && line[0] !== ' ';
}
function indentGraph (lines: string[]) {
  let lastItemLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isItemLine(lines[i])) {
      lastItemLine = i;
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isItemLine(line))
      lines[i] = (i >= lastItemLine ? nodes.end : nodes.middle) + nodes.item + line;
    else
      lines[i] = (i >= lastItemLine ? ' ' : nodes.skip) + ' ' + line;
  }
  return lines;
}
function logTrace (map, trace, mapBase: URL) {

  const seen = new Map();
  let idx = 0;
  console.log('');
  for (const specifier of Object.keys(map)) {
    for (const line of logVisit(specifier, map, null, false)) {
      console.log(line);
    }
  }

  function logVisit (specifier, curMap, parentURL, dynamic): string[] {
    const resolved = curMap[specifier];
    const resolvedTrace = trace[resolved.href];
    const keys = Object.keys(resolvedTrace.deps);
    const dynamicKeys = Object.keys(resolvedTrace.dynamicDeps);

    if (seen.has(resolved.href)) {
      if (isPlain(specifier))
        return [`${specifier} ${(`@${seen.get(resolved.href)}`)}`];
      return [];
    }

    const curIdx = ++idx;
    seen.set(resolved.href, curIdx);

    let depGraphLines: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      depGraphLines = depGraphLines.concat(logVisit(keys[i], resolvedTrace.deps, resolved, false));
    }
    for (let i = 0; i < dynamicKeys.length; i++) {
      if (keys.includes(dynamicKeys[i]))
        continue;
      depGraphLines = depGraphLines.concat(logVisit(dynamicKeys[i], resolvedTrace.dynamicDeps, resolved, true));
    }
    const logSpecifier = isPlain(specifier) ? specifier : isURL(specifier) ? relModule(resolved, parentURL) : specifier;
    return [
      `${dynamic ? chalk.bold.black(logSpecifier) : logSpecifier} ${isPlain(specifier) ? `(${relModule(resolved, mapBase)}) ` : ''}${chalk.cyan(`${Math.round(resolvedTrace.size / 1024 * 10) / 10}KiB`)} ${chalk.black.bold(`[${curIdx}]`)}`,
      ...indentGraph(depGraphLines)
    ];
  }
}

function relModule (url: URL, relBase: URL, parse = true) {
  if (url.protocol === 'file:' && relBase.protocol === 'file:') {
    const relBasePath = fileURLToPath(relBase);
    let relPath = path.relative(relBasePath, fileURLToPath(url)).replace(/\\/g, '/');
    if (!relPath.startsWith('../'))
      relPath = './' + relPath;
    return relPath;
  }
  else if (url.protocol === relBase.protocol && url.origin === relBase.origin && url.pathname.slice(1, url.pathname.indexOf('/')) !== relBase.pathname.slice(1, relBase.pathname.indexOf('/'))) {
    let relPath = path.relative(path.dirname(relBase.pathname), url.pathname).replace(/\\/g, '/');
    if (!relPath.startsWith('../'))
      relPath = './' + relPath;
    return relPath;
  }
  else {
    const parsed = parse && parseCdnPkg(url);
    if (parsed)
      return pkgToStr(parsed) + parsed.path;
    else
      return url.href;
  }
}

function getInMapFile (opts: Record<string, string | boolean>): string {
  let inMapFile = <string>opts.importMap || 'jspm.importmap';
  if (inMapFile.endsWith('/') || inMapFile.endsWith('\\'))
    inMapFile += 'jspm.importmap';
  return inMapFile;
}

function getOutMapFile (inMapFile: string, opts: Record<string, string | boolean>): string {
  let outMapFile = <string>opts.out || inMapFile;
  if (outMapFile.endsWith('/') || outMapFile.endsWith('\\'))
    outMapFile += 'jspm.importmap';
  return outMapFile;
}

function writePreloads (outMapFile: string, preloads: SrcScript[], minify: boolean) {
  let outSource = fs.existsSync(outMapFile) ? fs.readFileSync(outMapFile).toString() : '';
  let { map: [,,,mapOuterEnd], srcScripts } = readHtmlScripts(outSource, outMapFile);
  let space = '\n';
  if (minify) {
    space = '';
  }
  else {
    if (outSource === '') {
      space = '\n';
    }
    else if (mapOuterEnd !== -1) {
      const nl = outSource.indexOf('\n', mapOuterEnd);
      if (nl !== -1) {
        const detectedSpace = outSource.slice(mapOuterEnd, nl + 1);
        if (detectedSpace.match(/\s*/))
          space = detectedSpace;
      }
    }
    else {
      // TODO: space detection for files without an import map
      space = '\n';
    }
  }

  let diff = 0;
  // first remove existing preloads
  for (const script of srcScripts) {
    if (script.start < mapOuterEnd)
      continue;
    const isPreload = script.src.startsWith(systemCdnUrl) || script.src.startsWith(esmCdnUrl) || script.jspmCast;
    if (isPreload)
      ({ outSource, diff } = removeScript(outSource, diff, script, mapOuterEnd));
  }

  const outPreloadSource = (mapOuterEnd !== -1 && preloads.length ? (space || '\n') : '') + preloads.map(({ type, src, integrity, crossorigin, jspmCast }) =>
    `<script ${type ? `type="${type}" ` : ''}src="${src}"${integrity ? ` integrity="${integrity}"` : ''}${crossorigin ? ' crossorigin="anonymous"' : ''}${jspmCast ? ' jspm-cast' : ''}></script>`
  ).join(space) + (outSource === '' ? '\n' : '');
  outSource = outSource.slice(0, mapOuterEnd) + outPreloadSource + outSource.slice(mapOuterEnd);
  fs.writeFileSync(outMapFile, outSource);
}

function removeScript (outSource: string, diff: number, script: SrcScriptParse, mapOuterEnd: number): { outSource: string, diff: number } {
  let spaceLen = 0;
  const nl = outSource.lastIndexOf('\n', script.start + diff);
  if (nl !== -1) {
    const detectedSpace = outSource.slice(nl, script.start + diff);
    if (detectedSpace.match(/\s*/))
      spaceLen = detectedSpace.length + 1;
  }
  // never overshoot ws removal into the map itself
  while (script.start - spaceLen + diff < mapOuterEnd)
    spaceLen--;
  outSource = outSource.slice(0, script.start - spaceLen + diff) + outSource.slice(script.end + diff);
  diff -= script.end - script.start + spaceLen;
  return { outSource, diff };
}

function writeMap (outMapFile: string, mapString: string, system: boolean) {
  if (outMapFile.endsWith('.importmap') || outMapFile.endsWith('.json')) {
    fs.writeFileSync(outMapFile, mapString);
  }
  else {
    let outSource = fs.existsSync(outMapFile) ? fs.readFileSync(outMapFile).toString() : `<script type="${system ? 'systemjs-importmap' : 'importmap'}"></script>\n`;
    let { type: [typeStart, typeEnd], map: [mapStart, mapEnd] } = readHtmlScripts(outSource, outMapFile);
    if (mapStart === -1)
      throw `No <script type="${system ? 'systemjs-importmap' : 'importmap'}"> found in ${outMapFile}`;
    let diff = 0;
    if (system && outSource.slice(typeStart, typeEnd) !== 'systemjs-importmap') {
      // System switch
      outSource = outSource.slice(0, typeStart + diff) + 'systemjs-importmap' + outSource.slice(typeEnd + diff);
      diff += 18 - (typeEnd - typeStart);
    }
    if (!system && outSource.slice(typeStart, typeEnd) !== 'importmap' && outSource.slice(typeStart, typeEnd) !== 'importmap-shim') {
      // Esm switch
      outSource = outSource.slice(0, typeStart + diff) + 'importmap' + outSource.slice(typeEnd + diff);
      diff += 9 - (typeEnd - typeStart);
    }
    outSource = outSource.slice(0, mapStart + diff) + '\n' + mapString + outSource.slice(mapEnd + diff);
    diff += mapString.length + 1 - (mapEnd - mapStart);
    fs.writeFileSync(outMapFile, outSource);
  }
}

// TODO: refactor this stuff more sensibly
function getMapDetectTypeIntoOpts (inMapFile: string, opts: Record<string, string | boolean>): { map: string, imports: string[] } {
  let inMap: ImportMap = { imports: {}, scopes: {}, depcache: {} };
  const returnVal: {
    map: string,
    imports: string[]
  } = {
    map: '{}\n',
    imports: []
  };
  if (fs.existsSync(inMapFile)) {
    const source = fs.readFileSync(inMapFile).toString();    
    // support HTML parsing
    if (!inMapFile.endsWith('.importmap') && !inMapFile.endsWith('.json')) {
      const { type, map, srcScripts } = readHtmlScripts(source, inMapFile);
      if (map[0] === -1)
        throw `${inMapFile} must be a ".importmap" or ".json" file, or an XML file containing a <script type="importmap"> section.`;
      const mapStr = source.slice(map[0], map[1]);
      if (mapStr.trim().length !== 0) {
        const firstNewline = mapStr.match(/\n|[^\s]/)?.index;
        returnVal.map = Number(firstNewline) > -1 ? mapStr.slice(<number>firstNewline + 1) : mapStr;
      }
      inMap = JSON.parse(source.slice(...map).trim() || '{}');
      if (!opts.system && !opts.esm) {
        if (source.slice(...type) === 'systemjs-importmap')
          opts.system = true;
        else
          opts.esm = true;
      }
      returnVal.imports = [
        ...Object.keys(inMap.imports || {}),
        ...opts.system ? [] : srcScripts.filter(script => !script.src).map(script => `data:application/javascript,${encodeURIComponent(source.slice(script.srcStart, script.srcEnd))}`)
      ];
    }
    else {
      returnVal.map = fs.readFileSync(inMapFile).toString();
      if (returnVal.map.trim().length === 0)
        returnVal.map = '{}\n';
      inMap = JSON.parse(returnVal.map);
      returnVal.imports = Object.keys(inMap.imports || {});
    }
  }

  // esm / system detection
  if (!opts.esm && !opts.system) {
    if (inMap.imports) {
      for (const val of Object.values(inMap.imports)) {
        if (val?.startsWith(esmCdnUrl)) {
          opts.esm = true;
          return returnVal;
        }
        if (val?.startsWith(systemCdnUrl)) {
          opts.system = true;
          return returnVal;
        }
      }
    }
    if (inMap.scopes) {
      for (const scope of Object.keys(inMap.scopes)) {
        if (scope.startsWith(esmCdnUrl)) {
          opts.esm = true;
          return returnVal;
        }
        if (scope.startsWith(systemCdnUrl)) {
          opts.system = true;
          return returnVal;
        }

        for (const val of Object.values(inMap.scopes[scope])) {
          if (val?.startsWith(esmCdnUrl)) {
            opts.esm = true;
            return returnVal;
          }
          if (val?.startsWith(systemCdnUrl)) {
            opts.system = true;
            return returnVal;
          }
        }
      }
    }
    if (inMap.depcache) {
      for (const url of Object.keys(inMap.depcache)) {
        if (url.startsWith(esmCdnUrl)) {
          opts.esm = true;
          return returnVal;
        }
        if (url.startsWith(systemCdnUrl)) {
          opts.system = true;
          return returnVal;
        }
      }
    }
    opts.esm = true;
  }
  return returnVal;
}

function startSpinnerLog (log: boolean | string) {
  let spinner;
  if (!log) {
    spinner = ora({
      color: 'yellow',
      spinner: {
        interval: isCygwin() ? 7 : 100,
        frames: (<any>[".   ", ".   ", "..  ", "..  ", "... ", "... ", " ...", " ...", "  ..", "  ..", "   .", "   .", "    ", "    ", "    ", "    "].map(x => isCygwin() ? [x, x, x, x, x, x, x, x, x, x] : x)).flat()
      }
    });  
    spinner.start();
  }
  else {
    (async () => {
      const debugTypes = typeof log === 'string' ? log.split(',') : [];
      for await (const log of logStream()) {
        if (debugTypes.length === 0 || debugTypes.indexOf(log.type) !== -1) {
          console.log(`${chalk.gray(log.type)}: ${log.message}`);
        }
      }
    })().catch(e => {
      throw `${chalk.bold.red('ERR')}  ${e.message}`;
    });
  }
  return spinner;
}

function readFlags (rawArgs: string[], { boolFlags = [], strFlags = [], arrFlags = [], aliases = {} }: { boolFlags: string[], strFlags: string[], arrFlags: string[], aliases: Record<string, string>, err?: string }) {
  function toCamelCase (name) {
    return name.split('-').map((part, i) => i === 0 ? part : part[0].toUpperCase() + part.slice(1)).join('');
  }
  const args: string[] = [], opts: Record<string, string | string[] | boolean> = {};
  let readArg: string | null = null, maybeBool: any = false;
  for (const arg of rawArgs) {
    if (readArg) {
      if (arg.startsWith('-')) {
        if (!maybeBool)
          throw `Flag value for ${chalk.bold(`--${readArg}`)} not specified`;
      }
      else {
        if (Array.isArray(opts[readArg]))
          (<string[]>opts[readArg]).push(arg);
        else
          opts[readArg] = arg;
        readArg = null;
        continue;
      }
    }
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      const boolFlag = boolFlags.includes(arg.substr(2));
      const strFlag = strFlags.includes(arg.slice(2, eqIndex === -1 ? arg.length : eqIndex));
      const arrFlag = arrFlags.includes(arg.slice(2, eqIndex === -1 ? arg.length : eqIndex));
      if (boolFlag) {
        opts[toCamelCase(arg.substr(2))] = true;
      }
      else if (strFlag || arrFlag) {
        if (eqIndex === -1) {
          readArg = toCamelCase(arg.slice(2));
          if (arrFlag)
            opts[<string>readArg] = opts[<string>readArg] || [];
          maybeBool = boolFlag;
        }
        else {
          if (arrFlag)
            (<string[]>(opts[toCamelCase(arg.slice(2, eqIndex))])).push(arg.slice(eqIndex + 1));
          else
            opts[toCamelCase(arg.slice(2, eqIndex))] = arg.slice(eqIndex + 1);
        }
      }
      else {
        throw `Unknown flag ${chalk.bold(arg)}`;
      }
    }
    else if (arg.startsWith('-')) {
      const hasEq = arg[2] === '=';
      const alias = aliases[arg.slice(1, 2)];
      const boolFlag = alias && !hasEq && boolFlags.find(f => f === alias);
      const strFlag = strFlags.find(f => f === alias);
      const arrFlag = arrFlags.find(f => f === alias);
      if (boolFlag) {
        opts[toCamelCase(boolFlag)] = true;
        for (const c of arg.slice(2)) {
          const alias = aliases[c];
          const boolFlag = alias && boolFlags.find(f => f === alias);
          if (!boolFlag) {
            throw `Unknown boolean flag ${chalk.bold(c)} in set ${arg}`;
          }
          opts[toCamelCase(boolFlag)] = true;
        }
      }
      if (strFlag || arrFlag) {
        if (arrFlag)
          opts[toCamelCase(arrFlag)] = opts[toCamelCase(arrFlag)] || [];

        if (arg.length === 2) {
          readArg = toCamelCase(strFlag || arrFlag);
          maybeBool = boolFlag;
        }
        else {
          if (arrFlag)
            (<string[]>opts[toCamelCase(arrFlag)]).push(arg.slice(2 + (hasEq ? 1 : 0)));
          else
            opts[toCamelCase(strFlag)] = arg.slice(2 + (hasEq ? 1 : 0));
        }
      }
      if (!boolFlag && !strFlag && !arrFlag)
        throw `Unknown flag ${chalk.bold(arg)}`;
    }
    else {
      args.push(arg);
    }
  }
  if (readArg && !maybeBool)
    throw `Flag value for ${chalk.bold(`--${readArg}`)} not specified`;
  return { args, opts };
}

let _isCygwin;
function isCygwin () {
  if (typeof _isCygwin === 'boolean')
    return _isCygwin;
  try {
    if (require('child_process').execSync('uname -s', { stdio: 'pipe' }).toString().match(/^(CYGWIN|MINGW32|MINGW64)/))
      return _isCygwin = true;
  }
  catch (e) {}
  return _isCygwin = false;
}

function output (str: string, opts: any) {
  if (opts.copy) {
    process.stdout.write(`${str}\n${chalk.bold('(Result copied to clipboard)')}`);
    clipboardy.writeSync(str);
  }
  else {
    process.stdout.write(str);
  }
}
