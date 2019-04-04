import { ProcessedPackageConfig } from '../install/package';
import { Logger } from '../project';
export declare function init(): void;
export declare function dispose(): Promise<void>;
export declare function convertCJSConfig(pcfg: ProcessedPackageConfig): void;
export declare function convertCJSPackage(log: Logger, dir: string, pkgName: string, pcfg: ProcessedPackageConfig, defaultRegistry: string): Promise<void>;
export declare function listAllFiles(dir: string): Promise<string[]>;
