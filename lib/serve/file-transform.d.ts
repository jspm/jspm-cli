export interface ResolveMap {
    [name: string]: string;
}
export default class FileTransformCache {
    private maxWatchCount;
    private production;
    private records;
    private publicDir;
    private watching;
    private workers;
    private transformQueue;
    private resolveCache;
    private resolveEnv;
    private nextExpiry;
    private cacheInterval;
    private cacheClearInterval;
    constructor(publicDir: string, cacheClearInterval: number, maxWatchCount: number, production: boolean);
    clearResolveCache(): void;
    dispose(): void;
    resolve(name: string, parentPath: string, cjsResolve?: boolean): Promise<any>;
    private format(filePath, cjsResolve?);
    get(recordPath: string, hash?: string | void): Promise<{
        source: string;
        sourceMap: string;
        hash: string;
        isGlobalCache: boolean;
    }>;
    isGlobalCache(filePath: string): Promise<boolean>;
    private doHash(record);
    private doTransform(record, resolveMap, worker);
    private assignWorker(record);
    private freeWorker(worker);
    private getResolveMap(record);
    private getMtime(path);
    private watch(record);
}
