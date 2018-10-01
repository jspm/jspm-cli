import { ProcessedPackageConfig } from '../install/package';
export declare function relativeResolve(require: string, filePath: string, pkgBasePath: string, files: Record<string, boolean>, folderMains: Record<string, string>, deps: Record<string, boolean>): string;
export declare function resolveFile(name: string, files: Record<string, boolean>): string;
export declare function resolveDir(name: string, files: Record<string, boolean>, folderMains: Record<string, string>): string;
export declare function toDewPlain(path: string, deps: Record<string, boolean>): string;
export declare function toDew(path: string): string;
export declare function pcfgToDeps(pcfg: ProcessedPackageConfig): Record<string, boolean>;
export declare function isESM(resolved: string): any;
