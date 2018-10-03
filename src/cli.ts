/*
 *   Copyright 2014-2018 Guy Bedford (http://guybedford.com)
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
import fs = require('fs');
import path = require('path');
import * as api from './api';
import { bold, highlight, JspmUserError, readModuleEnv } from './utils/common';
import globalConfig from './config/global-config-file';

import { DepType } from './install/package';
import { readOptions, readValue, readPropertySetters } from './utils/opts';
import { JSPM_GLOBAL_PATH } from './api';
import { extend } from './map/utils';
import { readJSONStyled, defaultStyle, serializeJson } from './config/config-file';

const installEqualRegEx = /^(@?([-_\.a-z\d]+\/)?[\-\_\.a-z\d]+)=/i;

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
  jspm-node <module>                Execute NodeJS with jspm resolution
  jspx <module>                     Install and run a given module in a temporary project
  jspm run <name>                   Run package.json "scripts" with the project bin env${/*
  jspm <script-name> <args>         Execute a package.json script TODO*/''}

${bold('Package Name Maps Generation')}
  jspm map -o packagemap.json       Generates a package name map for all dependencies
    --production                    Generate a package name map with production resolutions
  jspm map <module>+                Generate a package name map for specific modules only
  jspm map -i in.json -o out.json   Combine the generated output with an existing package map
  jspm map x -p /jspm_packages      Generate a package name map to a specific jspm_packages URL

${bold('Inspect')}
  jspm trace <entry>+               Return the JSON resolution graph for a given module
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
        const exitCode = await api.jspx(target || generatorName, [initPath, ...args.slice(2)], { latest: true, userInput, offline });
        process.exit(exitCode);
      }
      break;

      case 'r':
      case 'run': {
        project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true });
        const exitCode = await project.run(args[0], args.slice(1));
        process.exit(exitCode);
      }
      break;

      case 'n':
      case 'node':
        ui.err(`Use ${bold('jspm-node')} for NodeJS execution.`);
      break;

      case 't':
      case 'trace': {
        let options;
        ({ args, options } = readOptions(args, ['bin', 'react-native', 'production', 'electron', 'node'], ['out', 'in']));

        project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true });
        const map = await api.map(project, options);

        if (!args.length)
          throw new JspmUserError('Trace requires a list of module names to trace.');

        const traced = await api.trace(project, map, options.out ? path.dirname(path.resolve(options.out)) : undefined, args);

        const output = await serializeJson(traced, defaultStyle);

        if (options.out)
          await new Promise((resolve, reject) => fs.writeFile(options.out, output, err => err ? reject(err) : resolve()));
        else
          process.stdout.write(output);
      }
      break;

      case 'm':
      case 'map': {
        let options;
        ({ args, options } = readOptions(args, ['bin', 'react-native', 'production', 'electron', 'cdn'], ['out', 'in', 'jspmPackages']));

        let inputMap, style = defaultStyle;
        if (options.in)
          ({ json: inputMap, style } = await readJSONStyled(options.in));

        project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true });
        let map = await api.map(project, options);

        if (inputMap)
          extend(map, inputMap);

        if (args.length)
          map = await api.filterMap(project, map, args);

        if (options.cdn && !options.jspmPackages)
          options.jspmPackages = options.production ? 'https://production.jspm.io' : 'https://mapdev.jspm.io';

        const jspmPackagesURL = options.jspmPackages ? options.jspmPackages : options.out ?  path.relative(path.dirname(path.resolve(options.out)), path.resolve(projectPath, 'jspm_packages')).replace(/\\/g, '/') : 'jspm_packages';
        if (jspmPackagesURL !== 'jspm_packages')
          map = api.renormalizeMap(map, jspmPackagesURL, options.cdn);

        // we dont want input map items filtered so always add them back
        if (inputMap)
          extend(map, inputMap);

        const output = await serializeJson(map, style);
        if (options.out)
          await new Promise((resolve, reject) => fs.writeFile(options.out, output, err => err ? reject(err) : resolve()));
        else
          process.stdout.write(output);
      }
      break;

      case 're':
      case 'resolve': {
        let options;
        ({ args, options } = readOptions(args, ['format', 'browser', 'bin', 'react-native', 'production', 'electron']));

        let env = readModuleEnv(options);
        
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
        project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true });
        await project.clean();
      break;

      case 'co':
      case 'checkout':
        project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true });
        await project.checkout(args);
      break;

      case 'un':
      case 'uninstall':
        project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true });
        await project.uninstall(args);
      break;

      case 'l':
      case 'link': {
        let options;
        ({ options, args } = readOptions(args, [
          // TODO 'force', 'verify'
        ], [], ['override']));

        project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true });
        
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
        project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true });
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
        project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true });
        await project.update(selectors, options);
      }
      break;

      case 'i':
      case 'install': {
        let { options, args: installArgs } = readOptions(args, [
            // install options
            'reset', 'force',
            // install type
            'save-dev', 'dev', 'optional', 'peer',
            // constraint options
            'exact', 'edge',
            // resolver options
            'latest', 'lock',
            ], [], ['override']);

        if (options.force)
          throw new JspmUserError(`${highlight('--force')} flag is yet to be implemented. Use ${bold('jspm cc && jspm install')} for now, although this is only necessary if you have upgraded jspm or modified a globally linked dependency file.`);
        
        project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true });

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
        project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true });
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
        project = new api.Project(projectPath, { offline, preferOffline, userInput, cli: true });
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