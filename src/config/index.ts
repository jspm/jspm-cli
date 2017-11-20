import path = require('path');
import PackageJsonFile from './package-json-file';
import JspmFile from './jspm-file';
import { default as globalConfig } from './global-config-file';
export { globalConfig };
import { Project } from '../project';

export default class ProjectConfig {
  pjson: PackageJsonFile;
  jspm: JspmFile;
  defaultRegistry: string;
  project: Project;

  constructor (projectPath: string, project: Project) {
    let pjsonPath = path.resolve(projectPath, 'package.json');

    this.project = project;
    this.pjson = new PackageJsonFile(pjsonPath, project);
    this.jspm = new JspmFile(this.pjson.configFile, project);

    if (!this.jspm.exists()) {
      // check upgrade paths
    }
  }

  dispose () {
    this.pjson.dispose();
    this.jspm.dispose();
  }

  async checkCreatePrompts (force = false) {
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

  save () {
    let pjsonChanged = this.pjson.write();
    let jspmChanged = this.jspm.write();
    return pjsonChanged || jspmChanged;
  }
}