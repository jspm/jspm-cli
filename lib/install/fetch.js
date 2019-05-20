"use strict";
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
const emptyCredentials = Object.freeze(Object.create(null));
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
    getCredentials(url, method, unauthorizedHeaders) {
        this.debugLog(`Getting credentials for ${url}`);
        if (!unauthorizedHeaders)
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
            let credentialsRegistry;
            if (credentialsRegistry = await this.project.registryManager.auth(urlObj, method, credentials, unauthorizedHeaders)) {
                this.project.log.debug(`Credentials for ${urlBase} provided by ${common_1.bold(credentialsRegistry)} registry.`);
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
    fetch(url, options) {
        return common_1.retry(async (retryNum) => {
            if (retryNum > 1)
                this.debugLog(`Fetch of ${url} failed, retrying (attempt ${retryNum})`);
            return this.doFetch(url, options);
        }, options && options.retries);
    }
    async doFetch(url, options) {
        let requestUrl = url;
        const method = options.method && options.method.toUpperCase() || 'GET';
        let credentials;
        if (options && options.credentials)
            credentials = options.credentials;
        // we support credentials: false
        if (credentials == undefined)
            credentials = await this.getCredentials(url, method);
        let agent;
        // TODO: support keepalive
        let agentOptions = {
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
                const proxyURL = url_1.parse(credentials.proxy);
                agentOptions.host = proxyURL.host;
                agentOptions.port = parseInt(proxyURL.port);
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
        if (common_1.hasProperties(agentOptions) && url.startsWith('https:')) {
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
        this.debugLog(`${method} ${url}${writeCredentialLog(credentials)}`);
        if (credentials.basicAuth) {
            const urlObj = new url_1.URL(url);
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
exports.default = FetchClass;
function writeCredentialLog(credentials) {
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
//# sourceMappingURL=fetch.js.map