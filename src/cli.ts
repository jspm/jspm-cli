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
import * as api from './api';
import * as ui from './utils/ui';
import fs = require('fs');
import path = require('path');
import process = require('process');
import './utils/common.js';
import { bold, highlight, JspmUserError, isWindows, isURL, getPackageScope } from './utils/common';
import globalConfig from './config/global-config-file';

import { DepType } from './install/package';
import { readOptions, readValue, readPropertySetters } from './utils/opts';
import { JSPM_GLOBAL_PATH } from './api';
import { extend, flattenScopes, validateImportMap, rebaseMap } from './map/utils';
import { readJSONStyled, defaultStyle, serializeJson } from './config/config-file';
import publish from './install/publish';
import { getBin } from './install/bin';
import { spawn } from 'child_process';

const installEqualRegEx = /^([@\-_\.a-z\d\/]+)=/i;

function readTargetEquals (installArg: string) {
  let name: string | undefined, target: string;

  const match = installArg.match(installEqualRegEx);
  if (match) {
    name = match[1];
    target = installArg.substr(name.length + 1);
  }
  else {
    target = installArg;
  }

  return { name, target };
}

export default async function cliHandler (projectPaths: string[], cmd: string, args: string[]) {
  if (typeof projectPaths === 'string')
    projectPaths = [projectPaths];
  if (typeof args === 'string')
    args = (<string>args).split(' ');
  
  let setProjectPath = false;
  const projects: api.Project[] = [];
  try {
    let userInput = true, offline = false, preferOffline = false;
    // first read global options
    outer: for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        case '-y':
        case '--skip-prompts':
          args.splice(i--, 1);
          ui.setUseDefaults(true);
          userInput = false;
        break;
        case '-l':
        case '--log':
          const logLevelString = args[i + 1];
          const logLevel = ui.LogType[logLevelString];
          if (typeof logLevel !== 'number') {
            ui.warn(`${bold(logLevelString)} is not a valid log level.`);
            return process.exit(1);
          }
          ui.setLogLevel(logLevel);
          args.splice(i, 2);
          i -= 2;
        break;
        case '-g':
          setProjectPath = true;
          projectPaths = [api.JSPM_GLOBAL_PATH];
          args.splice(i, 1);
        break;
        case '-p':
        case '--project':
          setProjectPath = true;
          projectPaths = args.splice(i).slice(1);
          break outer;
        case '-q':
        case '--prefer-offline':
          preferOffline = true;
          args.splice(i--, 1);
        break;
        case '--offline':
          offline = true;
          args.splice(i--, 1);
        break;
      }
    }
    if (!projectPaths.length) {
      projectPaths = [getPackageScope(process.cwd() + path.sep)];
    }

    const multiProject = projectPaths.length > 1;

    if (process.env.JSPM_OFFLINE) {
      offline = true;
    }
    if (process.env.JSPM_PREFER_OFFLINE) {
      preferOffline = true;
    }
    if (process.env.JSPM_PROJECT) {
      setProjectPath = true;
      projectPaths = (process.env.JSPM_PROJECT.match(/("[^"]+"|'[^']+'|[^ ]+)( |$)/g) || []).map(item => item.trim());
    }
    if (process.env.JSPM_LOG) {
      const logLevelString = process.env.JSPM_LOG;
      const logLevel = ui.LogType[logLevelString];
      if (typeof logLevel === 'number')
        ui.setLogLevel(logLevel);
    }
    if (process.env.JSPM_CI || process.env.JSPM_SKIP_PROMPTS && process.env.JSPM_SKIP_PROMPTS !== '0' && process.env.JSPM_SKIP_PROMPTS !== 'false') {
      ui.setUseDefaults(true);
      userInput = false;
    }

    switch (cmd) {
      case undefined:
      case '-v':
      case '--version':
      case 'version':
      case 'v':
        console.log(api.version + '\n' + (process.env.JSPM_BIN === 'local' ? 'Running against local jspm install.' : 'Running against global jspm install.'));
      break;

      case 'h':
      case 'help':
        console.log(`${/*bold('Init')}
  jspm init <path>?                 Initialize or validate a jspm project in the current directory

${*/''}${bold('Install')}
  jspm install [<registry>:]<pkg>[@<version>]
  jspm install git:<path> | git+https:<path> | https:<path> | file:<path>
  jspm install
    --edge                         Install to latest unstable resolution
    --lock                         Do not update any existing installs
    --latest                       Resolve all packages to latest versions
    --dev|peer|optional            Install a dev, peer or optional dependency
    --override (-o) main=x.js      Provide a package.json property override
    --force                        Clears any custom folders / cache changes

  jspm update [<name>+]            Update packages within package.json ranges
  jspm uninstall <name>+           Uninstall a top-level package
  jspm clean                       Clear unused dependencies
  jspm link [<name>] <source>      Link a custom source as a named package
  jspm unlink [<name>+]            Reinstall packages to original source target
  jspm checkout [<name>] <gitpath> Clone and link a Git repo into jspm_packages

${bold('Execute')}
  jspm <file>                      Execute a module with jspm module resolution
  jspm run <name>                  Run package.json "scripts"
  jspm bin <name> [-g]             Run an installed bin script
    --cmd                          Output the bin script command w/o executing
    --path [-g]                    Output the bin path

${bold('Build')}
  jspm build <entry>+ [-d <outdir>] [-o <buildmap.json>]
    --format commonjs|system|amd   Set the output module format for the build
    --external <name>|<map.json>   Define build external boundary and aliases
    --hash-entries                 Use hash file names for the entry points
    --optimize                     Enable JS build optimization
    --include-deps                 Don't set project dependencies as externals
    --clear-dir                    Clear the output directory before building
    --source-map                   Output source maps
    --banner <file>|<source>       Provide a banner for the build files
    --watch                        Watch build files for rebuild on change
${/*jspm inspect (TODO)            Inspect the installation constraints of a given dependency */''}
${bold('Inspect')}
  jspm resolve <module> [<parent>] Resolve a module name with the jspm resolver
    --env=browser                  Resolve a module name in a conditional env
    --relative                     Output the path relative to the current cwd
  jspm trace <module>+             Trace a module graph
  jspm trace --deps <module>+      Trace the dependencies of modules
${/*jspm trace --format graph|text|csv|json (TODO)     Different output formats for trace*/''}
${bold('Import Maps')}
  jspm map -o importmap.json       Generates an import map for all dependencies
  jspm map <module>+               Generate a import map for specific modules
    --flat-scope                   Flatten scopes for Chrome compatibility
    --map-base                     Output absolute paths relative to map base
    --production                   Use production resolutions
    --cdn                          Generate a import map against the jspm CDN

${bold('Publish')}
  jspm publish [<path>] [--otp <otp>] [--tag <tag>] [--public]

${bold('Configure')}
  jspm registry-config <name>      Run configuration prompts for a registry
  jspm config <option> <setting>   Set jspm global config
  jspm config --get <option>       Get a jspm global config value
  
${bold('Command Flags')}
  --offline                        Run command offline using the jspm cache
  --prefer-offline (-q)            Use cached lookups for fastest install
  --skip-prompts (-y)              Use default options w/o user input
  --log ok|warn|err|debug|none     Set the log level
  --project (-p) <projectPath>     Set the jspm command project directory
  -p <projectPathA> <projectPathB> Apply a command to multiple jspm projects
`);
      break;

      case 'init':
        throw new JspmUserError(`${bold('jspm init')} has not yet been implemented.`);
        /*const [generator, target = generator] = args[0] && args[0].split('=') || [undefined];
        const initPath = args[1] || '.';
        if (!generator) {
          throw new JspmUserError(`jspm init requires a provided ${bold('generator')} name.`);
        }
        const generatorName = `jspm-init-${generator}`;
        const exitCode = await api.run(target || generatorName, [initPath, ...args.slice(2)], { latest: true, userInput, offline });
        process.exit(exitCode);*/

      case 'r':
      case 'run': {
        let exitCode = 0;
        for (const projectPath of projectPaths) {
          const project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true, multiProject });
          projects.push(project);
          exitCode = await project.run(args[0], args.slice(1));
          if (exitCode !== 0) break;
        }
        process.exit(exitCode);
      }
      break;

      case 'b':
      case 'bin': {
        for (const projectPath of projectPaths) {
          let options;
          if (args[0] === '--path' || args[0] === '--cmd' || args[0] === '-pc' || args[0] === '-cp') {
            ({ options } = readOptions([args[0]], ['path', 'cmd']));
            args = args.slice(1);
          }
          else {
            options = {};
          }
          const binPath = path.join(projectPath, 'jspm_packages', '.bin');
          if (options.path) {
            if (args.length)
              throw new JspmUserError(`${bold('jspm bin --path')} doesn't take any arguments.`);
            // jspm bin --path -> log bin path
            console.log(binPath);
          }
          else {
            if (args.length === 0) {
              // jspm bin --cmd -> show Node exec command
              if (options.cmd) {
                console.log(getBin());
              }
              // jspm bin -> Node zero arguments form
              else {
                const exitCode = await api.exec([]);
                process.exit(exitCode);
              }
            }
            else {
              let execPath = path.join(binPath, args[0]);
              if (isWindows)
                execPath += '.cmd';
              // jspm bin --cmd x -> display exec path
              if (options.cmd) {
                console.log(execPath);
              }
              // jspm bin x -> run exec path
              else {
                const ps = spawn(execPath, args.slice(1), { stdio: 'inherit' });
                const exitCode = await new Promise<number>((resolve, reject) => {
                  ps.on('exit', code => resolve(code));
                  ps.on('error', err => reject(err));
                });
                process.exit(exitCode);
              }
            }
          }
        }
      }
      break;

      case 'publish': {
        let options;
        ({ args, options } = readOptions(args, ['public'], ['otp', 'tag']));
        if (args.length > 1)
          throw new JspmUserError('Publish only takes one path argument.');
        for (const projectPath of projectPaths) {
          const project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true, multiProject });
          projects.push(project);
          await publish(project, options);
        }
      }
      break;

      /* case 'e':
      case 'exec': {
        const exitCode = await api.run(args);
        process.exit(exitCode);
      }
      break;*/

      case 't':
      case 'trace': {
        let options;
        ({ args, options } = readOptions(args, ['react-native', 'production', 'electron', 'node', 'deps', 'include-deps'], ['out']));
        for (const projectPath of projectPaths) {
          const project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true, multiProject });

          // NB: local map should be included in this in the exclude case still
          const map = (!options.includeDeps || options.deps) ? {} : await api.map(project, options);

          if (!args.length)
            throw new JspmUserError('Trace requires a list of module names to trace.');

          const traced = await api.trace(project, map, process.cwd(), args, !options.includeDeps || options.deps);

          if (options.deps) {
            const deps = new Set();
            for (const map of Object.values(traced)) {
              for (const dep of Object.keys(map)) {
                if (map[dep] in traced === false && !isURL(dep) && !dep.startsWith('./') && !dep.startsWith('../')) 
                  deps.add(dep);
              }
            }
            for (const dep of deps)
              console.log(dep);
            return;
          }

          const output = await serializeJson(traced, defaultStyle);

          if (options.out)
            await new Promise((resolve, reject) => fs.writeFile(options.out, output, err => err ? reject(err) : resolve()));
          else
            process.stdout.write(output);
        }
      }
      break;

      case 'm':
      case 'map': {
        for (const projectPath of projectPaths) {
          let options;
          ({ args, options } = readOptions(args, ['react-native', 'production', 'electron', 'cdn', 'flat-scope', 'node'], ['out', 'in', 'jspmPackages', 'map-base']));

          if (options.node)
            throw new JspmUserError(`${bold('jspm map')} currently only supports generating package maps for the browser.`);

          let inputMap, style = defaultStyle;
          if (options.in)
            ({ json: inputMap, style } = await readJSONStyled(options.in));

          const project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true, multiProject });
          projects.push(project);
          let map = await api.map(project, options);

          if (inputMap)
            map = extend(extend({}, inputMap), map);

          if (args.length)
            map = await api.filterMap(project, map, args, options.flatScope);
          else if (options.flatScope)
            flattenScopes(map);

          if (options.cdn && !options.jspmPackages)
            options.jspmPackages = options.production ? 'https://cdn.jspm.io' : 'https://dev-cdn.jspm.io';

          const jspmPackagesURL = options.jspmPackages ? options.jspmPackages : options.out ?  path.relative(path.dirname(path.resolve(options.out)), path.resolve(projectPath, 'jspm_packages')).replace(/\\/g, '/') : 'jspm_packages';
          if (jspmPackagesURL !== 'jspm_packages')
            map = api.renormalizeMap(map, jspmPackagesURL, options.cdn);

          // we dont want input map items filtered so always add them back
          if (inputMap)
            extend(map, inputMap);

          if (options.mapBase)
            map = rebaseMap(map, options.out ? path.dirname(path.resolve(options.out)) : process.cwd(), path.resolve(options.mapBase), true);

          const output = await serializeJson(map, style);
          if (options.out)
            await new Promise((resolve, reject) => fs.writeFile(options.out, output, err => err ? reject(err) : resolve()));
          else
            process.stdout.write(output);
        }
      }
      break;

      case 're':
      case 'resolve': {
        let options;
        ({ args, options } = readOptions(args, ['format'], ['env']));

        let env = (options.env || '').split(',');
        let err = undefined;

        for (const projectPath of projectPaths) {
          let parent;
          if (args[1]) {
            let parentFormat;
            try {
              ({ resolved: parent, format: parentFormat } = api.resolveSync(args[1], setProjectPath ? path.resolve(projectPath) + path.sep : undefined, env));
            }
            catch (e) {
              err = e;
              continue;
            }
            if (parentFormat === 'builtin')
              parent = undefined;
          }
          else if (setProjectPath) {
            parent = projectPath + path.sep;
          }
          
          try {
            var resolved = api.resolveSync(args[0], parent, env);
          }
          catch (e) {
            err = e;
            continue;
          }

          err = undefined;

          if (options.format) {
            console.log(resolved.format || '<undefined>');
            break;
          }
          else {
            resolved.resolved = resolved.resolved || '@empty';
            console.log(options.relative ? path.relative(process.cwd(), resolved.resolved) : resolved.resolved);
            break;
          }
        }
        if (err)
          throw err;
      }
      break;

      case 'cl':
      case 'clean':
        await Promise.all(projectPaths.map(async projectPath => {
          const project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true, multiProject });
          projects.push(project);
          await project.clean();
        }));
      break;

      case 'co':
      case 'checkout':
        if (args.length === 0)
          throw new JspmUserError(`No package to checkout provided to ${bold('jspm checkout')}.`);
        await Promise.all(projectPaths.map(async projectPath => {
          const project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true, multiProject });
          projects.push(project);
          await project.checkout(args);
        }));
      break;

      case 'un':
      case 'uninstall':
        await Promise.all(projectPaths.map(async projectPath => {
          const project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true, multiProject });
          projects.push(project);
          await project.uninstall(args);  
        }));
      break;

      case 'l':
      case 'link': {
        let options;
        ({ options, args } = readOptions(args, [
        ], ['force'], ['override']));

        await Promise.all(projectPaths.map(async projectPath => {
          const project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true, multiProject });
          projects.push(project);
        
          if (args.length === 2) {
            await project.link(args[0], args[1].indexOf(':') === -1 ? 'file:' + args[1] : args[1], options);
          }
          else if (args.length === 1) {
            await project.install([{
              name: undefined,
              parent: undefined,
              target: 'file:' + path.resolve(args[0]),
              type: DepType.primary
            }], options);
          }
          else if (args.length !== 1) {
            throw new JspmUserError(`Link command takes at most two arguments - an optional package name and a path.`);
          }  
        }));
      }
      break;

      case 'ug':
      case 'upgrade': {
        // TODO: a single-major version upgrade of selected packages
        ui.warn('Still to be implemented.');
      }
      break;

      case 'un':
      case 'up':
      case 'unlink':
      case 'update': {
        // the name given here is not a "TARGET" but a "SELECTOR"
        let { options, args: selectors } = readOptions(args, [
          // install options
          'force',
          'lock',
          'dev',
          'save-dev',
          'peer',
          'optional',
          'primary'
          ], [], ['override']);
        let depType: DepType;
        if (options.dev || options.saveDev)
          depType = DepType.dev;
        else if (options.peer)
          depType = DepType.peer;
        else if (options.optional)
          depType = DepType.optional;
        else if (options.primary)
          depType = DepType.primary;
        await Promise.all(projectPaths.map(async projectPath => {
          const project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true, multiProject });
          projects.push(project);
          await project.update(selectors, options, depType);
        }));
      }
      break;

      case 'i':
      case 'install': {
        let { options, args: installArgs } = readOptions(args, [
          // install options
          'force',
          // install type
          'save-dev', 'dev', 'optional', 'peer',
          // constraint options
          'exact', 'edge',
          // resolver options
          'latest', 'lock',
          ], [], ['override']);
        await Promise.all(projectPaths.map(async projectPath => {
          const project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true, multiProject });
          projects.push(project);

          if (options.saveDev) {
            project.log.warn(`The ${bold(`--save-dev`)} install flag in jspm is just ${bold(`--dev`)}.`);
            options.dev = true;
          }

          let type;
          if (options.dev)
            type = DepType.dev;
          else if (options.peer)
            type = DepType.peer;
          else if (options.optional)
            type = DepType.optional;
          else
            type = DepType.primary;

          if (typeof options.override === 'string') {
            options.override = readPropertySetters(options.override, true);
            if (options.override && installArgs.length > 1)
              throw new JspmUserError(`An override can only be specified through ${highlight(`-o`)} when installing a single dependency at a time.`);
          }

          if (projectPath === JSPM_GLOBAL_PATH && !options.lock) {
            options.latest = true;
            options.dedupe = false;
          }

          const installTargets = installArgs.map(arg => {
            /*
            * Assignment target install
            *   jspm install x=y@1.2.3
            */
            let { name, target } = readTargetEquals(arg);

            // when name is undefined, install will auto-populate from target
            if (options.override)
              return { name, parent: undefined, target, type, override: options.override };
            else
              return { name, parent: undefined, target, type };
          });
      
          await project.install(installTargets, options);
          // TODO: look through install cache of install state for checked out and linked
          // and log that list so that the user is aware of it
          // await project.logInstallStates();
        }));
      }
      break;

      case 'b':
      case 'build': {
        for (const projectPath of projectPaths) {
          let { options, args: buildArgs } = readOptions(args, [
            'clear-dir',
            'mjs',
            'show-graph',
            'source-map',
            'watch',
            'optimize',
            'exclude-deps',
            'hash-entries',
            'out', // out can also be boolean
            'minify'
          ], ['map-base', 'dir', 'out', 'format', /* TODO: build map support 'map' */ 'in', 'env'], ['external', 'banner']);
          if (options.env)
            options.env = options.env.split(',');
          if (options.out && projectPaths.length > 1)
              throw new JspmUserError(`${bold('jspm build --out')} does not support execution in multiple projects.`);
          options.basePath = path.resolve(projectPath);

          const project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true, multiProject });

          let inputMap, style;
          if (options.in)
            ({ json: inputMap, style } = await readJSONStyled(options.in));

          if (options.map) {
            let buildMap, buildMapStyle;
            ({ json: buildMap, style: buildMapStyle } = await readJSONStyled(options.map));
            if (buildMap) {
              if (!style)
                style = buildMapStyle;
              validateImportMap(path.relative(process.cwd(), path.resolve(options.map)), buildMap);
              options.map = buildMap;
            }
            else {
              throw new JspmUserError(`Import map ${path.relative(process.cwd(), path.resolve(options.map))} for build not found.`);
            }
          }
          if (options.external) {
            let externalMap, externalStyle;
            const externalsPath = path.resolve(options.external)
            try {
              ({ json: externalMap, style: externalStyle } = await readJSONStyled(externalsPath));
            }
            catch (e) {
              if (e.code !== 'ENOENT')
                throw e;
            }
            if (externalMap) {
              if (!style)
                style = externalStyle;
              validateImportMap(path.relative(process.cwd(), externalsPath), externalMap);
              // scoped externals not currently supported, but could be (if thats even useful)
              options.external = rebaseMap(externalMap, path.dirname(externalsPath), path.resolve(options.dir || 'dist')).imports;
            }
            else {
              const external = {};
              options.external.split(' ').forEach(pair => {
                const aliasIndex = pair.indexOf('=');
                if (aliasIndex !== -1) {
                  const externalName = pair.substr(0, aliasIndex);
                  const aliasName = pair.substr(aliasIndex + 1);
                  external[externalName] = aliasName;
                }
                else {
                  external[pair] = true;
                }
              });
              if (Object.keys(external).length === 0)
                throw new JspmUserError(`${bold('jspm build --external')} requires an argument for externals.`);
              options.external = external;
            }
          }
          if (!options.includeDeps) {
            options.external = options.external || {};
            projects.push(project);
            for (const dep in project.config.pjson.dependencies) {
              const depType = project.config.pjson.dependencies[dep].type;
              if (typeof depType === 'number' && depType !== DepType.dev) {
                options.external[dep] = true;
              }
            }
          }
          options.log = true;
          let absoluteMap = false;
          // -o with no arguments hides log due to using stdout
          if ('out' in options && !options.out && !options.showGraph)
            options.log = false;
          if (options.mapBase) {
            options.mapBase = path.resolve(options.mapBase);
            absoluteMap = true;
          }
          else if (options.out) {
            options.mapBase = path.dirname(path.resolve(options.out));
          }

          let outMap = await (buildArgs.length === 0 ? api.buildPackage(project, options) : api.build(buildArgs, options));

          if (absoluteMap)
            outMap = rebaseMap(outMap, options.mapBase, options.mapBase, true);

          if (inputMap)
            outMap = extend(inputMap, outMap);

          if (options.flatScope)
            flattenScopes(outMap);

          const output = await serializeJson(outMap, style || defaultStyle);

          if ('out' in options) {
            if (options.out)
              fs.writeFileSync(path.resolve(options.out), output);
            else
              process.stdout.write(output);
          }
        }
      }
      break;

      case 're':
      case 'registry':
        if (args[0] !== 'config')
          throw new JspmUserError(`Unknown command ${bold(cmd)}.`);
        args = args.splice(1);
      case 'rc':
      case 'registry-config': {
        if (args.length !== 1)
          throw new JspmUserError(`Only one argument expected for the registry name to configure.`);
        const project = new api.Project(projectPaths[0], { offline, preferOffline, userInput, cli: true });
        projects.push(project);
        await project.registryConfig(args[0]);
      }
      break;

      case 'c':
      case 'config': {
        let property, value;
        const unsetIndex = args.indexOf('--unset');
        const getIndex = args.indexOf('--get');
        if (unsetIndex !== -1) {
          if (args.length !== 2)
            throw new JspmUserError(`Only one configuration property is expected to be unset.`);
          if (unsetIndex === 1)
            property = args[0];
          else
            property = args[1];
          globalConfig.set(property, undefined);
        }
        else if (getIndex !== -1) {
          if (args.length !== 2)
            throw new JspmUserError(`Only one configuration property is expected to be read.`);
          if (getIndex === 1)
            property = args[0];
          else
            property = args[1];
          console.log(globalConfig.get(property));
        }
        else {
          property = args[0];
          value = readValue(args.splice(1).join(' '));
          if (property === undefined || value === undefined)
            throw new JspmUserError(`jspm config requires a property and value via ${bold(`jspm config <property> <value>`)}`);
          globalConfig.set(property, value);
        }
      }
      break;

      case 'cc':
      case 'clear-cache':
        const project = new api.Project(projectPaths[0], { offline, preferOffline, userInput, cli: true });
        projects.push(project);
        await project.clearCache();
      break;

      default:
        // if the cmd is a valid file, then we execute it directly
        let isFile = false;
        try {
          isFile = fs.statSync(cmd).isFile();
        }
        catch (e) {}
        if (isFile) {
          const exitCode = await api.exec([cmd, ...args]);
          process.exit(exitCode);
          return;
        }

        throw new JspmUserError(`Command or file ${bold([cmd, ...args].join(' '))} does not exist.`);
    }
  }
  catch (err) {
    if (err && err.hideStack)
      (projects.length ? projects[0].log.err.bind(projects[0].log) : ui.err)(err.message || err);
    else
      (projects.length ? projects[0].log.err.bind(projects[0].log) : ui.err)(err && err.stack || err);
    throw err;
  }
  finally {
    await Promise.all(projects.map(project => project.dispose()));
  }
}
