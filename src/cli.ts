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
import { findHtmlImportMap, isPlain, isURL, jsonEquals, jsonParseStyled, jsonStringifyStyled } from './utils.js';
import * as path from 'path';
import { esmCdnUrl, systemCdnUrl, parseCdnPkg, pkgToStr } from './installtree.js';

function usage (cmd?: string) {
  switch (cmd) {
  case 'install': return `
  jspm install [-m <importmap>] <pkg>?+
  
    Options:
      --import-map/-m          Set the path to the import map file
      --out/-o                 Set the path to the output import map
      --flatten/-f             Flatten the import map
      --minify/-M              Minify import map output
      --system/-s              Use System modules
      --esm/-e                 Use ES modules
      --log/-l=trace,install   Display debugging logs
  `;
  case 'build': return `
  jspm build [-m <importmap>] <entry>?+ [-d <outdir>]

    Options
      --import-map/-m          Set the path to the import map file
      --dir/-d                 Set the output directory
      --clear-dir/-c           Clear the output directory before building
      --minify/-M              Minify the optimized modules
      --source-map/-S          Output source maps
      --banner/-b              Provide a banner for the build files
      --watch/-w               Watch build files for rebuild on change
      --system/-s              Output system module
      --log/-l=build           Enable the given debug log types
  `;
  }
  const dirname = eval('__dirname');
  const version = JSON.parse(fs.readFileSync(dirname + '/../package.json').toString()).version;
  return `${cmd ? `Unknown command ${chalk.bold(cmd)}\n` : ``}
  > https://jspm.io/cli#v${version} ▪ Browser package management
  
  Manage and optimize JS import maps workflows:

    jspm install [pkgName]     Install a package into an import map

    jspm build [module]        Optimize module graphs

  Run "jspm help install" or "jspm help build" for more info.
`;
}

export async function cli (cmd: string | undefined, rawArgs: string[]) {
  switch (cmd) {
    case 'h':
    case 'help':
      throw usage(rawArgs[0]);

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

        const specifiers = args.length === 0 ? Object.keys(inMap.imports) : args;

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

    case 'r':
    case 'resolve':
      try {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['relative', 'log'],
          strFlags: ['relative', 'import-map', 'log'],
          aliases: { m: 'import-map', l: 'log', r: 'relative' }
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
          console.log('@empty');
        }
        else if (opts.relative && resolved.protocol === 'file:') {
          console.log(relModule(resolved, pathToFileURL(opts.relative === true ? process.cwd() : path.resolve(opts.relative))));
        }
        else {
          console.log(resolved.href);
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
      throw `${chalk.bold.red('ERR')}  TODO: Update`;
      
    case 'upgrade':
      throw `${chalk.bold.red('ERR')}  TODO: Upgrade`;

    case 'u':
    case 'uninstall':
      throw `${chalk.bold.red('ERR')}  TODO: Uninstall`;
  
    case 'i':
    case 'install':
      try {
        // TODO: Flags
        // lock | latest | clean | force | installExports
        // flatten / clean only ones needing dev work?
        // clean works based on tracking which paths were used, removing unused
        // only applies to arguments install (jspm install --clean) and not any other
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['flatten', 'depcache', 'system', 'esm', 'minify', 'log'],
          strFlags: ['import-map', 'out', 'log'],
          aliases: { m: 'import-map', o: 'out', l: 'log', d: 'depcache', f: 'flatten', M: 'minify', s: 'system', e: 'esm' }
        });

        const inMapFile = getInMapFile(opts);
        const outMapFile = getOutMapFile(inMapFile, opts);
        const inMap = getMapDetectTypeIntoOpts(inMapFile, opts);
        const traceMap = new TraceMap(new URL('.', pathToFileURL(inMapFile)).href, inMap.map);

        const spinner = startSpinnerLog(opts.log);
        if (spinner) spinner.text = `Installing${args.length ? ' ' + args.join(', ').slice(0, process.stdout.columns - 14) : ''}...`;

        let changed: string[] | undefined;
        try {
          if (args.length === 0) {
            // TODO: changed handling from install
            // can skip map saving when no change
            await traceMap.lockInstall(opts);
          }
          else {
            await traceMap.install(args.map(arg => {
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
          writeMap(outMapFile, traceMap.toString(<boolean>opts.minify), <boolean>opts.system);
          console.log(`${chalk.bold.green('OK')}   Successfully installed${changed && changed.length ? ' ' + changed.map(arg => chalk.bold(arg)).join(', ') : ''}.`);
        }
        else {
          console.log(`${chalk.bold.green('OK')}   Already installed.`);
        }
      }
      catch (e) {
        if (typeof e === 'string')
          throw `${chalk.bold.red('ERR')}  ${e}`;
        throw e;
      }
      break;
  
    case 'b':
    case 'build':
      try {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['clear-dir', 'source-map', 'watch', 'minify', 'out', 'log', 'system', 'flatten', 'depcache', 'inline-maps'],
          strFlags: ['import-map', 'dir', 'out', 'banner', 'log'],
          aliases: { m: 'import-map', c: 'clear-dir', S: 'source-map', w: 'watch', M: 'minify', o: 'out', l: 'log', s: 'system', d: 'dir', b: 'banner', i: 'inline-maps' }
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

        if (Object.keys(inputObj).length === 0)
          throw `Nothing to build.`;

        const externals = Object.keys(map.imports).filter(name => {
          return modules.every(module => module !== name && !(module.endsWith('/') && name.startsWith(module)));
        });

        const rollupOptions: any = {
          input: inputObj,
          onwarn: () => {},
          plugins: [jspmRollup({ map: JSON.parse(map.map), baseUrl, externals, system: <boolean>opts.system, inlineMaps: <boolean>opts.inlineMaps })]
        };

        const outputOptions = {
          entryFileNames: '[name]-[hash].js',
          chunkFileNames: 'chunk-[hash].js',
          dir,
          compact: true,
          format: opts.system ? 'system' : 'esm',
          sourcemap: opts.sourceMap,
          indent: true,
          banner: opts.banner
        };

        const { json: outMap, style: outMapStyle } = jsonParseStyled(map.map);
        if (opts.minify)
          outMapStyle.indent = outMapStyle.tab = outMapStyle.newline = '';

        if (opts.watch) {
          if (!opts.out) {
            throw `Watched builds only supported when using --out separate to the input import map.`;
          }
          const spinner = startSpinnerLog(opts.log);
          spinner.text = `Building${args.length ? ' ' + args.join(', ').slice(0, process.stdout.columns - 12) : ''}...`;

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
                spinner.text = `Building${args.length ? ' ' + args.join(', ').slice(0, process.stdout.columns - 12) : ''}...`;
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
    
              writeMap(outMapFile, jsonStringifyStyled(outMap, outMapStyle), <boolean>opts.system);

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
          if (!opts.out) {
            if (fs.existsSync('jspm.importmap') && !jsonEquals(fs.readFileSync('jspm.importmap').toString(), map.map)) {
              const basename = path.basename(inMapFile).slice(0, -path.extname(inMapFile).length);
              backupName = basename + '.importmap';
              if (fs.existsSync(backupName) && !jsonEquals(fs.readFileSync(backupName).toString(), map.map)) {
                let idx = 1;
                while (fs.existsSync(`${basename}-${idx}.importmap`) && !jsonEquals(fs.readFileSync(`${basename}-${idx}.importmap`).toString(), map.map)) {
                  idx++;
                }
                backupName = `${basename}-${idx}.importmap`;
              }
            }
            fs.writeFileSync(backupName, map.map);
          }
          if (!opts.out) {
            console.log(`     A backup of the previous unbuilt import map has been saved to ${chalk.bold(backupName)}.`);
            console.log(`${chalk.blue('TIP')}  To rebuild, run ${chalk.bold(`jspm build${backupName === 'jspm.importmap' ? '' : ' -m ' + backupName} -o ${opts.importMap || 'jspm.importmap'}`)}`);
            console.log(`     To revert, run ${chalk.bold(`jspm install${backupName === 'jspm.importmap' ? '' : ' -m ' + backupName} -o ${opts.importMap || 'jspm.importmap'}`)}`);
          }

          for (const input of Object.keys(inputObj)) {
            const chunk = output.find(chunk => chunk.name === input);
            outMap.imports[inputObj[input]] = `${distMapRelative}/${chunk.fileName}`;
          }

          const mapBase = new URL('.', pathToFileURL(outMapFile));
          const traceMap = new TraceMap(mapBase, outMap);
          {
            const { map, trace } = await traceMap.trace(modules, <boolean>opts.system);
            logTrace(map, trace, mapBase);
          }

          // TODO: use trace to filter output map
          // handle case of output map being empty
          const usedExternals = [];
          writeMap(outMapFile, jsonStringifyStyled(outMap, outMapStyle), <boolean>opts.system);
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

function logTrace (map, trace, mapBase: URL) {
  const endNode = chalk.bold('└');
  const middleNode = chalk.bold('├');
  const skipNode = chalk.bold('│');
  const itemNode = chalk.bold('╴');

  const seen = new Map();
  let idx = 0;
  console.log('');
  for (const specifier of Object.keys(map)) {
    for (const line of logVisit(specifier, map, null)) {
      console.log(line);
    }
  }

  function isItemLine (line: string) {
    return !line.startsWith(endNode) && !line.startsWith(middleNode) && !line.startsWith(skipNode) && line[0] !== ' ';
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
        lines[i] = (i >= lastItemLine ? endNode : middleNode) + itemNode + line;
      else
        lines[i] = (i >= lastItemLine ? ' ' : skipNode) + ' ' + line;
    }
    return lines;
  }

  function logVisit (specifier, curMap, parentURL): string[] {
    const resolved = curMap[specifier];
    const resolvedTrace = trace[resolved.href];
    const keys = Object.keys(resolvedTrace.deps);

    if (seen.has(resolved.href)) {
      if (isPlain(specifier))
        return [`${chalk.black.bold(specifier)} ${(`@${seen.get(resolved.href)}`)}`];
      return [];
    }

    const curIdx = ++idx;
    seen.set(resolved.href, curIdx);

    let depGraphLines: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      depGraphLines = depGraphLines.concat(logVisit(keys[i], resolvedTrace.deps, resolved));
    }
    return [
      `${isPlain(specifier) ? chalk.black.bold(specifier) : isURL(specifier) ? relModule(resolved, parentURL) : specifier} ${isPlain(specifier) ? `(${relModule(resolved, mapBase)}) ` : ''}${chalk.cyan(`${Math.round(resolvedTrace.size / 1024 * 10) / 10}KiB`)} ${chalk.black.bold(`[${curIdx}]`)}`,
      ...indentGraph(depGraphLines)
    ];
  }
}

function relModule (url: URL, relBase: URL) {
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
    const parsed = parseCdnPkg(url);
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
  if (!inMapFile.endsWith('.html') && !inMapFile.endsWith('.importmap'))
    throw `Import map file ${inMapFile} must be a .importmap or .html file`;
  return inMapFile;
}

function getOutMapFile (inMapFile: string, opts: Record<string, string | boolean>): string {
  let outMapFile = <string>opts.out || inMapFile;
  if (outMapFile.endsWith('/') || outMapFile.endsWith('\\'))
    outMapFile += 'jspm.importmap';
  if (outMapFile && !outMapFile.endsWith('.importmap') && !outMapFile.endsWith('.html'))
    throw `Import map file ${opts.out} must be a .importmap or .html file`;
  return outMapFile;
}

function writeMap (outMapFile: string, mapString: string, system: boolean) {
  if (outMapFile.endsWith('.importmap')) {
    fs.writeFileSync(outMapFile, mapString);
  }
  else if (outMapFile.endsWith('.html')) {
    let outSource = fs.readFileSync(outMapFile).toString();
    let { type: [typeStart, typeEnd], map: [mapStart, mapEnd] } = findHtmlImportMap(outSource, outMapFile, system);
    if (system && outSource.slice(typeStart, typeEnd) !== 'systemjs-importmap') {
      outSource = outSource.slice(0, typeStart) + 'systemjs-importmap' + outSource.slice(typeEnd);
      const diff = 18 - (typeEnd - typeStart);
      mapStart += diff;
      mapEnd += diff;
    }
    if (!system && outSource.slice(typeStart, typeEnd) !== 'importmap' && outSource.slice(typeStart, typeEnd) !== 'importmap-shim') {
      outSource = outSource.slice(0, typeStart) + 'importmap' + outSource.slice(typeEnd);
      const diff = 9 - (typeEnd - typeStart);
      mapStart += diff;
      mapEnd += diff;
    }
    outSource = outSource.slice(0, mapStart) + '\n' + mapString + outSource.slice(mapEnd);
    fs.writeFileSync(outMapFile, outSource);
  }
}

// TODO: refactor this stuff more sensibly
function getMapDetectTypeIntoOpts (inMapFile: string, opts: Record<string, string | boolean>): { map: string, imports: string[] } {
  let inMap: ImportMap = { imports: {}, scopes: {}, depcache: {} };
  const returnVal = {
    map: '{}\n',
    imports: []
  };
  if (fs.existsSync(inMapFile)) {
    const source = fs.readFileSync(inMapFile).toString();    
    // support HTML parsing
    if (inMapFile.endsWith('.html')) {
      const foundMap = findHtmlImportMap(source, inMapFile, <boolean>opts.system);
      const mapStr = source.slice(...foundMap.map);
      if (mapStr.trim().length !== 0) {
        const firstNewline = mapStr.match(/\n|[^\s]/)?.index;
        returnVal.map = Number(firstNewline) > -1 ? mapStr.slice(<number>firstNewline + 1) : mapStr;
      }
      inMap = JSON.parse(source.slice(...foundMap.map).trim() || '{}');
      if (!opts.system && !opts.esm) {
        if (source.slice(...foundMap.type) === 'systemjs-importmap')
          opts.system = true;
        else
          opts.esm = true;
      }
    }
    else if (inMapFile.endsWith('.importmap')) {
      returnVal.map = fs.readFileSync(inMapFile).toString();
      if (returnVal.map.trim().length === 0)
        returnVal.map = '{}\n';
      inMap = JSON.parse(returnVal.map);
    }
  }
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

function readFlags (rawArgs: string[], { boolFlags = [], strFlags = [], aliases = {} }: { boolFlags: string[], strFlags: string[], aliases: Record<string, string>, err?: string }) {
  function toCamelCase (name) {
    return name.split('-').map((part, i) => i === 0 ? part : part[0].toUpperCase() + part.slice(1)).join('');
  }
  const args: string[] = [], opts: Record<string, string | boolean> = {};
  let readArg: string | null = null, maybeBool: any = false;
  for (const arg of rawArgs) {
    if (readArg) {
      if (arg.startsWith('-')) {
        if (!maybeBool)
          throw `Flag value for ${chalk.bold(`--${readArg}`)} not specified`;
      }
      else {
        opts[readArg] = arg;
        readArg = null;
      }
    }
    else if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      const boolFlag = boolFlags.includes(arg.substr(2));
      if (boolFlag) {
        opts[toCamelCase(arg.substr(2))] = true;
      }
      else if (strFlags.includes(arg.slice(2, eqIndex === -1 ? arg.length : eqIndex))) {
        if (eqIndex === -1) {
          readArg = toCamelCase(arg.slice(2, arg.length));
          maybeBool = boolFlag;
        }
        else {
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
      if (strFlag) {
        if (arg.length === 2) {
          readArg = toCamelCase(strFlag);
          maybeBool = boolFlag;
        }
        else {
          opts[toCamelCase(strFlag)] = arg.slice(2 + (hasEq ? 1 : 0));
        }
      }
      if (!boolFlag && !strFlag)
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
