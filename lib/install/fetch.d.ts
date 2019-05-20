import { Readable as ReadableStream } from 'stream';
import { AgentOptions } from 'https';
import { Project } from '../project';
export declare type HttpsProxyAgentOptions = string | ProxyAgentOptions;
export interface ProxyAgentOptions extends AgentOptions {
    host: string;
    port: number;
    secureProxy?: boolean;
    headers?: {
        [name: string]: string;
    };
}
export interface FetchOptions {
    method?: string;
    headers?: {
        [name: string]: string;
    };
    body?: void | ReadableStream;
    redirect?: 'manual' | 'error' | 'follow';
    follow?: number;
    timeout?: number;
    compress?: true;
    size?: 0;
    credentials?: Credentials | false;
    reauthorize?: boolean;
    retries?: number;
}
export interface Credentials {
    basicAuth?: {
        username: string;
        password: string;
    };
    ca?: string | string[];
    cert?: string;
    proxy?: string | HttpsProxyAgentOptions;
    strictSSL?: boolean;
    headers?: Record<string, string>;
}
export declare type Fetch = typeof FetchClass.prototype.fetch;
export declare type GetCredentials = typeof FetchClass.prototype.getCredentials;
export default class FetchClass {
    project: Project;
    cachedCredentials: {
        [urlBase: string]: Promise<Credentials>;
    };
    netrc: any;
    debugLog: (msg: string) => void;
    constructor(project: Project);
    getCredentials(url: string, method?: string, unauthorizedHeaders?: Record<string, string>): Promise<Credentials>;
    fetch(url: string, options?: FetchOptions): any;
    doFetch(url: string, options?: FetchOptions): any;
}
