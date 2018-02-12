import { Logger } from '../project';
import FetchClass from './fetch';
export declare const sourceProtocols: {
    [protocol: string]: {
        resolve?: (log: Logger, fetch: FetchClass, source: string, timeout: number) => Promise<string>;
        download?: (log: Logger, fetch: FetchClass, source: string, outDir: string, timeout: number) => Promise<void>;
    };
};
export declare function resolveSource(log: Logger, fetch: FetchClass, source: string, timeout: number): Promise<string>;
export declare function downloadSource(log: Logger, fetch: FetchClass, source: string, outDir: string, timeout: number): Promise<void>;
