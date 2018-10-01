import { ProcessedPackageConfig } from '../install/package';
export declare function relativeResolve(require: string, filePath: string, pkgBasePath: string, files: Record<string, boolean>, main: string, folderMains: Record<string, string>, localMaps: Record<string, boolean>, deps: Record<string, boolean>, name: string): string;
export declare function resolveFile(name: string, files: Record<string, boolean>): string;
export declare function resolveDir(name: string, files: Record<string, boolean>, folderMains: Record<string, string>): string;
export declare function toDewPlain(path: string): string;
export declare function toDew(path: string): string;
export declare function pcfgToDeps(pcfg: ProcessedPackageConfig, optional?: boolean): Record<string, boolean>;
export declare function isESM(resolved: string, deps?: Record<string, boolean>): boolean;
export declare function getMatch(path: string, matchObj: Record<string, any>): string;
