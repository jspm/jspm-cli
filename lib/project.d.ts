import { JspmUserError } from './utils/common';
import { confirm, input } from './utils/ui';
import Config from './config';
import RegistryManager, { Registry } from './install/registry-manager';
import globalConfig from './config/global-config-file';
import FetchClass from './install/fetch';
import { Install, InstallOptions, Installer } from './install';
export declare type Hook = 'preinstall' | 'postinstall';
export interface Logger {
    newline: () => void;
    msg: (msg: string) => void;
    errMsg: (err: string | Error | JspmUserError) => void;
    err: (err: string | Error | JspmUserError) => void;
    debug: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    ok: (msg: string) => void;
    taskStart: (name: string) => () => void;
    taskEnd: (name: string) => void;
}
export declare type input = typeof input;
export declare type confirm = typeof confirm;
export interface ProjectConfiguration {
    userInput?: boolean;
    cacheDir?: string;
    timeouts?: {
        resolve?: number;
        download?: number;
    };
    defaultRegistry?: string;
    offline?: boolean;
    preferOffline?: boolean;
    strictSSL?: boolean;
    registries?: {
        [name: string]: Registry;
    };
    cli?: boolean;
}
export declare class Project {
    projectPath: string;
    config: Config;
    globalConfig: typeof globalConfig;
    cli: boolean;
    defaultRegistry: string;
    log: Logger;
    confirm: typeof confirm;
    input: typeof input;
    userInput: boolean;
    offline: boolean;
    preferOffline: boolean;
    registryManager: RegistryManager;
    installer: Installer;
    fetch: FetchClass;
    cacheDir: string;
    checkedGlobalBin: boolean;
    constructor(projectPath: string, options: ProjectConfiguration);
    checkGlobalBin(): void;
    dispose(): Promise<[void, void[]]>;
    save(): Promise<boolean>;
    update(selectors: string[], opts: InstallOptions): Promise<void>;
    install(installs: Install[], opts?: InstallOptions): Promise<void>;
    uninstall(names: string[]): Promise<void>;
    checkout(names: string[]): Promise<void>;
    link(pkg: string, source: string, opts: InstallOptions): Promise<void>;
    clean(): Promise<void>;
    init(basePath: string): Promise<void>;
    registryConfig(name: string): Promise<void>;
    clearCache(): Promise<void>;
    run(name: string, args: string[]): Promise<number>;
}
export declare function runHook(project: Project, name: Hook): Promise<void>;
