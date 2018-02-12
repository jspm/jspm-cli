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
    constructor(projectPath: string, project: Project);
    dispose(): void;
    checkCreatePrompts(force?: boolean): Promise<void>;
    save(): boolean;
}
