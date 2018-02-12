"use strict";
/*
 *   Copyright 2014-2017 Guy Bedford (http://guybedford.com)
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
Object.defineProperty(exports, "__esModule", { value: true });
const node_fetch_1 = require("node-fetch");
const https_proxy_agent_1 = require("https-proxy-agent");
const https_1 = require("https");
const common_1 = require("../utils/common");
const url_1 = require("url");
const config_1 = require("../config");
const gitCredentialNode = require("git-credential-node");
;
;
;
;
const agents = [];
const proxyAgents = new Map();
const strictSSL = config_1.globalConfig.get('strictSSL') === false ? false : null;
const httpProxy = process.env.HTTP_PROXY ? process.env.HTTP_PROXY : null;
const httpsProxy = process.env.HTTPS_PROXY ? process.env.HTTPS_PROXY : null;
class FetchClass {
    constructor(project) {
        this.project = project;
        this.cachedCredentials = {};
        this.netrc = undefined;
        this.debugLog = project.log.debug.bind(project.log);
    }
    getCredentials(url, unauthorized = false) {
        this.debugLog(`Getting credentials for ${url}`);
        if (!unauthorized)
            for (const urlBase in this.cachedCredentials) {
                if (url.startsWith(urlBase))
                    return this.cachedCredentials[urlBase];
            }
        const urlObj = new url_1.URL(url);
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
            if ((await this.project.registryManager.auth(urlObj, credentials, unauthorized))) {
                this.project.log.debug(`Authentication for ${urlBase} provided by jspm registry configuration.`);
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
                this.project.log.debug(`Authentication for ${urlBase} provided by local .netrc file.`);
                credentials.basicAuth = {
                    username: creds.password ? creds.login : 'Token',
                    password: creds.password ? creds.password : creds.login
                };
                return credentials;
            }
            // and then finally using auth directly from git
            const data = await gitCredentialNode.fill(urlObj.origin);
            if (data) {
                this.project.log.debug(`Authentication for ${urlBase} provided by git credential manager.`);
                credentials.basicAuth = data;
            }
            else {
                this.project.log.debug(`No authentication details found for ${urlBase}.`);
            }
            return credentials;
        })();
    }
    async fetch(url, options) {
        if (!options || !options.retries)
            return this.doFetch(url, options);
        return common_1.retry({
            retries: options.retries,
            minTimeout: 100,
            maxTimeout: 1800,
            factor: 3
        }, async (retryNum) => {
            if (retryNum)
                this.debugLog(`Fetch of ${url} failed, retrying (attempt ${retryNum})`);
            return this.doFetch(url, options);
        });
    }
    async doFetch(url, options) {
        let requestUrl = url;
        let credentials = options.credentials;
        // we support credentials: false
        if (credentials == undefined)
            credentials = await this.getCredentials(url);
        let agent;
        if (credentials) {
            let agentOptions = {
                // test perf here
                keepAlive: false
            };
            if (credentials.ca)
                agentOptions.ca = credentials.ca;
            if (credentials.cert)
                agentOptions.cert = credentials.cert;
            if (credentials.strictSSL === false)
                agentOptions.rejectUnauthorized = false;
            if (credentials.proxy) {
                // TODO: properly support http proxy case separately?
                if (typeof credentials.proxy === 'string') {
                    const proxyURL = url_1.parse(credentials.proxy);
                    agentOptions.host = proxyURL.host;
                    agentOptions.port = parseInt(proxyURL.port);
                }
                else {
                    Object.assign(agentOptions, credentials.proxy);
                }
            }
            if (credentials.authorization) {
                const authHeader = { authorization: credentials.authorization };
                if (!options) {
                    options = { headers: authHeader };
                }
                else {
                    if (options.headers)
                        options.headers = Object.assign(authHeader, options.headers);
                    else
                        options.headers = authHeader;
                }
            }
            if (common_1.hasProperties(agentOptions)) {
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
                        existingAgents.push(agent = new https_proxy_agent_1.default(Object.assign({}, credentials.proxy)));
                    }
                    else {
                        agents.push(agent = (new https_1.Agent(agentOptions)));
                    }
                }
            }
            this.debugLog(`Fetching ${url}${writeCredentialLog(credentials)}`);
            if (credentials.basicAuth) {
                const urlObj = new url_1.URL(url);
                if (!urlObj.username && !urlObj.password) {
                    ({ username: urlObj.username, password: urlObj.password } = credentials.basicAuth);
                    requestUrl = urlObj.href;
                }
            }
        }
        else {
            this.debugLog(`Fetching ${requestUrl}`);
        }
        if (agent)
            options = Object.assign({ agent }, options);
        try {
            var res = await node_fetch_1.default(requestUrl, options);
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
            this.project.log.warn(`Invalid authorization requesting ${url}.`);
            options.reauthorize = false;
            options.credentials = await this.getCredentials(url, true);
            return this.fetch(url, options);
        }
        return res;
    }
}
exports.default = FetchClass;
function writeCredentialLog(credentials) {
    let outStr = '';
    if (typeof credentials.proxy === 'string')
        outStr += ` over proxy ${credentials.proxy}`;
    else if (credentials.proxy)
        outStr += ` over proxy ${credentials.proxy.host}`;
    if (credentials.basicAuth)
        outStr += ` with basic auth for "${credentials.basicAuth.username}", "${credentials.basicAuth.password}"`;
    else if (credentials.authorization)
        outStr += ` with authorization header`;
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
//# sourceMappingURL=fetch.js.map