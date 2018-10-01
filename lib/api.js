"use strict";
function __export(m) {
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
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
exports.version = require('../package.json').version;
const common_1 = require("./utils/common");
const ui_1 = require("./utils/ui");
__export(require("./project"));
var map_1 = require("./map");
exports.map = map_1.map;
exports.filterMap = map_1.filterMap;
exports.trace = map_1.trace;
const path = require("path");
if (process.env.globalJspm !== undefined) {
    process.once('unhandledRejection', err => {
        ui_1.log('Internal Error: Unhandled promise rejection.', ui_1.LogType.err);
        ui_1.logErr(err.stack || err);
        process.exit(1);
    });
    process.once('SIGINT', () => {
        ui_1.log('jspm process terminated.');
        process.exit(1);
    });
    process.once('SIGTERM', () => {
        ui_1.log('jspm process terminated.');
        process.exit(1);
    });
}
else {
    process.on('unhandledRejection', err => {
        console.error('Internal Error: Unhandled promise rejection.');
        throw err;
    });
}
async function resolve(name, parent, env, relativeFallback) {
    const jspmResolve = require('@jspm/resolve');
    return jspmResolve(name, parent, { env, relativeFallback });
}
exports.resolve = resolve;
function resolveSync(name, parent, env, relativeFallback) {
    const jspmResolve = require('@jspm/resolve');
    return jspmResolve.sync(name, parent, { env, relativeFallback });
}
exports.resolveSync = resolveSync;
exports.JSPM_GLOBAL_PATH = path.resolve(common_1.JSPM_CONFIG_DIR, 'global');
exports.jspx = function () {
    return require('./exec').jspx.apply(this, arguments);
};
exports.execNode = function () {
    return require('./exec').execNode.apply(this, arguments);
};
//# sourceMappingURL=api.js.map