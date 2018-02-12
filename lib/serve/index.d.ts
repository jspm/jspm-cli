export declare let serverRunning: boolean;
export interface ServerOptions {
    port: number;
    env: any;
    open: boolean;
    generateCert: boolean;
    publicDir: string;
    maxWatchCount: number;
    shardFilter: (requestName: string) => boolean;
    filePollInterval: number;
    production: boolean;
}
export declare function serve(opts: ServerOptions): Promise<{
    close(): void;
    process: Promise<{}>;
}>;
