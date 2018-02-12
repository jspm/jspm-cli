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
    esm: boolean;
    src: string;
    dist: string;
    main: string;
    baseURL: string;
    packages: string;
    configFile: string;
    dependencies: {
        [name: string]: {
            type: DepType;
            target: string | PackageTarget;
        };
    };
    overrides: {
        target: PackageTarget | string;
        override: ProcessedPackageConfig;
    }[];
    hooks: {
        [hook: string]: string;
    };
    scripts: {
        [name: string]: string;
    };
    constructor(pjsonPath: string, project: Project);
    dispose(): void;
    setBaseURL(baseURL: string): void;
    write(): boolean;
    setPrefix(jspmPrefix: boolean): void;
    private readDependencies(depName);
    private writeDependencies(depName, value);
    private prefixedSetObject(memberArray, object, clearIfEmpty?);
    private prefixedSetValue(memberArray, value, defaultValue?);
    private prefixedGetValue(memberArray, type?);
    private prefixedGetObject(memberArray, nested?);
    private toRelativePath(absPath);
}
