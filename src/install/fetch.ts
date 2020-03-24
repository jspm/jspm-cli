/*
 *   Copyright 2014-2019 Guy Bedford (http://guybedford.com)
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */

import { Readable as ReadableStream } from 'stream';
import nodeFetch from 'node-fetch';
import HttpsProxyAgent from 'https-proxy-agent';
import { Agent as NodeAgent, AgentOptions } from 'https';
import { hasProperties, retry, bold } from '../utils/common';
import { URL, parse as parseURL } from 'url';
import { globalConfig } from '../config';
import gitCredentialNode = require('git-credential-node');
import { Project } from '../project';

// TODO: add an "http2" option to fetchOptions for http/2 support

interface Agent extends NodeAgent {
  options: AgentOptions
};

export type HttpsProxyAgentOptions = string | ProxyAgentOptions;

export interface ProxyAgentOptions extends AgentOptions {
  host: string;
  port: number;
  secureProxy?: boolean;
  headers?: {
    [name: string]: string
  };
};

const emptyCredentials = Object.freeze(Object.create(null));

export interface FetchOptions {
  // These properties are part of the Fetch Standard
  method?: string,
  headers?: {
    [name: string]: string
  },
  body?: void | ReadableStream,
  redirect?: 'manual' | 'error' | 'follow',

  // The following properties are node-fetch extensions
  follow?: number,
  // when timeout is set, retries applies 3 times automatically
  timeout?: number,
  compress?: true,
  size?: 0,
  
  // jspm-only extensions
  credentials?: Credentials | false,
  // whether to get credentials again on failure
  reauthorize?: boolean,
  // whether to retry on network failure
  retries?: number
};

export interface Credentials {
  basicAuth?: {
    username: string,
    password: string
  }
  ca?: string | string[],
  cert?: string,
  proxy?: string | HttpsProxyAgentOptions,
  strictSSL?: boolean,
  headers?: Record<string, string>
};

const agents: Agent[] = [];
const proxyAgents = new Map<HttpsProxyAgentOptions,Agent[]>();

const strictSSL = globalConfig.get('strictSSL') === false ? false : null;
const httpProxy = process.env.HTTP_PROXY ? process.env.HTTP_PROXY : null;
const httpsProxy = process.env.HTTPS_PROXY ? process.env.HTTPS_PROXY : null;

export type Fetch = typeof FetchClass.prototype.fetch;
export type GetCredentials = typeof FetchClass.prototype.getCredentials;

export default class FetchClass {
  project: Project;
  cachedCredentials: {
    [urlBase: string]: Promise<Credentials>
  };
  netrc: any;
  debugLog: (msg: string) => void;

  constructor (project: Project) {
    this.project = project;
    this.cachedCredentials = {};
    this.netrc = undefined;
    this.debugLog = project.log.debug.bind(project.log);
  }

  getCredentials (url: string, method?: string, unauthorizedHeaders?: Record<string, string>): Promise<Credentials> {
    this.debugLog(`Getting credentials for ${url}`);
    if (!unauthorizedHeaders)
      for (const urlBase in this.cachedCredentials) {
        if (url.startsWith(urlBase))
          return this.cachedCredentials[urlBase];
      }

    const urlObj = new URL(url);
    let urlBase = urlObj.origin;
    if (urlBase === 'null')
      urlBase = `${urlObj.protocol}//${urlObj.host}`;
    
    return this.cachedCredentials[urlBase] = (async () => {
      const credentials = {
        basicAuth: undefined,
        authorization: undefined,
        ca: undefined,
        cert: undefined,
        proxy: undefined,
        strictSSL: true
      };

      // support proxy environment variables and global strictSSL false configuration
      if (httpProxy !== null && urlObj.protocol === 'http:')
        credentials.proxy = httpProxy;
      else if (httpsProxy !== null && urlObj.protocol === 'https:')
        credentials.proxy = httpsProxy;
      if (strictSSL === false)
        credentials.strictSSL = false;

      // source with inline credentials takes priority
      if (urlObj.username || urlObj.password)
        return credentials;
      
      // run auth hook for jspm registries, returning if matched
      // ...for some reason TypeScript needs double brackets here...
      let credentialsRegistry;
      if (credentialsRegistry = await this.project.registryManager.auth(urlObj, method, credentials, unauthorizedHeaders)) {
        this.project.log.debug(`Credentials for ${urlBase} provided by ${bold(credentialsRegistry)} registry.`);
        return credentials;
      }

      // fallback to reading netrc
      if (this.netrc === undefined) {
        try {
          this.netrc = require('netrc')();
        }
        catch (e) {
          this.netrc = {};
        }
      }
      const hostname = urlObj.hostname;
      let creds = this.netrc[hostname];
      
      // support reading subdomain auth from top level domain
      let upperHostnameIndex = hostname.indexOf('.');
      while (!creds) {
        let nextHostnameIndex = hostname.indexOf('.', upperHostnameIndex + 1);
        if (nextHostnameIndex === -1)
          break;
        creds = this.netrc[hostname.substr(upperHostnameIndex + 1)];
        upperHostnameIndex = nextHostnameIndex;
      }

      if (creds) {
        this.project.log.debug(`Credentials for ${urlBase} provided by local .netrc file.`);
        credentials.basicAuth = {
          username: creds.password ? creds.login : 'Token',
          password: creds.password ? creds.password : creds.login
        };
        return credentials;
      }
    
      // and then finally using auth directly from git
      try {
        const data = await gitCredentialNode.fill(urlObj.origin);
        if (data) {
          this.project.log.debug(`Credentials for ${urlBase} provided by git credential manager.`);
          // for some reason, on TravisCI we get "Username: " as username and "Password: " as password
          if (data.username !== 'Username: ') {
            credentials.basicAuth = data;
            return credentials;
          }
        }
      }
      catch (e) {
        this.project.log.debug('Git credentials error: ' + e.toString());
      }
      this.project.log.debug(`No credentials details found for ${urlBase}.`);
      return emptyCredentials;
    })();
  }

  fetch (url: string, options?: FetchOptions) {
    return retry(async (retryNum) => {
      if (retryNum > 1)
        this.debugLog(`Fetch of ${url} failed, retrying (attempt ${retryNum})`);
      return this.doFetch(url, options);
    }, options && options.retries);
  }

  async doFetch (url: string, options?: FetchOptions) {
    let requestUrl = url;
    const method = options.method && options.method.toUpperCase() || 'GET';
    let credentials: Credentials;
    if (options && options.credentials)
      credentials = options.credentials;
    // we support credentials: false
    if (credentials == undefined)
      credentials = await this.getCredentials(url, method);
    let agent;
    // TODO: support keepalive
    let agentOptions: AgentOptions | HttpsProxyAgentOptions = {
      keepAlive: false
    };
    if (credentials.ca)
      agentOptions.ca = credentials.ca;
    if (credentials.cert)
      agentOptions.cert = credentials.cert;
    if (credentials.strictSSL === false)
      agentOptions.rejectUnauthorized = false;

    // TODO: properly support http proxy agent
    if (credentials.proxy && url.startsWith('http:'))
      this.debugLog(`Http proxy not supported for ${url}. Please post an issue.`);
    if (credentials.proxy && url.startsWith('https:')) {
      if (typeof credentials.proxy === 'string') {
        const proxyURL = parseURL(credentials.proxy);
        (<ProxyAgentOptions>agentOptions).host = proxyURL.host;
        (<ProxyAgentOptions>agentOptions).port = parseInt(proxyURL.port);
      }
      else {
        Object.assign(agentOptions, credentials.proxy);
      }
    }

    if (credentials.headers) {
      if (!options) {
        options = { headers: credentials.headers };
      }
      else {
        if (options.headers)
          options.headers = Object.assign({}, credentials.headers, options.headers);
        else
          options.headers = credentials.headers;
      }
    }

    if (hasProperties(agentOptions) && url.startsWith('https:')) {
      let existingAgents;
      if (credentials.proxy)
        existingAgents = proxyAgents.get(credentials.proxy);
      else
        existingAgents = agents;

      if (existingAgents)
        agent = agents.find(agent => {
          return !Object.keys(agentOptions).some(opt => agent.options[opt] !== agentOptions[opt]);
        });
      
      if (!agent) {
        if (credentials.proxy) {
          if (!existingAgents)
            proxyAgents.set(credentials.proxy, existingAgents = []);
          existingAgents.push(agent = new HttpsProxyAgent(Object.assign({}, agentOptions)));
        }
        else {
          agents.push(agent = <Agent>(new NodeAgent(agentOptions)));
        }
      }
    }
    this.debugLog(`${method} ${url}${writeCredentialLog(credentials)}`);

    if (credentials.basicAuth) {
      const urlObj = new URL(url);
      if (!urlObj.username && !urlObj.password) {
        ({ username: urlObj.username, password: urlObj.password } = credentials.basicAuth);
        requestUrl = urlObj.href;
      }
    }
    if (agent)
      options = Object.assign({ agent }, options);

    if (!options || !options.headers || !options.headers['user-agent']) {
      const headers = Object.assign({ 'user-agent': `jspm/2.0` }, options && options.headers);
      options = Object.assign({ headers }, options);
    }
    try {
      var res = await nodeFetch(requestUrl, options);
    }
    catch (err) {
      if (err.type === 'request-timeout') {
        err.retriable = true;
        err.hideStack = true;
      }
      else if (err.code) {
        switch (err.code) {
          case 'ENOTFOUND':
            if (err.toString().indexOf('getaddrinfo') === -1)
              break;
          case 'EINVAL':
          case 'ECONNRESET':
          case 'ETIMEDOUT':
          case 'ESOCKETTIMEDOUT':
            err.retriable = true;
            err.hideStack = true;
        }
      }
      throw err;
    }

    // re-authorize once if reauthorizable authorization failure
    if ((res.status === 401 || res.status === 403) && options.reauthorize !== false) {
      this.project.log.warn(`Invalid authorization for ${method} ${url}.`);
      options.reauthorize = false;
      options.credentials = await this.getCredentials(url, method, res.headers.raw());
      return this.fetch(url, options);
    }
    return res;
  }
}

function writeCredentialLog (credentials: Credentials): string {
  let outStr = '';
  if (typeof credentials.proxy === 'string')
    outStr += ` over proxy ${credentials.proxy}`;
  else if (credentials.proxy)
    outStr += ` over proxy ${credentials.proxy.host}`;
  if (credentials.basicAuth)
    outStr += ` with basic auth for "${credentials.basicAuth.username}", "${credentials.basicAuth.password}"`;
  else if (credentials.headers)
    outStr += ` with ${Object.keys(credentials.headers).join(', ')} header${Object.keys(credentials.headers).length > 1 ? 's' : ''}`;
  else
    outStr += ` without auth`;
  if (credentials.cert || credentials.ca || credentials.strictSSL === false) {
    if (credentials.strictSSL === false)
      outStr += ` (Strict SSL Disabled)`;
    else if (credentials.cert && credentials.ca)
      outStr += ` (custom ca enabled, custom cert enabled)`;
    else if (credentials.ca)
      outStr += ` (custom ca enabled)`;
    else if (credentials.cert)
      outStr += ` (custom cert enabled)`;
  }
  return outStr;
}
