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

import * as ui from './utils/ui';
if (!(parseInt(process.versions.node.split('.')[0]) >= 8)) {
  ui.logErr('jspm 2 requires NodeJS 8.0.0 or above.');
  process.exit();
}

import path = require('path');
import * as api from './api';
import { bold, highlight, JspmUserError, winSepRegEx } from './utils/common';
import globalConfig from './config/global-config-file';

import { DepType, processPackageTarget, resourceInstallRegEx } from './install/package';
import { readOptions, readValue, readPropertySetters } from './utils/opts';

const installEqualRegEx = /^([@\-\_\.a-z\d]+)=/i;
const fileInstallRegEx = /^(\.[\/\\]|\.\.[\/\\]|\/|\\|~[\/\\])/;

export default async function cliHandler (projectPath: string, cmd: string, args: string | string[]) {
  if (typeof args === 'string')
    args = args.split(' ');
  
  let setProjectPath = false;
  let project: api.Project;
  try {
    let userInput = true, offline = false, preferOffline = false;
    // first read global options
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        case '-y':
        case '--skip-prompts':
          (<string[]>args).splice(i--, 1);
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
          (<string[]>args).splice(i, 2);
          i -= 2;
        break;
        case '-p':
        case '--project':
          setProjectPath = true;
          projectPath = args[i + 1];
          (<string[]>args).splice(i, 2);
          i -= 2;
        break;
        case '-q':
        case '--prefer-offline':
          preferOffline = true;
          (<string[]>args).splice(i--, 1);
        break;
        case '--offline':
          offline = true;
          (<string[]>args).splice(i--, 1);
        break;
      }
    }

    switch (cmd) {
      case undefined:
      case '--version':
      case '-v':
        ui.info(api.version + '\n' +
            (process.env.globalJspm === 'true' || process.env.localJspm === 'false'
            ? 'Running against global jspm install.'
            : 'Running against local jspm install.'));
      break;

      case 'h':
      case 'help':
      case '--help':
      case '-h':
        ui.info(`
${bold('Init')}
  jspm init <path>?                 Initialize or validate a jspm project in the current directory

${bold('Install')}
  jspm install                      Install from package.json with jspm.json version lock
  jspm install <name[=target]>+
    <pkg>                           Install a package
    <pkg@version>                   Install a package to a version or version range
    <pkgA> <pkgB>                   Install multiple packages at the same time
    <pkg> --edge                    Install to latest unstable version resolution
    <pkg> --lock                    Install without updating any existing resolutions
    <pkg> --latest                  Install all dependencies to their very latest versions
    <pkg> (--dev|--peer|--optional) Install a dev, peer or optional dependency
    <pkg> --override main=dist/x.js Install with a persisted package.json property override
    <source> -o name=x              Install a custom source (git:|git+(https|..):|https:|file:)

  jspm link <name>? <source>        Link a custom source into jspm_packages as a named package
  jspm unlink <name>?               Unlink a named package back to its original target
  jspm update                       Update packages within package.json ranges
  jspm update <name>+               Update the matching package install within its range
  jspm uninstall <name>+            Uninstall a top-level package
  jspm clean                        Clear unused and orphaned dependencies
  jspm checkout <name>+             Copy a package within jspm_packages for local modification

  Install Options:
    --offline                       Run command offline using the jspm cache
    --prefer-offline (-q)           Use cached lookups where possible for fastest install

${bold('Execute')}
  jspm run <module>                 Execute a given module in NodeJS with jspm resolution${/*
  jspm <script-name> <args>         Execute a package.json script TODO*/''}
  
  jspm serve                        Start a HTTP/2 server with <script type=module> loading
${/*POSSIBILITY:      --http                          Run a HTTP/1 dev server to skip certificate authentication*/
''}      --generate-cert (-g)            Generate, authorize and sign a custom CA cert for serving
      --open (-o)                     Automatically open a new browser window when starting the server

${bold('Build')}
  jspm build <entry> -o <outfile>?  Build a module into a single file, inlining dynamic imports
    <entry>+ -d <outdir>            Build modules, chunking entry points and dynamic imports

  Build Options:
    --external <name>(=<alias>)*    Exclude dependencies from the build with optional aliases
    --format [cjs|system|global]    Set a custom output format for the build (defaults to esm)
    --remove-dir                    Clear the output directory before build
    --show-graph                    Show the build module graph summary
${/*TODO:      --watch                         Watch build files after build for rebuild on change
      --global-name x                 When using the global format, set the top-level global name
      --global-deps <dep=globalName>  When using the global format, name external dep globals
      --minify                        Minify the build output
      --skip-source-maps              Disable source maps
      --banner <file|source>          Include the given banner at the top of the build file
      --global-defs <global=value>+   Define the given constant global values for build
      --source-map-contents           Inline source contents into the source map
      --inline (<name>(|<parent>)?)+  Modules to always inline into their parents, never chunked
      (--common <name>+)+             Define a common chunk, always to be used for its modules
      (--group <name>+)+              Define a manual chunk, used only in exact combination

    jspm depcache <entry>             Outload the latency-optimizing preloading HTML for an ES module*/''}
${bold('Inspect')}${
/*  jspm graph <entry> (TODO)      Display the dependency graph for a given module*/''}
  jspm resolve <module>             Resolve a module name with the jspm resolver to a path
    <module> <parent>               Resolve a module name within the given parent
    <module> (--browser|--bin)      Resolve a module name in a different conditional env
${/*jspm inspect (TODO)               Inspect the installation constraints of a given dependency */''}
${bold('Configure')}
  jspm registry-config <name>       Run configuration prompts for a specific registry
  jspm config <option> <setting>    Set jspm global config values in .jspm/config
  jspm config --get <option>        Read a jspm global config value
  
  Global Options:
    --skip-prompts (-y)             Use default options for prompts, never asking for user input
    --log [ok|warn|err|debug|none]  Set the log level
    --project (-p) <path>           Set the jspm project directory
  `);
      break;

      case 'init':
        ui.err('jspm init is still under development.');
        return;
        var projectDir;
        if (setProjectPath) {
          if (args[0])
            throw new JspmUserError(`Only one argument is passed to jspm init - the project path to initialize.`);
          projectDir = projectPath;
        }
        else {
          projectDir = args[0];
        }
        project = new api.Project(projectDir, { offline, preferOffline, userInput, init: true });
        await project.save();
      break;

      case 'r':
      case 'run':
        // TODO: support custom env for jspm-resolve loader by passing JSPM_ENV_PRODUCTION custom env vars
        // let options;
        // ({ args, options } = readOptions(args, ['react-native', 'production', 'electron']));
        await api.run(args[0], args.splice(1));
      break;

      case 's':
      case 'serve': {
        let options;
        ({ options, args } = readOptions(args, ['open', 'generate-cert'], []));
        if (projectPath && setProjectPath) {
          try {
            process.chdir(projectPath);
          }
          catch (err) {
            if (err && err.code === 'ENOENT')
              throw new JspmUserError(`Project path ${bold(projectPath)} isn't a valid folder path.`);
          }
        }
        if (args.length)
          throw new JspmUserError(`Unknown argument ${bold(args[0])}.`);
        const server = await api.devserver(options);
        await server.process;
      }
      break;

      case 're':
      case 'resolve': {
        let options;
        ({ args, options } = readOptions(args, ['format', 'browser', 'bin', 'react-native', 'production', 'electron']));

        let env = readEnv(options);
        
        let parent;
        if (args[1]) {
          let parentFormat;
          ({ resolved: parent, format: parentFormat } = api.resolveSync(args[1], setProjectPath ? projectPath + path.sep : undefined, env, true));
          if (parentFormat === 'builtin')
            parent = undefined;
        }
        
        const resolved = api.resolveSync(args[0], parent, env, true);

        if (options.format)
          ui.info(resolved.format || '<undefined>');
        else
          ui.info(resolved.resolved || '@empty');
      }
      break;

      case 'cl':
      case 'clean':
        project = new api.Project(projectPath, { offline, preferOffline, userInput });
        await project.clean();
      break;

      case 'co':
      case 'checkout':
        project = new api.Project(projectPath, { offline, preferOffline, userInput });
        await project.checkout(args);
      break;

      case 'un':
      case 'uninstall':
        project = new api.Project(projectPath, { offline, preferOffline, userInput });
        await project.uninstall(args);
      break;

      case 'l':
      case 'link': {
        let options;
        ({ options, args } = readOptions(args, [
          // TODO 'force', 'verify'
        ], [], ['override']));

        project = new api.Project(projectPath, { offline, preferOffline, userInput });
        
        if (args.length === 2) {
          await project.link(args[0], args[1].indexOf(':') === -1 ? 'file:' + args[1] : args[1], options);
        }
        else if (args.length === 1) {
          const linkSource = 'file:' + path.resolve(args[0]);
          const target = await project.registryManager.resolveSource(linkSource, project.projectPath, project.projectPath);
          await project.install([{
            name: undefined,
            parent: undefined,
            target,
            type: DepType.primary
          }], options);
        }
        else if (args.length !== 1) {
          throw new JspmUserError(`Link command takes at most two arguments - an optional package name and a path.`);
        }
      }
      break;

      case 'ug':
      case 'upgrade': {
        project = new api.Project(projectPath, { offline, preferOffline, userInput });
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
          'reset', // TODO 'force', 'verify'
          'latest'
          ], [], ['override']);
        project = new api.Project(projectPath, { offline, preferOffline, userInput });
        await project.update(selectors, options);
      }
      break;

      case 'i':
      case 'install': {
        let { options, args: installArgs } = readOptions(args, [
            // install options
            'reset', // TODO 'force', 'verify'
            // install type
            'save-dev', 'dev', 'optional', 'peer',
            // constraint options
            'exact', 'edge',
            // resolver options
            'latest', 'lock',
            ], [], ['override']);
        
        project = new api.Project(projectPath, { offline, preferOffline, userInput });

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

        const installTargets = installArgs.map(arg => {
          let name, target;

          /*
           * Assignment target install
           *   jspm install x=y@1.2.3
           */
          const match = arg.match(installEqualRegEx);
          if (match) {
            name = match[1];
            target = arg.substr(name.length + 1);
          }
          else {
            target = arg;
          }

          /*
           * File install sugar cases:
           *   ./local -> file:./local
           *   /local -> file:/local
           *   ~/file -> file:~/file
           */
          if (target.match(fileInstallRegEx)) {
            target = 'file:' + target;
          }
          
          /*
           * Plain target install
           * Should ideally support a/b/c -> file:a/b/c resource sugar, but for now omitted
           */
          else if (!target.match(resourceInstallRegEx)) {
            let registryIndex = target.indexOf(':');
            let targetString = target;
            // a/b -> github:a/b sugar
            if (registryIndex === -1 && target.indexOf('/') !== -1 && target[0] !== '@')
              targetString = 'github:' + target;
            if (registryIndex === -1)
              targetString = ':' + targetString;
            target = processPackageTarget(name, targetString, project.defaultRegistry);
          }

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
      }
      break;

      case 'b':
      case 'build':
      let { options, args: buildArgs } = readOptions(args, [
        'remove-dir',
        'node',
        'mjs',
        'browser', 'bin', 'react-native', 'production', 'electron',
        'show-graph'
        // 'watch' 'exclude-external', 'minify', 'skip-source-maps', 'source-map-contents', 'inline-source-maps'
        ], ['directory', 'out', 'format', 'global-name', 'chunk-prefix', 'external' /*, 'global-deps', 'banner', 'global-defs'*/]);
        options.env = readEnv(options);
        options.basePath = projectPath ? path.resolve(projectPath) : process.cwd();
        if (options.external) {
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
          options.external = external;
        }
        let result;
        if ('out' in options || 'directory' in options === false && buildArgs.length === 1) {
          if (buildArgs.length !== 1)
            throw new JspmUserError(`A single module name must be provided to jspm build -o.`);
          result = { [options.out || 'build.js']: await api.build(buildArgs[0], options.out || 'build.js', options) };
        }
        else {
          result = await api.build(buildArgs, options.directory || 'dist', options);
        }
        if (options.showGraph) {
          // Improvements to this welcome! sizes in KB? Actual graph display? See also index.ts in es-module-optimizer
          const names = Object.keys(result).sort((a, b) => {
            const aEntry = result[a].entryPoint;
            const bEntry = result[b].entryPoint;
            if (aEntry && !bEntry)
              return -1;
            else if (bEntry && !aEntry)
              return 1;
            return a > b ? 1 : -1;
          });
          for (let name of names) {
            const entry = result[name];
            const deps = entry.imports;
            console.log(`${bold(name)}${deps.length ? ' imports ' : ''}${deps.sort().join(', ')}:`);
            
            for (let module of entry.modules.sort()) {
              console.log(`  ${path.relative(process.cwd(), module).replace(winSepRegEx, '/')}`);
            }
            console.log('');
          }
        }
      break;

      case 're':
      case 'registry':
        if (args[0] !== 'config')
          throw new JspmUserError(`Unknown command ${bold(cmd)}.`);
        args = args.splice(1);
      case 'rc':
      case 'registry-config':
        if (args.length !== 1)
          throw new JspmUserError(`Only one argument expected for the registry name to configure.`);
        project = new api.Project(projectPath, { offline, preferOffline, userInput });
        await project.registryConfig(args[0]);
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
        project = new api.Project(projectPath, { offline, preferOffline, userInput });
        await project.clearCache();
      break;

      default:
        throw new JspmUserError(`Unknown command ${bold(cmd)}.`);
    }
  }
  catch (err) {
    if (process.env.globalJspm !== undefined) {
      if (err && err.hideStack)
        (project ? project.log.err.bind(project.log) : ui.err)(err.message || err);
      else
        (project ? project.log.err : ui.err)(err && err.stack || err);
    }
    throw err;
  }
  finally {
    if (project)
      await project.dispose();
  }
}

if (process.env.globalJspm !== undefined)
  cliHandler(path.dirname(process.env.jspmConfigPath), process.argv[2], process.argv.slice(3))
  .then(() => process.exit(), _err => process.exit(1));

function readEnv (opts) {
  let env;
  if (opts.browser)
    (env = env || {}).browser = true;
  if (opts.bin)
    (env = env || {}).bin = true;
  if (opts['react-native'])
    (env = env || {})['react-native'] = true;
  if (opts.production)
    (env = env || {}).production = true;
  if (opts.electron)
    (env = env || {}).electron = true;
  return env;
}