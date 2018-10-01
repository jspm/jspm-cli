import { ProcessedPackageConfig } from './package';
import { Logger } from '../project';
export declare function convertCJSConfig(pcfg: ProcessedPackageConfig): void;
export declare function convertCJSPackage(log: Logger, dir: string, pkgName: string, pcfg: ProcessedPackageConfig): Promise<void>;
export declare function listAllFiles(dir: string): Promise<string[]>;
