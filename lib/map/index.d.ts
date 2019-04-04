import { Project } from "../project";
export interface Packages {
    [name: string]: string;
}
export interface Scopes {
    [path: string]: Packages;
}
export interface ImportMap {
    imports?: Packages;
    scopes?: Scopes;
}
export declare function renormalizeMap(map: ImportMap, jspmPackagesURL: string, cdn: boolean): ImportMap;
export declare function map(project: Project, env: any): Promise<ImportMap>;
export declare function filterMap(project: Project, map: ImportMap, modules: string[], flatScope?: boolean): Promise<ImportMap>;
export declare function trace(project: Project, map: ImportMap, baseDir: string, modules: string[], excludeDeps?: boolean): Promise<Record<string, Record<string, string>>>;
