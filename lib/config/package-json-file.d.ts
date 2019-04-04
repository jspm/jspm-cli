import ConfigFile from './config-file';
import { ProcessedPackageConfig, DepType, PackageTarget } from '../install/package';
import { Project } from '../project';
export default class PackageJson extends ConfigFile {
    private jspmPrefix;
    private depsPrefixed;
    private dir;
    private project;
    jspmAware: boolean;
    name: string;
    version: string;
    type: string;
    src: string;
    dist: string;
    main: string;
    baseURL: string;
    packages: string;
    private: boolean;
    dependencies: {
        [name: string]: {
            type: DepType;
            target: string | PackageTarget;
        };
    };
    overrides: {
        target: PackageTarget | string;
        override: ProcessedPackageConfig;
        fresh: boolean;
    }[];
    hooks: {
        [hook: string]: string;
    };
    scripts: {
        [name: string]: string;
    };
    constructor(pjsonPath: string, project: Project, hasJspmConfig: boolean);
    dispose(): void;
    setBaseURL(baseURL: string): void;
    write(): boolean;
    setPrefix(jspmPrefix: boolean): void;
    private readDependencies;
    private writeDependencies;
    private prefixedSetObject;
    private prefixedSetValue;
    private prefixedGetValue;
    private prefixedGetObject;
    private toRelativePath;
}
