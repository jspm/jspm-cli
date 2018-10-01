import { PackageMap } from ".";
export { createPackageMap, resolveIfNotPlainOrUrl } from './common';
export declare function extend(packageMap: PackageMap, extendMap: PackageMap): void;
export declare function getMatch(path: any, matchObj: any): any;
export declare function clean(packageMap: PackageMap): void;
