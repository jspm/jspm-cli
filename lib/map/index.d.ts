import { Project } from "../project";
export interface Packages {
    [name: string]: string | {
        path?: string;
        main?: string;
    };
}
export interface Scopes {
    [path: string]: {
        packages: Packages;
    };
}
export interface PackageMap {
    packages: Packages;
    scopes: Scopes;
}
export declare function map(project: Project, baseDir: string, env: any): Promise<PackageMap>;
export declare function filterMap(project: Project, map: PackageMap, baseDir: string, modules: string[]): Promise<PackageMap>;
export declare function trace(project: Project, map: PackageMap, baseDir: string, modules: string[]): Promise<Record<string, Record<string, string>>>;
