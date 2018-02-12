"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const ui = require("./utils/ui");
const path = require("path");
const api = require("./api");
const common_1 = require("./utils/common");
const opts_1 = require("./utils/opts");
const run_cmd_1 = require("./utils/run-cmd");
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
  jsps                              Start a HTTP/2 server with <script type=module> loading
${ /*POSSIBILITY:      --http                          Run a HTTP/1 dev server to skip certificate authentication*/''}      --generate-cert (-g)            Generate, authorize and sign a custom CA cert for serving
      --open (-o)                     Automatically open a new browser window when starting the server
  
  Global Options:
    --skip-prompts (-y)             Use default options for prompts, never asking for user input
    --log [ok|warn|err|debug|none]  Set the log level
    --project (-p) <path>           Set the jspm project directory
  `);
                break;
        }
        let options;
        ({ options, args } = opts_1.readOptions(args, ['open', 'generate-cert'], null, ['script']));
        if (args.length)
            throw new common_1.JspmUserError(`Unknown argument ${common_1.bold(args[0])}.`);
        options.projectPath = projectPath;
        const server = await api.serve(options);
        let runTask;
        if (options.script)
            runTask = run_cmd_1.runCmd(options.script, projectPath);
        await server.process;
        if (runTask)
            process.exit(await runTask);
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
//# sourceMappingURL=jsps.js.map