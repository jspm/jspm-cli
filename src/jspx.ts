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

import path = require('path');
import * as api from './api';
import { bold, JspmUserError } from './utils/common';

export default async function cliHandler (projectPath: string, args: string | string[]) {
  if (typeof args === 'string')
    args = args.split(' ');
  
  try {
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
  jspx <target> <flag>*             Install and run a given target bin in a temporary project
  jspx <target> --bin <cmd>         Install and run a specific target bin name
  
  Options:
    --latest                        Ensure the latest version is installed
    --offline                       Offline install
    --skip-prompts (-y)             Use default options for prompts, never asking for user input
    --log [ok|warn|err|debug|none]  Set the log level
    --project (-p) <path>           Set the jspm project directory
  `);
      break;
    }

    // read global options
    let bin: string;
    const flagArgsEndIndex = args.findIndex(arg => arg[0] !== '-');

    if (flagArgsEndIndex === -1) {
      throw new JspmUserError(`jspx requires a target package to install and run.`);
    }

    const flagArgs = args.slice(0, flagArgsEndIndex);
    const target = args[flagArgsEndIndex];
    let latest = false, offline = false;
    args = args.slice(flagArgsEndIndex + 1);

    for (let i = 0; i < flagArgs.length; i++) {
      const arg = flagArgs[i];
      switch (arg) {
        case '-y':
        case '--skip-prompts':
          (<string[]>args).splice(i--, 1);
          ui.setUseDefaults(true);
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
          projectPath = args[i + 1];
          (<string[]>args).splice(i, 2);
          i -= 2;
        break;
        case '-b':
        case '--bin':
          bin = args[i + 1];
          (<string[]>args).splice(i, 2);
          i -= 2;
        break;
        case '-l':
        case '--latest':
          (<string[]>args).splice(i--, 1);
          latest = true;
        break;
        case '-o':
        case '--offline':
          (<string[]>args).splice(i--, 1);
          offline = true;
        break;
      }
    }
    
    await api.jspx(target, args, { projectPath, latest, bin, offline });
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

if (process.env.globalJspm !== undefined)
  cliHandler(path.dirname(process.env.jspmConfigPath), process.argv.slice(2))
  .then(() => process.exit(), _err => process.exit(1));