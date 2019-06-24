"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/*
 *   Copyright 2014-2019 Guy Bedford (http://guybedford.com)
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
const package_json_file_1 = require("./package-json-file");
const jspm_file_1 = require("./jspm-file");
const global_config_file_1 = require("./global-config-file");
exports.globalConfig = global_config_file_1.default;
class ProjectConfig {
    constructor(projectPath, project) {
        let pjsonPath = path.resolve(projectPath, 'package.json');
        this.project = project;
        const configFile = path.resolve(path.dirname(pjsonPath), 'jspm.json');
        this.jspm = new jspm_file_1.default(configFile);
        this.pjson = new package_json_file_1.default(pjsonPath, project, this.jspm.exists());
        if (!this.jspm.exists()) {
            // check upgrade paths
        }
    }
    dispose() {
        this.pjson.dispose();
        this.jspm.dispose();
    }
    async checkCreatePrompts(force = false) {
        if (!this.pjson.exists()) {
            if (!await this.project.confirm('Package.json file does not exist, create it?', true))
                throw 'Operation aborted.';
        }
        if (!this.jspm.exists()) {
            if (!await this.project.confirm(`Configuration file %${path.relative(process.cwd(), this.pjson.configFile)}% does not exist, create it?`, true))
                throw 'Operation aborted.';
        }
        let existingJspmProject = this.pjson.exists() && this.pjson.jspmAware;
        if (!existingJspmProject || force)
            throw new Error('Init prompts yet to be implemented.');
        // await initPrompts(existingJspmProject);
    }
    save() {
        let pjsonChanged = this.pjson.write();
        let jspmChanged = this.jspm.write();
        return pjsonChanged || jspmChanged;
    }
}
exports.default = ProjectConfig;
//# sourceMappingURL=index.js.map