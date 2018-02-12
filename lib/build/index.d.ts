export interface BuildOptions {
    log: boolean;
    projectPath?: string;
    removeDir?: boolean;
    env?: any;
    sourcemap?: boolean;
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
export declare function build(input: string | string[], opts: BuildOptions): Promise<void>;
