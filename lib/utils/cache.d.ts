export default class Cache {
    private basePath;
    constructor(basePath: any);
    get(cachePath: string): Promise<any>;
    set(cachePath: string, value: any): Promise<void>;
    setUnlock(cachePath: string, value: any): Promise<void>;
    del(cachePath: string): Promise<void>;
    lock(cachePath: string, timeout?: number): Promise<() => Promise<void>>;
    getUnlocked(cachePath: any, timeout?: number): Promise<any>;
    getOrCreate<T>(path: string, timeout: number, createTask: () => Promise<T>): Promise<T>;
}
