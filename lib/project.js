"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const path = require("path");
const rimraf = require("rimraf");
const events = require("events");
const mkdirp = require("mkdirp");
const common_1 = require("./utils/common");
const ui_1 = require("./utils/ui");
const config_1 = require("./config");
const registry_manager_1 = require("./install/registry-manager");
const cache_1 = require("./utils/cache");
const global_config_file_1 = require("./config/global-config-file");
const fetch_1 = require("./install/fetch");
// import { ExactPackage, PackageName, clearPackageCache } from './utils/package';
const install_1 = require("./install");
const run_cmd_1 = require("./utils/run-cmd");
const api_1 = require("./api");
// git is required for jspm to work
let hasGit = true;
try {
    require('which').sync('git');
}
catch (e) {
    hasGit = false;
}
function applyDefaultConfiguration(userConfig) {
    const config = Object.assign({}, userConfig);
    if (!config.registries) {
        const registriesGlobalConfig = global_config_file_1.default.get('registries') || {};
        const registries = {};
        Object.keys(registriesGlobalConfig).forEach((registryName) => {
            const registry = registriesGlobalConfig[registryName];
            if (registry.handler === 'jspm-npm' || registry.handler === 'jspm-github')
                registry.handler = undefined;
            registries[registryName] = {
                handler: registry.handler || `@jspm/${registryName}`,
                config: registry
            };
        });
        config.registries = registries;
    }
    if (!config.defaultRegistry) {
        let defaultRegistry = global_config_file_1.default.get('defaultRegistry');
        if (!defaultRegistry || defaultRegistry === 'jspm')
            defaultRegistry = 'npm';
        config.defaultRegistry = defaultRegistry;
    }
    if ('offline' in config === false)
        config.offline = false;
    if ('preferOffline' in config === false)
        config.preferOffline = global_config_file_1.default.get('preferOffline') || false;
    if ('cli' in config === false)
        config.cli = true;
    if ('timeouts' in config === false)
        config.timeouts = {
            resolve: global_config_file_1.default.get('timeouts.resolve') || 30000,
            download: global_config_file_1.default.get('timeouts.download') || 300000
        };
    if ('userInput' in config === false)
        config.userInput = true;
    if ('cacheDir' in config === false)
        config.cacheDir = common_1.JSPM_CACHE_DIR;
    if ('strictSSL' in config === false)
        config.strictSSL = global_config_file_1.default.get('strictSSL');
    return config;
}
class Project {
    constructor(projectPath, options) {
        this.projectPath = projectPath;
        if (!hasGit)
            throw new common_1.JspmUserError(`${common_1.bold('git')} is not installed in path. You can install git from http://git-scm.com/downloads.`);
        const config = applyDefaultConfiguration(options);
        // is this running as a CLI or API?
        this.cli = config.cli;
        this.log = this.cli ? new CLILogger() : new APILogger();
        // if (process.env.globalJspm === 'true')
        //  this.log.warn(`Running jspm globally, it is advisable to locally install jspm via ${bold(`npm install jspm --save-dev`)}.`);
        this.defaultRegistry = config.defaultRegistry;
        // hardcoded for now (pending jspm 3...)
        this.defaultRegistry = 'npm';
        mkdirp.sync(projectPath);
        this.config = new config_1.default(projectPath, this);
        this.globalConfig = global_config_file_1.default;
        this.confirm = this.cli ? ui_1.confirm : (_msg, def) => Promise.resolve(typeof def === 'boolean' ? def : undefined);
        this.input = this.cli ? ui_1.input : (_msg, def) => Promise.resolve(typeof def === 'string' ? def : undefined);
        this.userInput = config.userInput;
        this.offline = config.offline;
        this.preferOffline = config.preferOffline;
        this.cacheDir = config.cacheDir;
        this.fetch = new fetch_1.default(this);
        this.registryManager = new registry_manager_1.default({
            cacheDir: this.cacheDir,
            defaultRegistry: this.defaultRegistry,
            Cache: cache_1.default,
            timeouts: {
                resolve: config.timeouts.resolve,
                download: config.timeouts.download
            },
            offline: this.offline,
            preferOffline: this.preferOffline,
            userInput: this.userInput,
            strictSSL: config.strictSSL,
            log: this.log,
            confirm: this.confirm,
            input: this.input,
            fetch: this.fetch,
            registries: config.registries
        });
        // load registries upfront
        // (strictly we should save registry configuration when a new registry appears)
        this.registryManager.loadEndpoints();
        this.installer = new install_1.Installer(this);
    }
    checkGlobalBin() {
        // TODO: Provide the code to automatically add "$globalBin" to the users PATH with a prompt
        // although I couldn't find any existing npm packages that do this cross-platform!
        return;
        if (this.checkedGlobalBin)
            return;
        const globalBin = path.join(api_1.JSPM_GLOBAL_PATH, 'jspm_packages', '.bin');
        if (process.env[common_1.PATH].indexOf(globalBin) === -1)
            this.log.warn(`The global jspm bin folder ${common_1.highlight(globalBin)} is not currently in your PATH, add this for native jspm bin support.`);
        this.checkedGlobalBin = true;
    }
    dispose() {
        return Promise.all([
            this.config.dispose(),
            this.registryManager.dispose()
        ]);
    }
    async save() {
        return await this.config.save();
    }
    /*
     * Main API methods
     */
    async update(selectors, opts) {
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
    async install(installs, opts = {}) {
        const taskEnd = this.log.taskStart('Installing...');
        try {
            await runHook(this, 'preinstall');
            if (installs.length === 0) {
                opts.lock = true;
                if (opts.latest) {
                    opts.latest = false;
                    this.log.warn(`${common_1.bold('--latest')} flag does not apply to package lock install.`);
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
    async uninstall(names) {
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
    async checkout(names) {
        const taskEnd = this.log.taskStart('Checking out...');
        try {
            await this.installer.checkout(names);
        }
        finally {
            taskEnd();
        }
    }
    async link(pkg, source, opts) {
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
    async clean() {
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
    */
    async init(basePath) {
        if (basePath)
            process.env.jspmConfigPath = path.resolve(basePath, 'package.json');
        let relBase = path.relative(process.cwd(), path.dirname(process.env.jspmConfigPath || ''));
        if (relBase !== '')
            this.log.msg(`Initializing package at ${common_1.highlight(relBase)}\nUse ${common_1.bold(`jspm init .`)} to intialize into the current folder.`);
        /* await this.config.load(true);
        await this.config.save();
    
        this.log('');
        this.ok(`package.json at %${path.relative(process.cwd(), config.pjsonPath)}\n` +
            `Config at %${path.relative(process.cwd(), config.pjson.configFile)}%` +
            (config.loader.devFile ? ', %' + path.relative(process.cwd(), config.pjson.configFileDev) + '%' : '') +
            (config.loader.browserFile ? ', %' + path.relative(process.cwd(), config.pjson.configFileBrowser) + '%' : '') +
            (config.loader.nodeFile ? ', %' + path.relative(process.cwd(), config.pjson.configFileNode) + '%' : ''));*/
    }
    async registryConfig(name) {
        return this.registryManager.configure(name);
    }
    async clearCache() {
        await new Promise((resolve, reject) => rimraf(this.cacheDir, err => err ? reject(err) : resolve()));
        this.log.warn(`Global cache cleared. ${common_1.underline(`All jspm projects for this system user will now have broken symlinks due to the shared global package cache.`)}`);
        this.log.info(`${common_1.bold(`jspm install <packageName> -f`)} is equivalent to running a cache clear for that specific install tree.`);
        this.log.info(`Please post an issue if you suspect the cache isn't invalidating properly.`);
    }
    async run(name, args) {
        const scripts = this.config.pjson.scripts;
        const script = scripts[name];
        if (!script)
            throw new common_1.JspmUserError(`No package.json ${common_1.highlight('"scripts"')} entry for command ${common_1.bold(name)}`);
        const doPrePost = !name.startsWith('pre') && !name.startsWith('post');
        const cmds = [];
        if (doPrePost) {
            const pre = scripts[`pre${name}`];
            if (pre)
                cmds.push(pre);
            cmds.push(script);
            const post = scripts[`post${name}`];
            if (post)
                cmds.push(post);
        }
        else {
            cmds.push(script);
        }
        // before running commands dispose the configuration
        this.config.dispose();
        this.config = undefined;
        let exitCode = 0;
        await Promise.all(cmds.map(async (cmd) => {
            if (args.length)
                cmd += joinArgs(args);
            cmd = cmd.replace('npm ', 'jspm ');
            const cmdCode = await run_cmd_1.runCmd(cmd, this.projectPath);
            if (cmdCode !== 0)
                exitCode = cmdCode;
        }));
        return exitCode;
    }
}
exports.Project = Project;
const dblQuoteRegEx = /"/g;
function joinArgs(args) {
    return args.reduce((str, arg) => `${str} "${arg.replace(dblQuoteRegEx, '\\"')}"`, '');
}
async function runHook(project, name) {
    var hooks = project.config.pjson.hooks;
    if (!hooks || !hooks[name])
        return;
    try {
        let m = require(hooks[name]);
        if (!m.default || typeof m.default !== 'function')
            throw new Error(`Hook ${common_1.bold(name)} doesn't contain a default export hook function.`);
        await m.default();
    }
    catch (e) {
        project.log.err(`Error running ${common_1.bold(name)} hook.`);
        project.log.err(e.stack || e);
    }
}
exports.runHook = runHook;
class APILogger extends events.EventEmitter {
    newline() { }
    msg(msg) {
        this.emit('msg', msg);
    }
    errMsg(msg) {
        this.emit('errMsg', msg);
    }
    err(msg) {
        this.emit('err', msg);
    }
    debug(msg) {
        this.emit('debug', msg);
    }
    info(msg) {
        this.emit('info', msg);
    }
    warn(msg) {
        this.emit('warn', msg);
    }
    ok(msg) {
        this.emit('ok', msg);
    }
    taskStart(name) {
        this.emit('taskStart', name);
        return () => this.taskEnd(name);
    }
    taskEnd(name) {
        this.emit('taskEnd', name);
    }
}
;
class CLILogger {
    constructor() {
        this.tasks = [];
        this.lastTask = undefined;
    }
    newline() {
        ui_1.log('');
    }
    msg(msg) {
        ui_1.log(msg);
    }
    errMsg(msg) {
        if (msg instanceof Error) {
            if (msg.hideStack)
                msg = msg.message;
            else
                msg = msg.stack || msg && msg.toString();
        }
        ui_1.logErr(msg);
    }
    err(msg) {
        if (msg instanceof Error) {
            if (msg.hideStack)
                msg = msg.message;
            else
                msg = msg.stack || msg && msg.toString();
        }
        ui_1.log(msg, ui_1.LogType.err);
    }
    debug(msg) {
        ui_1.log(msg, ui_1.LogType.debug);
    }
    info(msg) {
        ui_1.log(msg, ui_1.LogType.info);
    }
    warn(msg) {
        ui_1.log(msg, ui_1.LogType.warn);
    }
    ok(msg) {
        ui_1.log(msg, ui_1.LogType.ok);
    }
    taskStart(name) {
        this.tasks.push(name);
        ui_1.log(this.tasks[this.tasks.length - 1], ui_1.LogType.status);
        if (this.tasks.length === 1)
            ui_1.startSpinner();
        // allow debug log state to expand status
        if (ui_1.logLevel === ui_1.LogType.debug && this.lastTask)
            ui_1.log(this.lastTask, ui_1.LogType.debug);
        this.lastTask = name;
        return this.taskEnd.bind(this, name);
    }
    taskEnd(name) {
        const taskIndex = this.tasks.indexOf(name);
        if (taskIndex === -1)
            return;
        this.tasks.splice(taskIndex, 1);
        if (this.tasks.length)
            ui_1.log(this.tasks[this.tasks.length - 1], ui_1.LogType.status);
        else
            ui_1.stopSpinner();
        if (ui_1.logLevel === ui_1.LogType.debug && this.lastTask && this.lastTask !== this.tasks[this.tasks.length - 1]) {
            ui_1.log(this.lastTask, ui_1.LogType.debug);
            this.lastTask = undefined;
        }
    }
}
;
//# sourceMappingURL=project.js.map