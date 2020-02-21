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
import { TraceMap } from './tracemap.js';
import chalk from 'chalk';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import ora from 'ora';
import { logStream } from './log.js';
import { clearCache } from './fetch.js';

function writeUsage (cmd?: string) {
  switch (cmd) {
  case 'install': return console.log(`
  jspm install [name]
  
  Options:
    --import-map/-i            Set the path to the import map file
  `);
  case 'build': return console.log(`
  jspm build x.js y.js

  Options
    --debug [trace|install]    Enable the given debug log types
  `);
  }
  if (cmd) console.log(`Unknown command ${cmd}`);
  const dirname = eval('__dirname');
  const version = JSON.parse(fs.readFileSync(dirname + '/../package.json').toString()).version;
  console.log(`
  > https://jspm.io/cli#v${version} ▪ Browser package management
  
  Manage and optimize JS import maps workflows:

    jspm install [pkgName]?    Install a package into an import map
    jspm optimize [module]+?   Optimize local browser modules

    Options
      --out/-o                 Set the output path
      --import-map/-m          Set the path to the existing import map
      --debug/-d [type,..]?    Display debugging logs

  Use jspm help [install|optimize] for more info.
`);
}

/*
CLI TODO:
  jspm optimize <entry>+ [-d <outdir>] [-o <buildmap.json>]
    --format commonjs|system|amd   Set the output module format for the build
    --external <name>|<map.json>   Define build external boundary and aliases
    --hash-entries                 Use hash file names for the entry points
    --optimize                     Enable JS build optimization
    --include-deps                 Don't set project dependencies as externals
    --clear-dir                    Clear the output directory before building
    --source-map                   Output source maps
    --banner <file>|<source>       Provide a banner for the build files
    --watch                        Watch build files for rebuild on change

  jspm resolve <module> [<parent>] Resolve a module name with the jspm resolver
    --relative                     Output the path relative to the current cwd
  jspm trace <module>+             Trace a module graph
  jspm trace --deps <module>+      Trace the dependencies of modules
*/

export async function cli (cmd: string | undefined, rawArgs: string[]) {
  switch (cmd) {
    case 'h':
    case 'help':
      writeUsage(rawArgs[1]);
      break;

    case 'cc':
    case 'cache-clean':
      clearCache();
      console.log(`${chalk.bold.green('OK')}   Cache cleared.`);
      break;

    case 'up':
    case 'update':
      throw new Error('TODO: Update');
      
    case 'upgrade':
      throw new Error('TODO: Upgrade');

    case 'u':
    case 'uninstall':
      throw new Error('TODO: Uninstall');
  
    case 'i':
    case 'install': {
      // TODO: Subpath handling in install (jspm install sver/convert-range.js)
      // TODO: Flags
      // lock | latest | clean | force | depcache | flatten | installExports
      // flatten / clean only ones needing dev work?
      // clean works based on tracking which paths were used, removing unused
      // only applies to arguments install (jspm install --clean) and not any other
      const { args, opts } = readFlags(rawArgs, {
        boolFlags: ['flatten', 'debug'],
        strFlags: ['import-map', 'out', 'debug'],
        aliases: { m: 'import-map', o: 'out', d: 'debug' }
      });

      if (opts.out && !(<string>opts.out).endsWith('.importmap') && !(<string>opts.out).endsWith('.html')) {
        throw new Error(`Import map file ${opts.out} must be a .importmap or .html file`); 
      }
  
      const mapFile = <string>opts.importMap || 'jspm.importmap';
      let map: any;
      if (!fs.existsSync(mapFile)) {
        map = {};
      }
      else {
        const source = fs.readFileSync(mapFile).toString();
        // support HTML parsing
        if (mapFile.endsWith('.html')) {
          map = JSON.parse(source.slice(...findHtmlImportMap(source, mapFile)).trim() || '{}');
        }
        else if (mapFile.endsWith('.importmap')) {
          map = JSON.parse((await fs.readFileSync(mapFile)).toString());
        }
        else {
          throw new Error(`Import map file ${mapFile} must be a .importmap or .html file`);
        }
      }

      const traceMap = new TraceMap(map, new URL('.', pathToFileURL(mapFile)).href);

      const spinner = ora({
        text: `Installing${args.length ? ' ' + args.join(', ') : ''}...`,
        color: 'yellow',
        spinner: {
          interval: isCygwin() ? 7 : 100,
          frames: (<any>[".   ", ".   ", "..  ", "..  ", "... ", "... ", " ...", " ...", "  ..", "  ..", "   .", "   .", "    ", "    ", "    ", "    "].map(x => isCygwin() ? [x, x, x, x, x, x, x, x, x, x] : x)).flat()
        }
      });
      if (!opts.debug) {
        spinner.start();
      }
      else {
        (async () => {
          const debugTypes = typeof opts.debug === 'string' ? opts.debug.split(',') : [];
          for await (const log of logStream()) {
            if (debugTypes.length === 0 || debugTypes.indexOf(log.type) !== -1) {
              console.log(`${chalk.gray(log.type)}: ${log.message}`);
            }
          }
        })().catch(e => console.error(e));
      }
      let changed: string[] | undefined;
      try {
        if (args.length === 0) {
          // TODO: changed handling from install
          // can skip map saving when no change
          await traceMap.lockInstall({});
        }
        else {
          await traceMap.install(args.map(arg => {
            const eqIndex = arg.indexOf('=');
            if (eqIndex === -1) return arg;
            return {
              name: arg.slice(0, eqIndex),
              target: arg.slice(eqIndex + 1)
            };
          }), {});
        }
      }
      finally {
        spinner.stop();
      }
      if (true) {
        // TODO: Styled JSON read / write
        const outFile = opts.out ? <string>opts.out : mapFile;
        if (outFile.endsWith('.importmap')) {
          fs.writeFileSync(outFile, traceMap.toString());
        }
        else if (outFile.endsWith('.html')) {
          let outSource = fs.readFileSync(outFile).toString();
          const [mapStart, mapEnd] = findHtmlImportMap(outSource, outFile);
          outSource = outSource.slice(0, mapStart) + '\n' + traceMap.toString() + '\n' + outSource.slice(mapEnd);
          fs.writeFileSync(outFile, outSource);
        }
        console.log(`${chalk.bold.green('OK')}   Successfully installed${changed && changed.length ? ' ' + changed.map(arg => chalk.bold(arg)).join(', ') : ''}.`);
      }
      else {
        console.log(`${chalk.bold.green('OK')}   Already installed.`);
      }
      break;
  }
  
    case 'o':
    case 'optimize':
      throw new Error('TODO: Very simple ES module optimization based on import map fetch, "dependencies" as extenals. import map as input');
    default:
      if (cmd)
        console.error(`Unknown command ${chalk.bold(cmd)}`);
      else
        writeUsage();
      process.exit(1);
  }  
}

function readFlags (rawArgs: string[], { boolFlags = [], strFlags = [], aliases = {} }: { boolFlags: string[], strFlags: string[], aliases: Record<string, string> }) {
  function toCamelCase (name) {
    return name.split('-').map((part, i) => i === 0 ? part : part[0].toUpperCase() + part.slice(1)).join('');
  }
  const args: string[] = [], opts: Record<string, string | boolean> = {};
  let skip = false;
  for (const [index, arg] of rawArgs.entries()) {
    if (skip) {
      skip = false;
    }
    else if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (boolFlags.includes(arg.substr(2))) {
        opts[toCamelCase(arg.substr(2))] = true;
      }
      else if (strFlags.includes(arg.slice(2, eqIndex === -1 ? arg.length : eqIndex))) {
        if (eqIndex === -1) {
          if (rawArgs.length === index + 1) {
            console.error(`Flag value for ${chalk.bold(arg)} not specified`);
            return process.exit(1);
          }
          opts[toCamelCase(arg.slice(2, arg.length))] = rawArgs[index + 1];
          skip = true;
        }
        else {
          opts[toCamelCase(arg.slice(2, eqIndex))] = arg.slice(eqIndex + 1);
        }
      }
      else {
        console.error(`Unknown flag ${chalk.bold(arg)}`);
        return process.exit(1);
      }
    }
    else if (arg.startsWith('-')) {
      const hasEq = arg[2] === '=';
      const alias = aliases[arg.slice(1, 2)];
      const boolFlag = alias && (hasEq || arg.length === 2) && boolFlags.find(f => f === alias);
      if (boolFlag) {
        opts[toCamelCase(boolFlag)] = true;
      }
      else {
        const strFlag = strFlags.find(f => f === alias);
        if (strFlag) {
          if (arg.length === 2) {
            if (rawArgs.length === index + 1) {
              console.error(`Flag value for ${chalk.bold(`--${strFlag}`)} not specified`);
              return process.exit(1);
            }
            opts[toCamelCase(strFlag)] = rawArgs[index + 1];
            skip = true;
          }
          else {
            opts[toCamelCase(strFlag)] = arg.slice(2 + (hasEq ? 1 : 0));
          }
        }
        else {
          console.error(`Unknown flag ${chalk.bold(arg)}`);
          return process.exit(1);
        }
      }
    }
    else {
      args.push(arg);
    }
  }
  return { args, opts };
}

function findHtmlImportMap (source: string, fileName: string) {
  const importMapStart = source.indexOf('<script type="importmap');
  if (importMapStart === -1)
    throw new Error(`Unable to find an import map section in ${fileName}. You need to first manually include a <script type="importmap"> or <script type="importmap-shim"> section.`);
  const importMapInner = source.indexOf('>', importMapStart);
  const srcStart = source.indexOf('src=', importMapStart);
  if (srcStart !== -1)
    throw new Error(`${fileName} references an external import map. Rather install from/to this file directly.`);
  const importMapEnd = source.indexOf('<', importMapInner);
  return [importMapInner + 1, importMapEnd];
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
