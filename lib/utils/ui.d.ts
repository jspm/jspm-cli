export declare enum LogType {
    none = 0,
    err = 1,
    warn = 2,
    ok = 3,
    info = 4,
    debug = 5,
    status = 6
}
export declare let logLevel: LogType;
export declare let useDefaults: boolean;
export declare function setUseDefaults(_useDefaults: boolean): void;
export declare function setLogLevel(level: LogType): void;
export declare function startSpinner(): void;
export declare function stopSpinner(): void;
export declare function logErr(msg: string): void;
export declare function ok(msg: string): void;
export declare function err(msg: string): void;
export declare function warn(msg: string): void;
export declare function debug(msg: string): void;
export declare function info(msg: string): void;
export declare function log(msg: string, type?: LogType): void;
export interface ConfirmOptions {
    edit?: boolean;
    info?: string;
    silent?: boolean;
}
export declare function confirm(msg: string, def?: string | ConfirmOptions | boolean, options?: ConfirmOptions): Promise<boolean>;
export interface InputOptions extends ConfirmOptions {
    options?: string[];
    clearOnType?: boolean;
    hideInfo?: boolean;
    completer?: (partialLine: string) => [string[], string];
    validate?: (input: string) => string | void;
    validationError?: string;
    optionalOptions?: boolean;
}
export declare function input(msg: string, def: string | InputOptions, options?: InputOptions, queue?: boolean): Promise<string>;
