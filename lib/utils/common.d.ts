export declare const HOME_DIR: string;
export declare const JSPM_LEGACY_CONFIG_DIR: string;
declare let JSPM_CONFIG_DIR: any, JSPM_CACHE_DIR: any;
export { JSPM_CONFIG_DIR, JSPM_CACHE_DIR };
export declare const isWindows: boolean;
export declare const PATH: string;
export declare const PATHS_SEP: string;
export declare const winSepRegEx: RegExp;
export declare function bold(str: string): string;
export declare function highlight(str: string): string;
export declare function underline(str: string): string;
export interface RetryOptions {
    retries?: number;
    factor?: number;
    minTimeout?: number;
    maxTimeout?: number;
    ranomize?: boolean;
}
export declare const invalidFileCharRegEx: RegExp;
export declare function encodeInvalidFileChars(str: any): any;
export declare class JspmError extends Error {
    originalErr: JspmError | Error;
    retriable: boolean;
    hideStack: boolean;
    code: string;
    constructor(msg: string, code?: string, childErr?: JspmError | Error);
}
export declare class JspmRetriableError extends JspmError {
    retriable: true;
    constructor(msg: string, code?: string, childErr?: JspmError | Error);
}
export declare class JspmUserError extends JspmError {
    hideStack: true;
    constructor(msg: string, code?: string, childErr?: JspmError | Error);
}
export declare class JspmRetriableUserError extends JspmError {
    hideStack: true;
    retriable: true;
    constructor(msg: string, code?: string, childErr?: JspmError | Error);
}
export declare function retry<T>(opts: RetryOptions, operation: (retryNumber: number) => Promise<T>, timeout?: number): Promise<T>;
export declare function readJSONSync(fileName: string): any;
export declare function toFileURL(path: string): string;
export declare function fromFileURL(url: string): string;
export declare function objEquals(objA: any, objB: any): any;
export declare function hasProperties(obj: any): boolean;
export declare function readJSON(file: string): Promise<any>;
export declare function sha256(input: string): string;
export declare function md5(input: string): string;
