export declare const version: any;
export interface JspxOptions {
    bin?: string;
    projectPath?: string;
    latest?: boolean;
    userInput?: boolean;
    offline?: boolean;
}
export declare const JSPX_PATH: string;
export declare function run(target: string, args: string[], opts: JspxOptions): Promise<number>;
export declare function ensureNodeLoaderSupport(): void;
export declare function exec(args?: any[], projectPath?: string): Promise<number>;
