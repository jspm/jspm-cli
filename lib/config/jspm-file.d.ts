import ConfigFile from './config-file';
import { ResolveTree } from '../install/package';
export default class JspmCfg extends ConfigFile {
    installed: ResolveTree;
    constructor(configPath: any);
    dispose(): void;
    write(): boolean;
}
