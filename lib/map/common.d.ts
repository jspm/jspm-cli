export declare const hasSelf: boolean;
declare const envGlobal: Window | NodeJS.Global;
export { envGlobal as global };
export declare let baseUrl: any;
export declare function resolveIfNotPlainOrUrl(relUrl: any, parentUrl: any): any;
export declare function parseImportMap(json: any, baseUrl: any): {
    imports: {};
    scopes: {};
    baseUrl: any;
};
export declare function resolveImportMap(id: any, parentUrl: any, importMap: any): any;
export declare function throwBare(id: any, parentUrl: any): void;
