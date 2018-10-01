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
const common_1 = require("../utils/common");
const config_file_1 = require("./config-file");
const mkdirp = require("mkdirp");
const defaultGlobalConfig = {
    defaultRegistry: 'npm',
    registries: {
        github: {},
        npm: {}
    }
};
class GlobalConfig extends config_file_1.default {
    constructor() {
        super(path.resolve(common_1.JSPM_CONFIG_DIR, 'config'), [
            'defaultRegistry',
            'strictSSL',
            ['timeouts', [
                    'download',
                    'lookup'
                ]],
            ['registries', [
                    ['github', [
                            'auth',
                            'remote',
                            'maxRepoSize'
                        ]],
                    ['npm', []]
                ]]
        ]);
        this.read();
        // set global config defaults
        if (!this.exists()) {
            mkdirp.sync(common_1.JSPM_CONFIG_DIR);
            this.lock();
            // treat legacy jspm configuration file as defaults on first run only
            // thus creating a global configuration upgrade path
            try {
                const legacyGlobalConfig = common_1.readJSONSync(path.join(common_1.JSPM_LEGACY_CONFIG_DIR, 'config'));
                if (legacyGlobalConfig)
                    this.prependObject(legacyGlobalConfig);
            }
            catch (e) { }
            this.prependObject(defaultGlobalConfig);
            this.write();
            this.unlock();
        }
    }
    get(configName) {
        if (typeof configName === 'string')
            configName = configName.split('.');
        try {
            return this.getValue(configName);
        }
        catch (e) {
            return this.getObject(configName);
        }
    }
    set(configName, configValue) {
        if (typeof configName === 'string')
            configName = configName.split('.');
        this.lock();
        this.read();
        if (configValue !== undefined)
            this.setValue(configName, configValue);
        else
            this.remove(configName);
        this.write();
        this.unlock();
    }
}
exports.GlobalConfig = GlobalConfig;
exports.default = new GlobalConfig();
//# sourceMappingURL=global-config-file.js.map