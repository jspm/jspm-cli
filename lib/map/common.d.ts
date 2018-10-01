/// <reference types="node" />
export declare const hasSelf: boolean;
declare const envGlobal: Window | NodeJS.Global;
export { envGlobal as global };
export declare let baseUrl: any;
export declare function resolveIfNotPlainOrUrl(relUrl: any, parentUrl: any): any;
export declare function createPackageMap(json: any, baseUrl: any): (id: any, parentUrl: any) => any;
export declare function throwBare(id: any, parentUrl: any): void;
