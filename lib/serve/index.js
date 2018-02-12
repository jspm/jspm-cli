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
const path = require("path");
const fs = require("graceful-fs");
const mime = require("mime/lite");
const global_config_file_1 = require("../config/global-config-file");
const ui_1 = require("../utils/ui");
const common_1 = require("../utils/common");
exports.serverRunning = false;
;
async function serve(opts) {
    // highly immoral HTTP/2 module emitWarning avoidance
    let http2;
    try {
        const emitWarning = process.emitWarning;
        process.emitWarning = () => { };
        http2 = require('http2');
        process.emitWarning = emitWarning;
    }
    catch (err) {
        throw new common_1.JspmUserError(`jspm server requires NodeJS 8.9.0 or greater with HTTP/2 support.`);
    }
    let key, cert;
    if (opts.generateCert !== true) {
        key = global_config_file_1.default.get('server.key');
        cert = global_config_file_1.default.get('server.cert');
        if (key && cert) {
            try {
                key = fs.readFileSync(key);
                cert = fs.readFileSync(cert);
            }
            catch (e) { }
        }
    }
    if (!key || !cert) {
        await new Promise(resolve => setTimeout(resolve, 100));
        ui_1.info(`jspm will now generate a local Certificate Authority in order to support a local HTTP/2 server.`);
        await ui_1.input('Please confirm the authorization prompts.', 'Ok', {});
        console.log('');
        let ca;
        const getDevelopmentCertificate = require('devcert-sanscache');
        ({ key, cert, ca } = await getDevelopmentCertificate('jspm'));
        ui_1.ok(`Certificate generated successfully.`);
        if (opts.generateCert !== true)
            ui_1.info(`To regenerate a new certificate, run ${common_1.bold('jspm ds -g')}.`);
        const keyPath = path.join(common_1.JSPM_CONFIG_DIR, 'server.key');
        const certPath = path.join(common_1.JSPM_CONFIG_DIR, 'server.crt');
        const caPath = path.join(common_1.JSPM_CONFIG_DIR, 'server.ca');
        fs.writeFileSync(keyPath, key);
        fs.writeFileSync(certPath, cert);
        fs.writeFileSync(caPath, ca);
        global_config_file_1.default.set('server.key', keyPath);
        global_config_file_1.default.set('server.cert', certPath);
        global_config_file_1.default.set('server.ca', caPath);
    }
    const FileTransformCache = require('./file-transform').default;
    const fileCache = new FileTransformCache(opts.publicDir || process.cwd(), opts.filePollInterval || 2000, opts.maxWatchCount || 2000, opts.production || false);
    const port = opts.port || 5776;
    const server = http2.createSecureServer({ key, cert });
    const publicDir = opts.publicDir ? path.resolve(opts.publicDir) : process.cwd();
    const browserBuiltinsDir = path.resolve(require.resolve('jspm-resolve'), '../node-browser-builtins');
    let prompting = false;
    const serverProcess = new Promise((resolve, reject) => {
        server.on('error', reject);
        server.on('socketError', reject);
        server.on('close', resolve);
    });
    server.on('stream', async (stream, headers) => {
        let resolvedPath;
        try {
            if (headers[':method'] !== 'GET') {
                stream.respond({ ':status': 400 });
                stream.end();
                return;
            }
            let requestName = headers[':path'].substr(1), dew = false, sourceMap = false, cjs = false, raw = false;
            try {
                let queryParamIndex = requestName.indexOf('?');
                if (queryParamIndex !== -1) {
                    let queryParam = requestName.substr(queryParamIndex + 1);
                    switch (queryParam) {
                        case 'dew':
                            dew = true;
                            break;
                        case 'dewmap':
                            dew = true;
                            sourceMap = true;
                            break;
                        case 'map':
                            sourceMap = true;
                            break;
                        case 'raw':
                            raw = true;
                            break;
                        case 'cjs':
                            cjs = true;
                            break;
                        default:
                            throw `Invalid query parameter "${queryParam}".`;
                    }
                    requestName = decodeURIComponent(requestName.substr(0, queryParamIndex));
                }
                else {
                    requestName = decodeURIComponent(requestName);
                }
            }
            catch (e) {
                stream.respond({ ':status': 400, 'Access-Control-Allow-Origin': '*' });
                stream.end(typeof e === 'string' ? e : 'Invalid request.');
                return;
            }
            if (cjs) {
                stream.respond({
                    ':status': 200,
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/javascript',
                    'Cache-Control': 'immutable',
                });
                stream.end(`import { __dew__, exports } from "./${path.basename(requestName)}?dew";
if (__dew__) __dew__();
export default exports;
`);
                return;
            }
            if (requestName === '@empty') {
                stream.respond({
                    ':status': 200,
                    'Cache-Control': `max-age=31536000, public, immutable`,
                    'Content-Type': 'application/javascript'
                });
                stream.end(!dew ? '' : 'export var exports = {};\nexport var __dew__;');
                return;
            }
            if (requestName.startsWith('@node/'))
                resolvedPath = path.resolve(browserBuiltinsDir, requestName.substr(6));
            else
                resolvedPath = path.resolve(publicDir, requestName);
            const curEtag = headers['if-none-match'];
            const ext = path.extname(resolvedPath);
            const doModuleTransform = ext === '.js' || ext === '.mjs' || dew;
            if (raw === true && doModuleTransform === false) {
                const e = new Error('Invalid transform');
                e.code = 'ENOTRANSFORM';
                throw e;
            }
            // JS module transforms
            if (raw === false && doModuleTransform === true) {
                const result = await fileCache.get(resolvedPath + (dew ? '?dew' : ''), curEtag);
                // we don't transform JS that isn't ESM
                if (result) {
                    let source, etag, isGlobalCache;
                    if (sourceMap)
                        ({ sourceMap: source, hash: etag, isGlobalCache } = result);
                    else
                        ({ source, hash: etag, isGlobalCache } = result);
                    if (curEtag !== undefined && etag === curEtag) {
                        stream.respond({ ':status': 304 });
                        stream.end();
                        return;
                    }
                    if (!sourceMap && requestName.endsWith('.json') === false)
                        source += `\n//# sourceMappingURL=${path.basename(requestName)}${dew ? '?dewmap' : '?map'}`;
                    stream.respond({
                        ':status': 200,
                        'Access-Control-Allow-Origin': '*',
                        'Content-Type': 'application/javascript',
                        'Cache-Control': isGlobalCache ? 'max-age=600' : 'must-revalidate',
                        'ETag': etag
                    });
                    stream.end(source);
                    return;
                }
            }
            if (dew === true || sourceMap === true) {
                const e = new Error('Invalid transform');
                e.code = 'ENOTRANSFORM';
                throw e;
            }
            // resource or directory serving
            let mtimeStr, isDir;
            try {
                const stats = await new Promise((resolve, reject) => fs.stat(resolvedPath, (err, stats) => err ? reject(err) : resolve(stats)));
                isDir = stats.isDirectory();
                mtimeStr = stats.mtimeMs.toString();
            }
            catch (err) {
                if (err && err.code === 'ENOENT')
                    err.code = 'ENOTFOUND';
                throw err;
            }
            if (curEtag !== undefined && curEtag === mtimeStr) {
                stream.respond({ ':status': 304 });
                stream.end();
                return;
            }
            // directory listing
            if (isDir) {
                const renderDir = require('./ecstatic-show-dir').default;
                const dirIndex = await renderDir(resolvedPath, publicDir);
                stream.respond({
                    ':status': 200,
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'text/html',
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                });
                stream.end(dirIndex);
                return;
            }
            // resource serving
            const fileStream = fs.createReadStream(resolvedPath);
            stream.respond({
                ':status': 200,
                'Access-Control-Allow-Origin': '*',
                'Content-Type': mime.getType(path.extname(resolvedPath)),
                'Cache-Control': (await fileCache.isGlobalCache(resolvedPath)) ? 'max-age=600' : 'must-revalidate',
                'ETag': mtimeStr
            });
            fileStream.pipe(stream);
            await new Promise((resolve, reject) => fileStream.on('close', resolve).on('error', reject));
        }
        catch (err) {
            if (prompting) {
                console.log('');
                prompting = false;
            }
            try {
                if (typeof err === 'string') {
                    console.error(`[400] Invalid request: ${err}`);
                    stream.respond({ ':status': 400, 'Access-Control-Allow-Origin': '*' });
                    stream.end(err);
                    return;
                }
                switch (err && err.code) {
                    case 'MODULE_NOT_FOUND':
                        console.error(`[400] Dependency not found: ${err}`);
                        stream.respond({ ':status': 400, 'Access-Control-Allow-Origin': '*' });
                        stream.end('Unable to resolve dependency.');
                        return;
                    case 'ENOTFOUND':
                        console.error(`[404] Not found: ${resolvedPath}`);
                        stream.respond({ ':status': 404, 'Access-Control-Allow-Origin': '*' });
                        stream.end('Path not found.');
                        return;
                    case 'ENOTRANSFORM':
                        console.error(`[400] No transform: ${headers[':path'].substr(1)}`);
                        stream.respond({ ':status': 400, 'Access-Control-Allow-Origin': '*' });
                        stream.end('Invalid transform query for this file.');
                        return;
                    case 'ETRANSFORM':
                        console.error(`[500] Transform error: ${err}`);
                        stream.respond({ ':status': 400, 'Access-Control-Allow-Origin': '*' });
                        stream.end('Transform error.');
                        return;
                    case 'ERR_HTTP2_INVALID_STREAM':
                        // these can happen on server restart, no need to report
                        // could possibly provide in debug mode only
                        return;
                    default:
                        console.error('[500] Internal error: ' + err.stack);
                        stream.respond({ ':status': 500, 'Access-Control-Allow-Origin': '*' });
                        stream.end('Internal error.');
                }
            }
            catch (err) {
                if (err && err.code === 'ERR_HTTP@_INVALID_STREAM')
                    return;
                console.error(err);
            }
        }
    });
    server.listen(port);
    ui_1.info(`Serving ${path.relative(process.cwd(), publicDir) || './'} on https://localhost:${port}`);
    exports.serverRunning = true;
    checkPjsonEsm(publicDir).catch(() => { });
    if (opts.open) {
        let indexExists = false;
        try {
            const stats = fs.statSync(path.resolve(publicDir, 'index.html'));
            indexExists = stats.isFile();
        }
        catch (err) {
            indexExists = false;
        }
        require('opn')(`https://localhost:${port}/${indexExists ? 'index.html' : ''}`);
    }
    return {
        close() {
            server.close();
            fileCache.dispose();
            exports.serverRunning = false;
        },
        process: serverProcess
    };
    async function checkPjsonEsm(projectPath) {
        // for the given project path, find the first package.json and ensure it has "esm": true
        // if it does not, then warn, and correct
        let hasEsm = false;
        let pjsonPath = projectPath;
        if (!pjsonPath.endsWith(path.sep))
            pjsonPath += path.sep;
        do {
            try {
                var source = fs.readFileSync(pjsonPath + 'package.json').toString();
            }
            catch (err) {
                if (!err || err.code !== 'ENOENT')
                    throw err;
            }
            if (source) {
                try {
                    var pjson = JSON.parse(source);
                }
                catch (err) {
                    return;
                }
                if (typeof pjson.mode === 'string')
                    hasEsm = true;
                break;
            }
            pjsonPath = pjsonPath.substr(0, pjsonPath.lastIndexOf(path.sep, pjsonPath.length - 2) + 1);
        } while (pjsonPath && source === undefined);
        if (hasEsm === false) {
            prompting = true;
            ui_1.warn(`To load JavaScript modules from ".js" extensions, add a ${common_1.bold(`"mode": "esm"`)} property to the package.json file.`);
            if (await ui_1.confirm(`Would you like to add this property to your package.json file automatically now?`, true)) {
                prompting = false;
                ;
                const pjson = JSON.parse(fs.readFileSync(pjsonPath + 'package.json').toString());
                pjson.mode = 'esm';
                fs.writeFileSync(pjsonPath + 'package.json', JSON.stringify(pjson, null, 2));
                ui_1.ok(`${common_1.bold(`"esm": true`)} property added to ${common_1.highlight(`${projectPath}${path.sep}package.json`)}.`);
            }
            else {
                prompting = false;
                ui_1.info(`package.json unaltered.`);
            }
        }
    }
}
exports.serve = serve;
//# sourceMappingURL=index.js.map