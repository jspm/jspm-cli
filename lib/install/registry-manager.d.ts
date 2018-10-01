import { SemverRange } from 'sver';
import { PackageName, ExactPackage, PackageConfig, ProcessedPackageConfig } from './package';
import { JspmUserError, bold, highlight, underline } from '../utils/common';
import Cache from '../utils/cache';
import globalConfig from '../config/global-config-file';
import { Logger, input, confirm } from '../project';
import FetchClass, { Fetch, GetCredentials, Credentials } from './fetch';
export interface LookupData {
    meta: any;
    redirect?: string;
    versions?: {
        [name: string]: {
            resolved: Resolved | void;
            meta?: any;
        };
    };
}
export interface Resolved {
    version?: string;
    source?: string;
    override?: PackageConfig;
    deprecated?: string;
}
export interface SourceInfo {
    source: string;
    opts: any;
}
export interface RegistryEndpoint {
    configure?: () => Promise<void>;
    dispose: () => Promise<void>;
    auth: (url: URL, credentials: Credentials, unauthorized?: boolean) => Promise<void | boolean>;
    lookup: (pkgName: string, versionRange: SemverRange, lookup: LookupData) => Promise<void | boolean>;
    resolve?: (pkgName: string, version: string, lookup: LookupData) => Promise<void | boolean>;
}
export interface RegistryEndpointConstructable {
    new (utils: EndpointUtils, config: any): RegistryEndpoint;
}
export interface EndpointUtils {
    encodeVersion: (version: string) => string;
    JspmUserError: typeof JspmUserError;
    log: Logger;
    input: input;
    confirm: confirm;
    bold: typeof bold;
    highlight: typeof highlight;
    underline: typeof underline;
    globalConfig: typeof globalConfig;
    fetch: Fetch;
    getCredentials: GetCredentials;
}
export interface Registry {
    handler: RegistryEndpointConstructable | string;
    config: any;
}
export interface ConstructorOptions {
    cacheDir: string;
    timeouts: {
        resolve: number;
        download: number;
    };
    defaultRegistry: string;
    log: Logger;
    input: input;
    confirm: confirm;
    Cache: typeof Cache;
    userInput: boolean;
    offline: boolean;
    preferOffline: boolean;
    strictSSL: boolean;
    fetch: FetchClass;
    registries: {
        [name: string]: Registry;
    };
}
export default class RegistryManager {
    userInput: boolean;
    offline: boolean;
    preferOffline: boolean;
    timeouts: {
        resolve: number;
        download: number;
    };
    cacheDir: string;
    defaultRegistry: string;
    cache: Cache;
    verifiedCache: {
        [hash: string]: number;
    };
    endpoints: Map<string, {
        endpoint: RegistryEndpoint;
        cache: Cache;
    }>;
    util: EndpointUtils;
    instanceId: number;
    strictSSL: boolean;
    fetch: FetchClass;
    registries: {
        [name: string]: Registry;
    };
    constructor({ cacheDir, timeouts, Cache, userInput, offline, preferOffline, strictSSL, defaultRegistry, log, input, confirm, fetch, registries }: ConstructorOptions);
    loadEndpoints(): void;
    getEndpoint(name: any): {
        endpoint: RegistryEndpoint;
        cache: Cache;
    };
    dispose(): Promise<void[]>;
    configure(registryName: string): Promise<void>;
    auth(url: URL, credentials: Credentials, unauthorized?: boolean): Promise<boolean>;
    resolve(pkg: PackageName, override: ProcessedPackageConfig | void, edge?: boolean): Promise<{
        pkg: ExactPackage;
        target: PackageName;
        source: string;
        override: ProcessedPackageConfig | void;
        deprecated: string;
    }>;
    resolveSource(source: string, packagePath: string, projectPath: string): Promise<string>;
    verifyInstallDir(dir: string, verifyHash: string, fullVerification: boolean): Promise<number>;
    ensureInstall(source: string, override: ProcessedPackageConfig | void, verificationFailure: (dir: string) => Promise<boolean>, fullVerification?: boolean): Promise<{
        config: ProcessedPackageConfig;
        override: ProcessedPackageConfig | void;
        dir: string;
        hash: string;
        changed: boolean;
    }>;
}
