export declare const version: any;
export * from './project';
export { map, filterMap, trace } from './map';
import { execNode as execFunc, jspx as jspxFunc } from './exec';
export declare function resolve(name: string, parent?: string, env?: any, relativeFallback?: boolean): Promise<any>;
export declare function resolveSync(name: string, parent?: string, env?: any, relativeFallback?: boolean): any;
export declare const JSPM_GLOBAL_PATH: string;
export declare const jspx: typeof jspxFunc;
export declare const execNode: typeof execFunc;
