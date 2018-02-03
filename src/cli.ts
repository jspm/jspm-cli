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

import path = require('path');
import * as api from './api';
import { bold, highlight, JspmUserError } from './utils/common';
import globalConfig from './config/global-config-file';

import { DepType } from './install/package';
import { readOptions, readValue, readPropertySetters } from './utils/opts';
import { runCmd } from './utils/run-cmd';
import { JSPM_GLOBAL_PATH } from './api';

const installEqualRegEx = /^(@?([-_\.a-z\d]+\/)?[\-\_\.a-z\d]+)=/i;

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
        case '-g':
          setProjectPath = true;
          projectPath = api.JSPM_GLOBAL_PATH;
          (<string[]>args).splice(i, 1);
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
  jspm node <module>                Execute NodeJS with jspm resolution${/*
  jspm <script-name> <args>         Execute a package.json script TODO*/''}
  
  jspm serve                        Start a HTTP/2 server with <script type=module> loading
${/*POSSIBILITY:      --http                          Run a HTTP/1 dev server to skip certificate authentication*/
''}      --generate-cert (-g)            Generate, authorize and sign a custom CA cert for serving
      --open (-o)                     Automatically open a new browser window when starting the server

${bold('Build')}
  jspm build <entry> -o <outfile>?  Build a module into a single file, inlining dynamic imports
    <entry>+ -d <outdir>            Build modules, chunking entry points and dynamic imports

  Build Options:
    --source-maps                   Output source maps
    --external <name>(=<alias>)*    Exclude dependencies from the build with optional aliases
    --format [cjs|system|amd]       Set a custom output format for the build (defaults to esm)
    --remove-dir                    Clear the output directory before build
    --show-graph                    Show the build module graph summary
    --watch                         Watch build files after build for rebuild on change     
    --banner <file|source>          Include the given banner at the top of the build file  
${/*TODO:      
    --minify                        Minify the build output
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

      case 'init': {
        const [generator, target = generator] = args[0] && args[0].split('=') || [undefined];
        const initPath = args[1] || '.';
        if (!generator) {
          throw new JspmUserError(`jspm init requires a provided ${bold('generator')} name.`);
        }
        const generatorName = `jspm-init-${generator}`;
        project = new api.Project(api.JSPM_GLOBAL_PATH, { offline, preferOffline, userInput });
        await project.install([{
          name: generatorName,
          target: target || generatorName,
          parent: undefined,
          type: DepType.primary
        }], {
          dedupe: false,
          latest: true
        });
        const exitCode = await api.execNode([`${generatorName}/init`, initPath, ...args.slice(2)], api.JSPM_GLOBAL_PATH);
        process.exit(exitCode);
      }
      break;

      case 'r':
      case 'run': {
        project = new api.Project(projectPath, { offline, preferOffline, userInput });
        const exitCode = await project.run(args[0], args.slice(1));
        process.exit(exitCode);
      }
      break;

      case 'n':
      case 'node':
        // TODO: support custom env for jspm-resolve loader by passing JSPM_ENV_PRODUCTION custom env vars
        // let options;
        // ({ args, options } = readOptions(args, ['react-native', 'production', 'electron']));
        await api.execNode(args, setProjectPath ? projectPath : undefined);
      break;

      case 's':
      case 'serve': {
        let options;
        ({ options, args } = readOptions(args, ['open', 'generate-cert'], null, ['script']));
        if (args.length)
          throw new JspmUserError(`Unknown argument ${bold(args[0])}.`);
        options.projectPath = projectPath;
        const server = await api.serve(options);
        let runTask;
        if (options.script)
          runTask = runCmd(options.script, projectPath);
        await server.process;
        if (runTask)
          process.exit(await runTask);
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
        else if (setProjectPath) {
          parent = projectPath + path.sep;
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

        if (projectPath === JSPM_GLOBAL_PATH && !options.lock) {
          options.latest = true;
          options.dedupe = false;
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
        'show-graph',
        'source-maps',
        'watch'// 'exclude-external', 'minify',
        ], ['dir', 'out', 'format'], ['target', 'external', 'banner']);
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
          // TODO: aliasing
          options.external = Object.keys(external);
        }
        if (options.target)
          options.target = options.target.split(',').map(x => x.trim());
        else if (options.target === '')
          options.target = true;
        options.log = true;
        if ('out' in options || 'dir' in options === false && buildArgs.length === 1) {
          if (buildArgs.length !== 1)
            throw new JspmUserError(`A single module name must be provided to jspm build -o.`);
          options.out = options.out || 'build.js';
          await api.build(buildArgs[0], options);
        }
        else {
          options.dir = options.dir || 'dist';
          await api.build(buildArgs, options);
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