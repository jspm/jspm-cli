"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const ui = require("./utils/ui");
const path = require("path");
const api = require("./api");
const common_1 = require("./utils/common");
const opts_1 = require("./utils/opts");
async function cliHandler(projectPath, args) {
    if (typeof args === 'string')
        args = args.split(' ');
    try {
        // first read global options
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            switch (arg) {
                case '-y':
                case '--skip-prompts':
                    args.splice(i--, 1);
                    ui.setUseDefaults(true);
                    break;
                case '-l':
                case '--log':
                    const logLevelString = args[i + 1];
                    const logLevel = ui.LogType[logLevelString];
                    if (typeof logLevel !== 'number') {
                        ui.warn(`${common_1.bold(logLevelString)} is not a valid log level.`);
                        return process.exit(1);
                    }
                    ui.setLogLevel(logLevel);
                    args.splice(i, 2);
                    i -= 2;
                    break;
                case '-p':
                case '--project':
                    projectPath = args[i + 1];
                    args.splice(i, 2);
                    i -= 2;
                    break;
            }
        }
        switch (args[0]) {
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
  jspc <entry> -o <outfile>?        Build a module into a single file, inlining dynamic imports
    <entry>+ -d <outdir>            Build modules, chunking entry points and dynamic imports

  Build Options:
    --production                    Production build with minification
    --node                          NodeJS build
    --source-maps                   Output source maps
    --external <name>(=<alias>)*    Exclude dependencies from the build with optional aliases
    --format [cjs|system|amd]       Set a custom output format for the build (defaults to esm)
    --clear-dir                     Clear the output directory before build
    --show-graph                    Show the build module graph summary
    --watch                         Watch build files after build for rebuild on change     
    --banner <file|source>          Include the given banner at the top of the build file  
`);
                break;
        }
        let { options, args: buildArgs } = opts_1.readOptions(args, [
            'clear-dir',
            'node',
            // 'mjs',
            'browser', 'bin', 'react-native', 'production', 'electron',
            'minify',
            'show-graph',
            'source-maps',
            'watch' // 'exclude-external', 'minify',
        ], ['dir', 'out', 'format'], ['target', 'external', 'banner']);
        options.env = common_1.readModuleEnv(options);
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
        if (options.target)
            options.target = options.target.split(',').map(x => x.trim());
        else if (options.target === '')
            options.target = true;
        options.log = true;
        if ('out' in options || 'dir' in options === false && buildArgs.length === 1) {
            if (buildArgs.length !== 1)
                throw new common_1.JspmUserError(`A single module name must be provided to jspc -o.`);
            options.out = options.out || 'build.js';
            await api.compile(buildArgs[0], options);
        }
        else {
            options.dir = options.dir || 'dist';
            await api.compile(buildArgs, options);
        }
    }
    catch (err) {
        if (process.env.globalJspm !== undefined) {
            if (err && err.hideStack)
                ui.err(err.message || err);
            else
                ui.err(err && err.stack || err);
        }
        throw err;
    }
}
exports.default = cliHandler;
if (process.env.globalJspm !== undefined)
    cliHandler(path.dirname(process.env.jspmConfigPath), process.argv.slice(2))
        .then(() => process.exit(), _err => process.exit(1));
//# sourceMappingURL=jspc.js.map