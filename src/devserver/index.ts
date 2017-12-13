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

import path = require('path');
import { Stats } from 'fs';
import fs = require('graceful-fs');
import mime = require('mime/lite');
import globalConfig from '../config/global-config-file';
import { input, info, warn, ok, confirm } from '../utils/ui';
import FileTransformCache from './file-transform';

import { JSPM_CONFIG_DIR, bold, highlight, JspmUserError } from '../utils/common';

export let devServerRunning = false;

export interface DevserverOptions {
  port: number;
  env: any;
  open: boolean;
  generateCert: boolean;
  publicDir: string;
  maxWatchCount: number;
  shardFilter: (requestName: string) => boolean;
  filePollInterval: number;
  production: boolean;
};

export async function devserver (opts: DevserverOptions) {
  // highly immoral HTTP/2 module emitWarning avoidance
  let http2;
  try {
    const emitWarning = process.emitWarning;
    process.emitWarning = () => {};
    http2 = require('http2');
    process.emitWarning = emitWarning;
  }
  catch (err) {
    throw new JspmUserError(`jspm devserver requires NodeJS 8.9.0 or greater with HTTP/2 support.`);
  }

  let key, cert;
  if (opts.generateCert !== true) {
    key = globalConfig.get('server.key');
    cert = globalConfig.get('server.cert');
    if (key && cert) {
      try {
        key = fs.readFileSync(key);
        cert = fs.readFileSync(cert);
      }
      catch (e) {}
    }
  }
  if (!key || !cert) {
    await new Promise(resolve => setTimeout(resolve, 100));
    info(`jspm will now generate a local Certificate Authority in order to support a local HTTP/2 server.`);
    await input('Please confirm the authorization prompts.', 'Ok', {
      //silent: true
    });
    console.log('');
    let ca;
    const getDevelopmentCertificate = require('devcert-sanscache');
    ({ key, cert, ca } = await getDevelopmentCertificate('jspm'));
    ok(`Certificate generated successfully.`)
    if (opts.generateCert !== true)
      info(`To regenerate a new certificate, run ${bold('jspm ds -g')}.`);
    const keyPath = path.join(JSPM_CONFIG_DIR, 'server.key');
    const certPath = path.join(JSPM_CONFIG_DIR, 'server.crt');
    const caPath = path.join(JSPM_CONFIG_DIR, 'server.ca');
    fs.writeFileSync(keyPath, key);
    fs.writeFileSync(certPath, cert);
    fs.writeFileSync(caPath, ca);
    globalConfig.set('server.key', keyPath);
    globalConfig.set('server.cert', certPath);
    globalConfig.set('server.ca', caPath);
  }

  const FileTransformCache = require('./file-transform').default;
  const fileCache: FileTransformCache = new FileTransformCache(opts.publicDir || process.cwd(), opts.filePollInterval || 2000, opts.maxWatchCount || 2000, opts.production || false);

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
        (e as { code?: string }).code = 'ENOTRANSFORM';
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
        (e as { code?: string }).code = 'ENOTRANSFORM';
        throw e;
      }
      
      // resource or directory serving
      let mtimeStr: string, isDir: boolean;
      try {
        const stats = await new Promise<Stats>((resolve, reject) => fs.stat(resolvedPath, (err, stats) => err ? reject(err) : resolve(stats)));
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
  info(`Serving ${path.relative(process.cwd(), publicDir) || './'} on https://localhost:${port}`);
  devServerRunning = true;

  checkPjsonEsm(publicDir).catch(() => {});

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
    close () {
      server.close();
      fileCache.dispose();
      devServerRunning = false;
    },
    process: serverProcess
  };

  async function checkPjsonEsm (projectPath: string) {
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
        if (typeof pjson.esm === 'boolean')
          hasEsm = true;
        break;
      }
      pjsonPath = pjsonPath.substr(0, pjsonPath.lastIndexOf(path.sep, pjsonPath.length - 2) + 1);
    }
    while (pjsonPath && source === undefined)
  
    if (hasEsm === false) {
      prompting = true;
      warn(`To load JavaScript modules from ".js" extensions, add an ${bold(`"esm": true`)} property to the package.json file.`);
      if (await confirm(`Would you like to add this property to your package.json file automatically now?`, true)) {
        prompting = false;;
        const pjson = JSON.parse(fs.readFileSync(pjsonPath + 'package.json').toString());
        pjson.esm = true;
        fs.writeFileSync(pjsonPath + 'package.json', JSON.stringify(pjson, null, 2));
        ok(`${bold(`"esm": true`)} property added to ${highlight(`${projectPath}${path.sep}package.json`)}.`);
      }
      else {
        prompting = false;
        info(`package.json unaltered.`);
      }
    }
  }
}