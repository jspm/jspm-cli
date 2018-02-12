import { Semver, SemverRange } from 'sver';
declare const processPjsonConfig: any;
export { processPjsonConfig };
export interface PackageName {
    registry: string;
    name: string;
    version: string;
}
export declare const resourceInstallRegEx: RegExp;
export declare function parsePackageName(name: string): PackageName;
export declare function parseExactPackageName(name: string): ExactPackage;
export declare function serializePackageName(pkg: PackageName | string): string;
export declare function packageNameEq(pkgA: PackageName | string, pkgB: PackageName | string): boolean;
export interface ExactPackage extends PackageName {
    semver: Semver;
}
export declare class PackageTarget {
    registry: string;
    name: string;
    version: string;
    range: SemverRange;
    constructor(registry: string, name: string, version: string);
    fromRegistry(registry: string): PackageTarget;
    fromVersion(version: string): PackageTarget;
    eq(target: PackageTarget): boolean;
    has(pkg: ExactPackage): any;
    contains(target: PackageTarget): any;
    intersect(target: PackageTarget): any;
    toString(): string;
}
export interface ResolveRecord {
    source: string;
    resolve: {
        [name: string]: ExactPackage;
    };
}
export declare class ResolveTree {
    resolve: {
        [name: string]: ExactPackage;
    };
    dependencies: {
        [packageName: string]: ResolveRecord;
    };
    constructor(resolve?: {}, dependencies?: {});
    serialize(): {
        resolve: {};
        dependencies: {};
    };
    createResolveRecord(resolution: string): ResolveRecord;
    getResolution({name, parent}: {
        name: string;
        parent: string | void;
    }): ExactPackage;
    getBestMatch(target: PackageTarget, edge?: boolean): ExactPackage;
    select(selector: string): {
        name: string;
        parent: string | void;
    }[];
    visit(visitor: (pkg: ExactPackage, name: string, parent?: string) => void | boolean): boolean;
    visitAsync(visitor: (pkg: ExactPackage, name: string, parent?: string) => Promise<void | boolean>): Promise<boolean>;
}
export interface Conditional {
    [condition: string]: string | Conditional;
}
export interface MapConfig {
    [name: string]: string | Conditional;
}
export interface ProcessedPackageConfig {
    registry?: string;
    name?: string;
    version?: string;
    mode?: string;
    mains?: Conditional;
    map?: MapConfig;
    bin?: {
        [name: string]: string;
    };
    dependencies?: {
        [name: string]: PackageTarget | string;
    };
    peerDependencies?: {
        [name: string]: PackageTarget | string;
    };
    optionalDependencies?: {
        [name: string]: PackageTarget | string;
    };
}
export interface PackageConfig {
    registry?: string;
    name?: string;
    version?: string;
    mode?: string;
    mains?: Conditional;
    map?: MapConfig;
    bin?: string | {
        [name: string]: string;
    };
    dependencies?: {
        [name: string]: string;
    };
    peerDependencies?: {
        [name: string]: string;
    };
    optionalDependencies?: {
        [name: string]: string;
    };
    main?: string;
    module?: boolean | string;
    'react-native'?: string;
    electron?: string;
    browser?: string | {
        [name: string]: string | boolean;
    };
}
export declare function serializePackageTargetCanonical(name: string, target: PackageTarget | string, defaultRegistry?: string): string;
export declare function processPackageConfig(pcfg: PackageConfig, rangeConversion?: boolean): ProcessedPackageConfig;
export declare function processPackageTarget(depName: string, depTarget: string, defaultRegistry?: string, rangeConversion?: boolean): string | PackageTarget;
export declare function serializePackageConfig(pcfg: ProcessedPackageConfig, defaultRegistry?: string): PackageConfig;
export declare function overridePackageConfig(pcfg: ProcessedPackageConfig, overridePcfg: ProcessedPackageConfig): {
    config: ProcessedPackageConfig;
    override: ProcessedPackageConfig | void;
};
export declare function sha256(input: string): string;
export declare enum DepType {
    primary = 0,
    dev = 1,
    peer = 2,
    optional = 3,
    secondary = 4,
}
export interface DepMap {
    [name: string]: string | PackageTarget;
}
export interface Dependencies {
    dependencies?: DepMap;
    devDependencies?: DepMap;
    peerDependencies?: DepMap;
    optionalDependencies?: DepMap;
}
