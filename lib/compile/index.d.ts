export interface BuildOptions {
    log: boolean;
    projectPath?: string;
    clearDir?: boolean;
    env?: any;
    sourceMaps?: boolean;
    out?: string;
    dir?: 'string';
    format?: 'esm' | 'es6' | 'es' | 'cjs' | 'amd' | 'global' | 'system' | 'iife' | 'umd';
    external?: {
        [name: string]: string | true;
    } | string[];
    globals?: {
        [id: string]: string;
    };
    banner?: string;
    showGraph?: boolean;
    watch?: boolean;
    target?: boolean | string[];
}
export declare function compile(input: string | string[], opts: BuildOptions): Promise<void>;
