import { ImportMap } from '../map';
export interface BuildOptions {
    log: boolean;
    projectPath?: string;
    clearDir?: boolean;
    env?: any;
    buildDeps?: boolean;
    minify: boolean;
    sourceMap?: boolean;
    mjs?: boolean;
    dir?: string;
    format?: 'esm' | 'module' | 'cjs' | 'commonjs' | 'amd' | 'system' | 'iife' | 'umd';
    external?: string[];
    globals?: {
        [id: string]: string;
    };
    banner?: string;
    showGraph?: boolean;
    watch?: boolean;
    target?: boolean | string[];
    hashEntries?: boolean;
    mapBase?: string;
}
export declare function build(input: string[] | Record<string, string>, opts: BuildOptions): Promise<ImportMap>;
