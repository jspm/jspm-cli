"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const package_json_file_1 = require("./package-json-file");
const jspm_file_1 = require("./jspm-file");
const global_config_file_1 = require("./global-config-file");
exports.globalConfig = global_config_file_1.default;
class ProjectConfig {
    constructor(projectPath, project) {
        let pjsonPath = path.resolve(projectPath, 'package.json');
        this.project = project;
        this.pjson = new package_json_file_1.default(pjsonPath, project);
        this.jspm = new jspm_file_1.default(this.pjson.configFile);
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