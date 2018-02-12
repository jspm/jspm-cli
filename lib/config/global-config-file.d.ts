import ConfigFile from './config-file';
export declare class GlobalConfig extends ConfigFile {
    constructor();
    get(configName: string | string[]): any;
    set(configName: string | string[], configValue: any[] | number | boolean | string): void;
}
declare const _default: GlobalConfig;
export default _default;
