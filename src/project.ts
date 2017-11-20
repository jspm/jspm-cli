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
import * as path from 'path';
import rimraf = require('rimraf');
import events = require('events');

import { JspmUserError, bold, highlight, underline, JSPM_CACHE_DIR } from './utils/common';
import { logErr, log, confirm, input, LogType, startSpinner, stopSpinner, logLevel } from './utils/ui';
import Config from './config';
import RegistryManager from './install/registry-manager';
import Cache from './utils/cache';
import globalConfig from './config/global-config-file';
import FetchClass from './install/fetch';

// import { ExactPackage, PackageName, clearPackageCache } from './utils/package';
import { Install, InstallOptions, Installer } from './install';

if (process.env.globalJspm !== undefined) {
  process.once('unhandledRejection', err => {
    log('Internal Error: Unhandled promise rejection.', LogType.err);
    logErr(err.stack || err);
    process.exit(1);
  });
  process.once('SIGINT', () => {
    log('jspm process terminated.');
    process.exit(1);
  });
  process.once('SIGTERM', () => {
    log('jspm process terminated.');
    process.exit(1);
  });
}
else {
  process.on('unhandledRejection', err => {
    console.error('Internal Error: Unhandled promise rejection.');
    throw err;
  });
}

export type Hook = 'preinstall' | 'postinstall';

export interface Logger {
  newline: () => void;
  msg: (msg: string) => void;
  errMsg: (err: string | Error | JspmUserError) => void;
  err: (err: string | Error | JspmUserError) => void;
  debug: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  ok: (msg: string) => void;
  taskStart: (name: string) => () => void;
  taskEnd: (name: string) => void;
}

export type input = typeof input;
export type confirm = typeof confirm;

// git is required for jspm to work
let hasGit = true;
try {
  require('which').sync('git');
}
catch (e) {
  hasGit = false;
}

export class Project {
  projectPath: string;
  config: Config;
  globalConfig: typeof globalConfig;
  cli: boolean;
  defaultRegistry: string;
  log: Logger;
  confirm: typeof confirm;
  input: typeof input;
  userInput: boolean;
  offline: boolean;
  preferOffline: boolean;
  registryManager: RegistryManager;
  installer: Installer;
  fetch: FetchClass;

  constructor (projectPath: string, { userInput = true, offline = false, preferOffline = false } = {}) {
    this.projectPath = projectPath;
    if (!hasGit)
      throw new JspmUserError(`${bold('git')} is not installed in path. You can install git from http://git-scm.com/downloads.`);

    // is this running as a CLI or API?
    this.cli = process.env.globalJspm !== undefined;
    this.log = this.cli ? new CLILogger() : new APILogger();
  
    if (process.env.globalJspm === 'true')
      this.log.warn(`Running jspm globally, it is advisable to locally install jspm via ${bold(`npm install jspm --save-dev`)}.`);

    // hardcoded for now (pending jspm 3...)
    this.defaultRegistry = 'npm';

    this.config = new Config(projectPath, this);
    this.globalConfig = globalConfig;
    this.confirm = this.cli ? confirm : (_msg, def) => Promise.resolve(typeof def === 'boolean' ? def : undefined);
    this.input = this.cli ? input : (_msg, def) => Promise.resolve(typeof def === 'string' ? def : undefined);
    
    this.userInput = userInput;
    this.offline = offline;
    this.preferOffline = preferOffline;

    this.fetch = new FetchClass(this);

    if (!this.offline && !this.preferOffline) {
      if (globalConfig.get('preferOffline') === true)
        this.preferOffline = true;
    }

    let defaultRegistry = globalConfig.get('defaultRegistry');
    if (defaultRegistry === undefined || defaultRegistry === 'jspm')
      defaultRegistry = 'npm';

    this.registryManager = new RegistryManager({
      cacheDir: JSPM_CACHE_DIR,
      defaultRegistry,
      Cache,
      timeouts: {
        resolve: globalConfig.get('timeouts.resolve') || 30000,
        download: globalConfig.get('timeouts.download') || 300000
      },
      offline,
      preferOffline,
      userInput,
      strictSSL: globalConfig.get('strictSSL'),
      log: this.log,
      confirm: this.confirm,
      input: this.input,
      fetch: this.fetch
    });

    // load registries upfront
    // (strictly we should save registry configuration when a new registry appears)
    let registries = globalConfig.get('registries');
    Object.keys(registries).forEach(registry => {
      if (registry === 'jspm')
        return;
      try {
        this.registryManager.getEndpoint(registry);
      }
      catch (err) {
        if (err && err.code === 'REGISTRY_NOT_FOUND')
          this.log.warn(err.message.substr(err.message.indexOf('\n')).trim());
        else
          throw err;
      }
    });

    this.installer = new Installer(this);
  }

  dispose () {
    return Promise.all([
      this.config.dispose(),
      this.registryManager.dispose()
    ]);
  }

  /*
   * Main API methods
   */
  async update (selectors: string[], opts: InstallOptions) {
    const taskEnd = this.log.taskStart('Updating...');
    try {
      var changed = await this.installer.update(selectors, opts);
    }
    finally {
      taskEnd();
    }
    this.log.newline();
    // NB install state change logging!
    if (changed)
      this.log.ok('Update complete.');
    else
      this.log.ok('Already up to date.');
  }
  async install (installs: Install[], opts: InstallOptions) {
    const taskEnd = this.log.taskStart('Installing...');
    try {
      await runHook(this, 'preinstall');      
      if (installs.length === 0) {
        opts.lock = true;
        if (opts.latest) {
          opts.latest = false;
          this.log.warn(`${bold('--latest')} flag does not apply to package lock install.`);
        }
      }
      var changed = await this.installer.install(installs, opts);
      await runHook(this, 'postinstall');
    }
    finally {
      taskEnd();
    }
    this.log.newline();
    // NB install state change logging!
    if (changed)
      this.log.ok('Install complete.');
    else
      this.log.ok('Already installed.');
  }

  async uninstall (names: string[]) {
    const taskEnd = this.log.taskStart('Uninstalling...');
    try {
      await this.installer.uninstall(names);
    }
    finally {
      taskEnd();
    }
    this.log.newline();
    this.log.ok('Uninstalled successfully.');
  }

  async checkout (names: string[]) {
    const taskEnd = this.log.taskStart('Checking out...');
    try {
      await this.installer.checkout(names);
    }
    finally {
      taskEnd();
    }
  }

  async link (pkg: string, source: string, opts: InstallOptions) {
    const taskEnd = this.log.taskStart('Linking...');
    try {
      await runHook(this, 'preinstall');
      var changed = await this.installer.link(pkg, source, opts);
      await runHook(this, 'postinstall');
    }
    finally {
      taskEnd();
    }
    this.log.newline();
    if (changed)
      this.log.ok('Linked Successfully.');
    else
      this.log.ok('Already linked.');
  }

  async clean () {
    const taskEnd = this.log.taskStart('Cleaning...');
    try {
      await this.installer.clean(true);
    }
    finally {
      taskEnd();
    }
    this.log.newline();
    this.log.ok('Project cleaned successfully.');
  }

  /*
  async resolve (name: string, parentName: string) {
    let loader = getLoader(this);
    if (parentName)
      parentName = await loader.resolve(parentName);
    
    let resolved = await loader.resolve(name, parentName);
    return toCleanPath(resolved);
  }

  resolveSync (name: string, parentName: string) {
    let loader = getLoader(this);
    if (parentName)
      parentName = loader.resolveSync(parentName);
    
    let resolved = loader.resolveSync(name, parentName);
    return toCleanPath(resolved);
  }

  async run (moduleName: string, view = false) {
    let m = require(moduleName);
    if (view)
      this.log(m);
  }
  */

  async init (basePath: string) {
    if (basePath)
      process.env.jspmConfigPath = path.resolve(basePath, 'package.json');
    let relBase = path.relative(process.cwd(), path.dirname(process.env.jspmConfigPath || ''));
    if (relBase !== '')
      this.log.msg(`Initializing package at ${highlight(relBase)}\nUse ${bold(`jspm init .`)} to intialize into the current folder.`);
    
    /* await this.config.load(true);
    await this.config.save();

    this.log('');
    this.ok(`package.json at %${path.relative(process.cwd(), config.pjsonPath)}\n` +
        `Config at %${path.relative(process.cwd(), config.pjson.configFile)}%` + 
        (config.loader.devFile ? ', %' + path.relative(process.cwd(), config.pjson.configFileDev) + '%' : '') +
        (config.loader.browserFile ? ', %' + path.relative(process.cwd(), config.pjson.configFileBrowser) + '%' : '') +
        (config.loader.nodeFile ? ', %' + path.relative(process.cwd(), config.pjson.configFileNode) + '%' : ''));*/
  }

  async registryConfig (name: string) {
    return this.registryManager.configure(name);
  }

  async clearCache () {
    await new Promise((resolve, reject) => rimraf(JSPM_CACHE_DIR, err => err ? reject(err) : resolve()));
    this.log.warn(`Global cache cleared. ${underline(`All jspm projects for this system user will now have broken symlinks due to the shared global package cache.`)}`);
    this.log.info(`${bold(`jspm install <packageName> -f`)} is equivalent to running a cache clear for that specific install tree.`);
    this.log.info(`Please post an issue if you suspect the cache isn't invalidating properly.`);
  }
}

export async function runHook (project: Project, name: Hook) {
  var hooks = project.config.pjson.hooks;

  if (!hooks || !hooks[name])
    return;
  
  try {
    let m = require(hooks[name]);

    if (!m.default || typeof m.default !== 'function')
      throw new Error(`Hook ${bold(name)} doesn't contain a default export hook function.`);
  
    await m.default();
  }
  catch (e) {
    project.log.err(`Error running ${bold(name)} hook.`);
    project.log.err(e.stack || e);
  }
}

class APILogger extends events.EventEmitter implements Logger {
  newline () {}
  msg (msg: string) {
    this.emit('msg', msg);
  }
  errMsg (msg: string | Error | JspmUserError) {
    this.emit('errMsg', msg);
  }
  err (msg: string | Error | JspmUserError) {
    this.emit('err', msg);
  }
  debug (msg: string) {
    this.emit('debug', msg);
  }
  info (msg: string) {
    this.emit('info', msg);
  }
  warn (msg: string) {
    this.emit('warn', msg);
  }
  ok (msg: string) {
    this.emit('ok', msg);
  }
  taskStart (name: string) {
    this.emit('taskStart', name);
    return () => this.taskEnd(name);
  }
  taskEnd (name: string) {
    this.emit('taskEnd', name);
  }
};

class CLILogger implements Logger {
  tasks: string[];
  lastTask: string;
  constructor () {
    this.tasks = [];
    this.lastTask = undefined;
  }
  newline () {
    log('');
  }
  msg (msg: string) {
    log(msg);
  }
  errMsg (msg: string | Error | JspmUserError) {
    if (msg instanceof Error) {
      if ((<JspmUserError>msg).hideStack)
        msg = msg.message;
      else
        msg = msg.stack || msg && msg.toString();
    }
    logErr(msg);
  }
  err (msg: string | Error | JspmUserError) {
    if (msg instanceof Error) {
      if ((<JspmUserError>msg).hideStack)
        msg = msg.message;
      else
        msg = msg.stack || msg && msg.toString();
    }
    log(msg, LogType.err);
  }
  debug (msg: string) {
    log(msg, LogType.debug);
  }
  info (msg: string) {
    log(msg, LogType.info);
  }
  warn (msg: string) {
    log(msg, LogType.warn);
  }
  ok (msg: string) {
    log(msg, LogType.ok);
  }
  taskStart (name: string) {
    this.tasks.push(name);
    log(this.tasks[this.tasks.length - 1], LogType.status);
    if (this.tasks.length === 1)
      startSpinner();
    // allow debug log state to expand status
    if (logLevel === LogType.debug && this.lastTask)
      log(this.lastTask, LogType.debug);
    this.lastTask = name;
    return this.taskEnd.bind(this, name);
  }
  taskEnd (name: string) {
    const taskIndex = this.tasks.indexOf(name);
    if (taskIndex === -1)
      return;
    this.tasks.splice(taskIndex, 1);
    if (this.tasks.length)
      log(this.tasks[this.tasks.length - 1], LogType.status);
    else
      stopSpinner();
    if (logLevel === LogType.debug && this.lastTask && this.lastTask !== this.tasks[this.tasks.length - 1]) {
      log(this.lastTask, LogType.debug);
      this.lastTask = undefined;
    }
  }
};