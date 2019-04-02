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

import rimraf = require('rimraf');
import { Semver, SemverRange } from 'sver';
import fs = require('graceful-fs');
import path = require('path');
import mkdirp = require('mkdirp');
import { PackageName, ExactPackage, PackageConfig, ProcessedPackageConfig, parsePackageName,
    processPackageConfig, overridePackageConfig, serializePackageConfig } from './package';
import { readJSON, JspmError, JspmUserError, sha256, md5, encodeInvalidFileChars, bold, isWindows,
    winSepRegEx, highlight, underline, hasProperties } from '../utils/common';
import { readJSONStyled, writeJSONStyled, defaultStyle } from '../config/config-file';
import Cache from '../utils/cache';
import globalConfig from '../config/global-config-file';
import { Logger, input, confirm } from '../project';
import { resolveSource, downloadSource } from '../install/source';
import FetchClass, { Fetch, GetCredentials, Credentials } from './fetch';
import { convertCJSPackage, convertCJSConfig } from '../compile/cjs-convert';
import { runBinaryBuild } from './binary-build';
import { Readable } from 'stream';

const VerifyState = {
  NOT_INSTALLED: 0,
  INVALID: 1,
  HASH_VALID: 2,
  VERIFIED_VALID: 3
};

export interface LookupData {
  meta: any,
  redirect?: string,
  versions?: {
    [name: string]: {
      resolved: Resolved | void,
      meta?: any
    }
  }
}

export interface Resolved {
  version?: string,
  source?: string,
  override?: PackageConfig,
  deprecated?: string
}

export interface SourceInfo {
  source: string,
  opts: any
}

export interface PublishOptions {
  tag?: string;
  access?: string;
  otp?: string;
}

export interface RegistryEndpoint {
  configure?: () => Promise<void>;
  dispose: () => Promise<void>;
  auth: (url: URL, method: string, credentials: Credentials, unauthorizedHeaders?: Record<string, string>) => Promise<void | boolean>;
  lookup: (pkgName: string, versionRange: SemverRange, lookup: LookupData) => Promise<void | boolean>;
  resolve?: (pkgName: string, version: string, lookup: LookupData) => Promise<void | boolean>;
  publish?: (packagePath: string, pjson: any, tarStream: Readable, options: PublishOptions) => Promise<void>;
}

export interface RegistryEndpointConstructable {
  new(utils: EndpointUtils, config: any): RegistryEndpoint;
}

export interface EndpointUtils {
  encodeVersion: (version: string) => string;
  JspmUserError: typeof JspmUserError;
  log: Logger;
  input: input;
  confirm: confirm;
  bold: typeof bold;
  highlight: typeof highlight;
  underline: typeof underline;
  globalConfig: typeof globalConfig;
  fetch: Fetch;
  getCredentials: GetCredentials;
}

export interface Registry {
  handler: RegistryEndpointConstructable | string;
  config: any;
}

export interface ConstructorOptions {
  cacheDir: string,
  timeouts: {
    resolve: number,
    download: number
  },
  defaultRegistry: string,
  log: Logger,
  input: input,
  confirm: confirm,
  Cache: typeof Cache,
  userInput: boolean,
  offline: boolean,
  preferOffline: boolean,
  strictSSL: boolean,
  fetch: FetchClass,
  registries: {[name: string]: Registry}
}

export default class RegistryManager {
  userInput: boolean;
  offline: boolean;
  preferOffline: boolean;
  timeouts: { resolve: number, download: number };
  cacheDir: string;
  defaultRegistry: string;
  // getEndpoint: (string) => { endpoint: RegistryEndpoint, cache: Cache };
  cache: Cache;
  verifiedCache: {
    [hash: string]: number
  };
  endpoints: Map<string,{ endpoint: RegistryEndpoint, cache: Cache }>;
  util: EndpointUtils;
  instanceId: number;
  strictSSL: boolean;
  fetch: FetchClass;
  registries: {[name: string]: Registry};

  constructor ({ cacheDir, timeouts, Cache, userInput, offline, preferOffline, strictSSL, defaultRegistry, log, input, confirm, fetch, registries }: ConstructorOptions) {
    this.userInput = userInput;
    this.offline = offline;
    this.preferOffline = preferOffline;
    this.cacheDir = cacheDir;
    this.strictSSL = strictSSL;
    this.timeouts = timeouts;
    this.defaultRegistry = defaultRegistry;
    this.instanceId = Math.round(Math.random() * 10**10);
    this.registries = registries;

    this.util = {
      encodeVersion: encodeInvalidFileChars,
      JspmUserError,
      log,
      input,
      confirm,
      bold,
      highlight,
      underline,
      globalConfig,
      fetch: fetch.fetch.bind(fetch),
      getCredentials: fetch.getCredentials.bind(fetch)
    };
    this.fetch = fetch;

    // note which installs have been verified in this session
    // so we only have to perform verification once per package
    this.verifiedCache = {};
    this.endpoints = new Map<string, { endpoint: RegistryEndpoint, cache: Cache }>();
    this.cache = new Cache(path.resolve(cacheDir, 'pcfg'));
    mkdirp.sync(path.resolve(cacheDir, 'packages'));
  }

  loadEndpoints() {
    Object.keys(this.registries).forEach((registryName) => {
      if (registryName === 'jspm')
        return;
      try {
        this.getEndpoint(registryName);
      }
      catch (err) {
        if (err && err.code === 'REGISTRY_NOT_FOUND')
          this.util.log.warn(err.message.substr(err.message.indexOf('\n')).trim());
        else
          throw err;
      }
    });
  }

  getEndpoint (name) {
    let endpointEntry = this.endpoints.get(name);
    if (endpointEntry)
      return endpointEntry;

    // config returned by config get is a new object owned by us
    const registry = this.registries[name];
    const config = registry.config;
    if (config.strictSSL !== 'boolean')
      config.strictSSL = this.strictSSL;
    config.timeout = this.timeouts.resolve;
    config.userInput = this.userInput;
    config.offline = this.offline;
    config.preferOffline = this.preferOffline;

    let EndpointConstructor: RegistryEndpointConstructable;
    if (typeof registry.handler === "string") {
      try {
        EndpointConstructor = require(registry.handler) as RegistryEndpointConstructable;
      }
      catch (e) {
        if (e && e.code === 'MODULE_NOT_FOUND') {
          if (e.message && e.message.indexOf(registry.handler) !== -1) {
            this.util.log.warn(`Registry module '${registry.handler}' not found loading package ${bold(name)}.
  This may be from a previous jspm version and can be removed with ${bold(`jspm config --unset registries.${name}`)}.`);
            return;
          }
          else {
            throw new JspmError(`Error loading registry ${bold(name)} from module '${registry.handler}'.`, 'REGISTRY_LOAD_ERROR', e);
          }
        }
        else {
          throw e;
        }
      }
    } else {
      EndpointConstructor = registry.handler;
    }

    const endpoint = new EndpointConstructor(this.util, config);
    const cache = new Cache(path.resolve(this.cacheDir, 'registry_cache', name));
    endpointEntry = { endpoint, cache };
    this.endpoints.set(name, endpointEntry);
    return endpointEntry;
  }

  dispose () {
    return Promise.all(Array.from(this.endpoints.values()).map(entry => entry.endpoint.dispose ? entry.endpoint.dispose() : undefined));
  }

  async configure (registryName: string) {
    const { endpoint } = this.getEndpoint(registryName);
    if (!endpoint.configure)
      throw new JspmUserError(`The ${registryName} registry doesn't have any configuration hook.`);
    await endpoint.configure();
  }

  async auth (url: URL, method: string, credentials: Credentials, unauthorizedHeaders?: Record<string, string>): Promise<string> {
    for (let [registry, { endpoint }] of this.endpoints.entries()) {
      if (!endpoint.auth)
        continue;
      if (await endpoint.auth(url, method, credentials, unauthorizedHeaders))
        return registry;
    }
    return undefined;
  }

  async resolve (pkg: PackageName, override: ProcessedPackageConfig | void, edge = false): Promise<{
    pkg: ExactPackage,
    target: PackageName,
    source: string,
    override: ProcessedPackageConfig | void,
    deprecated: string
  }> {
    let registry = pkg.registry || this.defaultRegistry;
    let { endpoint, cache } = this.getEndpoint(registry);
    let resolveRange = new SemverRange(pkg.version || '*');

    let lookup: LookupData, resolvedVersion: string, redirect: string, resolved: Resolved;

    try {
      // loop over any redirects
      while (true) {
        lookup = await cache.getUnlocked(pkg.name, this.timeouts.resolve);

        if (resolveRange.isExact) {
          resolvedVersion = resolveRange.version.toString();
          lookup = lookup || { versions: {}, meta: {} };
        }
        else if (lookup && (this.offline || this.preferOffline)) {
          if (lookup.redirect) {
            redirect = lookup.redirect;
          }
          else {
            let versionList = Object.keys(lookup.versions);
            resolvedVersion = resolveRange.bestMatch(versionList, edge);
            if (resolvedVersion === undefined && edge === false)
              resolvedVersion = resolveRange.bestMatch(versionList, true);
            if (resolvedVersion !== undefined)
              resolvedVersion = resolvedVersion.toString();
          }
        }
        
        if (resolvedVersion === undefined && redirect === undefined) {
          // no resolution available offline
          if (this.offline)
            return;

          const unlock = await cache.lock(pkg.name, this.timeouts.resolve);
          try {
            // cache could have been written while we were getting the lock, although don't bother rechecking resolved as small benefit
            lookup = await cache.get(pkg.name) || { versions: {}, meta: {} };
          
            const logEnd = this.util.log.taskStart(`Looking up ${this.util.highlight(pkg.name)}`);
            let changed;
            try {
              changed = await endpoint.lookup(pkg.name, resolveRange, lookup);
            }
            finally {
              logEnd();
            }
            logEnd();

            if (changed && hasProperties(lookup.versions))
              cache.setUnlock(pkg.name, lookup).catch(() => {});
            else
              unlock().catch(() => {});
          }
          catch (e) {
            unlock().catch(() => {});
            throw e;
          }
        }

        if (lookup.redirect)
          redirect = lookup.redirect;

        if (redirect) {
          var redirects = redirects || [];
          redirects.push(redirect);
          if (redirects.indexOf(redirect) !== redirects.length - 1)
            throw new JspmUserError(`Circular redirect during lookup - ${redirects.join(' -> ')}.`);
  
          // loop while redirecting
          let redirectPkg = parsePackageName(redirect);
          pkg = redirectPkg;
          ({ endpoint, cache } = this.getEndpoint(registry = pkg.registry));
        }
        else {
          if (resolvedVersion === undefined) {
            const versionList = Object.keys(lookup.versions);
            resolvedVersion = resolveRange.bestMatch(versionList, edge);
            if (resolvedVersion === undefined && edge === false)
              resolvedVersion = resolveRange.bestMatch(versionList, true);
            if (resolvedVersion !== undefined)
              resolvedVersion = resolvedVersion.toString();
          }

          // 404
          if (!resolvedVersion)
            return;

          let version = lookup.versions[resolvedVersion];
          if ((this.preferOffline || this.offline) && version && version.resolved) {
            resolved = version.resolved;
          }
          else {
            if (this.offline)
              return;

            // this could result in a cache change... but it's local so we don't lock before we start
            const logEnd = this.util.log.taskStart(`Resolving ${this.util.highlight(`${pkg.name}@${resolvedVersion}`)}`);
            let changed;
            try {
              changed = await endpoint.resolve(pkg.name, resolvedVersion, lookup);
            }
            finally {
              logEnd();
            }
            if (changed) {
              version = lookup.versions[resolvedVersion];
              if (!version)
                return;
              resolved = <Resolved>version.resolved;

              // cache update individual resolve
              (async () => {
                const unlock = await cache.lock(pkg.name, this.timeouts.resolve);
                await cache.set(pkg.name, lookup);
                return unlock();
              })().catch(() => {});
            }
            else if (!version) {
              return;
            }
            else {
              resolved = <Resolved>version.resolved;
            }
            if (!resolved)
              throw new Error(`jspm registry endpoint for ${bold(registry)} did not properly resolve ${highlight(pkg.name)}.`);
          }
          break;
        }
      }
    }
    catch (e) {
      if (redirects)
        e.redirects = redirects;
      throw e;
    }

    let resolvedOverride;
    if (resolved.override) {
      resolvedOverride = processPackageConfig(resolved.override, true, override && override.registry);
      if (override)
        ({ config: override } = overridePackageConfig(resolvedOverride, override));
      else
        override = resolvedOverride;
    }

    return {
      pkg: <ExactPackage>{
        registry,
        name: pkg.name,
        version: resolved.version || resolvedVersion,
        semver: new Semver(resolvedVersion)
      },
      target: redirects ? <PackageName>{
        registry,
        name: pkg.name,
        version: pkg.version
      } : pkg,
      source: resolved.source,
      override,
      deprecated: resolved.deprecated
    };
  }

  async resolveSource (source: string, packagePath: string, projectPath: string): Promise<string> {
    if (source.startsWith('link:') || source.startsWith('file:') || source.startsWith('git+file:')) {
      let sourceProtocol = source.substr(0, source[0] === 'g' ? 9 : 5);
      let sourcePath = path.resolve(source.substr(source[0] === 'g' ? 9 : 5));
      
      // relative file path installs that are not for the top-level project are relative to their package real path
      if (packagePath !== process.cwd()) {
        if ((isWindows && (source[0] === '/' || source[0] === '\\')) ||
            sourcePath[0] === '.' && (sourcePath[1] === '/' || sourcePath[1] === '\\' || (
            sourcePath[1] === '.' && (sourcePath[2] === '/' || sourcePath[2] === '\\')))) {
          const realPackagePath = await new Promise<string>((resolve, reject) => fs.realpath(packagePath, (err, realpath) => err ? reject(err) : resolve(realpath)));
          sourcePath = path.resolve(realPackagePath, sourcePath);
        }
      }

      // if a file: install and it is a directory then it is a link: install
      if (source.startsWith('file:')) {
        try {
          const stats = fs.statSync(sourcePath);
          if (stats.isDirectory())
            sourceProtocol = 'link:';
        }
        catch (e) {
          if (e && e.code === 'ENOENT')
            throw new JspmUserError(`Path ${sourcePath} is not a valid file or directory.`);
          throw e;
        }
      }

      sourcePath = path.relative(projectPath, sourcePath) + '/';

      if (isWindows)
        sourcePath = sourcePath.replace(winSepRegEx, '/');
      
      source = sourceProtocol + sourcePath;
    }
    if (this.offline)
      return source;
    return resolveSource(this.util.log, this.fetch, source, this.timeouts.resolve);
  }

  async verifyInstallDir (dir: string, verifyHash: string, fullVerification: boolean): Promise<number> {
    const cachedState = this.verifiedCache[verifyHash];

    if (cachedState !== undefined && (cachedState !== VerifyState.HASH_VALID || !fullVerification))
      return cachedState;

    const installFile = path.resolve(dir, '.jspm');
    const jspmJson = await readJSON(installFile);

    if (!jspmJson)
      return this.verifiedCache[verifyHash] = VerifyState.NOT_INSTALLED;

    if (typeof jspmJson.mtime !== 'number' || jspmJson.hash !== verifyHash)
      return this.verifiedCache[verifyHash] = VerifyState.INVALID;

    // if not doing full verification for perf, stop here
    if (!fullVerification)
      return this.verifiedCache[verifyHash] = VerifyState.HASH_VALID;

    // mtime check (skipping .jspm file)
    let failure = false;
    await dirWalk(dir, async (filePath, stats) => {
      if (filePath === installFile)
        return;
      if (stats.mtimeMs > jspmJson.mtime) {
        failure = true;
        return true;
      }
    });

    return this.verifiedCache[verifyHash] = failure ? VerifyState.INVALID : VerifyState.VERIFIED_VALID;

    /*
    let fileHashes = await Promise.all(fileList.map(getFileHash));
    let installedDirHash = sha256(fileHashes.sort().join(''));

    // hash match -> update the mtime in the install file so we dont check next time
    if (installedDirHash === dirHash) {
      await new Promise((resolve, reject) => {
        fs.writeFile(installFile, mtime + '\n' + hash + '\n' + dirHash, err => err ? reject(err) : resolve())
      });
      return true;
    }*/
  }

  // on verification failure, we remove the directory and redownload
  // moving to a tmp location can be done during the verificationFailure call, to diff and determine route forward
  // if deciding to checkout, "ensureInstall" operation is cancelled by returning true
  // build support will be added to build into a newly prefixed folder, with build as a boolean argument
  async ensureInstall (source: string, override: ProcessedPackageConfig | void, verificationFailure: (dir: string) => Promise<boolean>, fullVerification: boolean = false): Promise<{
    config: ProcessedPackageConfig,
    override: ProcessedPackageConfig | void,
    dir: string,
    hash: string,
    changed: boolean
  }> {
    let sourceHash = sha256(source);

    var { config = undefined, hash = undefined }: { config: ProcessedPackageConfig, hash: string }
        = await this.cache.getUnlocked(sourceHash, this.timeouts.download) || {};

    if (config) {
      config = processPackageConfig(<any>config);
      if (override) {
        ({ config, override } = overridePackageConfig(config, override));
        hash = sourceHash + (override ? md5(JSON.stringify(override)) : '');
      }
      convertCJSConfig(config);
      var dir = path.join(this.cacheDir, 'packages', hash);
      const verifyState = await this.verifyInstallDir(dir, hash, fullVerification);
      if (verifyState > VerifyState.INVALID)
        return { config, override, dir, hash, changed: false };
      else if (verifyState !== VerifyState.NOT_INSTALLED && await verificationFailure(dir))
        return;
    }

    if (this.offline)
      throw new JspmUserError(`Package is not available for offline install.`);

    let unlock = await this.cache.lock(sourceHash, this.timeouts.download);
    try {
      // could have been a write while we were getting the lock
      if (!config) {
        var { config = undefined, hash = undefined }: {
          config: ProcessedPackageConfig,
          hash: string
        } = await this.cache.get(sourceHash) || {};
        if (config) {
          config = processPackageConfig(<any>config);
          if (override) {
            ({ config, override } = overridePackageConfig(config, override));
            hash = sourceHash + (override ? md5(JSON.stringify(override)) : '');
          }
          convertCJSConfig(config);
          var dir = path.join(this.cacheDir, 'packages', hash);
          const verifyState = await this.verifyInstallDir(dir, hash, fullVerification);
          if (verifyState > VerifyState.INVALID)
            return { config, override, dir, hash, changed: false };
          else if (verifyState !== VerifyState.NOT_INSTALLED && await verificationFailure(dir))
            return;
        }
      }

      // if we dont know the config then we dont know the canonical override (and hence hash)
      // so we download to a temporary folder first
      if (!config)
        dir = path.join(this.cacheDir, 'tmp', sha256(Math.random().toString()));

      await new Promise((resolve, reject) => rimraf(dir, err => err ? reject(err) : resolve()));
      await new Promise((resolve, reject) => mkdirp(dir, err => err ? reject(err) : resolve()));

      if (this.offline)
        throw new JspmUserError(`Source ${source} is not available offline.`);

      // if source is linked, can return the linked dir directly
      await downloadSource(this.util.log, this.fetch, source, dir, this.timeouts.download);

      const logEnd = this.util.log.taskStart('Finalizing ' + highlight(source));

      try {
        let pjsonPath = path.resolve(dir, 'package.json');
        let { json: pjson, style } = await readJSONStyled(pjsonPath);
        if (!pjson)
          pjson = {};

        if (!config) {
          let pjsonConfig = processPackageConfig(pjson);
          const serializedConfig = serializePackageConfig(pjsonConfig, this.defaultRegistry);
          if (override)
            ({ config, override } = overridePackageConfig(pjsonConfig, override));
          else
            config = pjsonConfig;
          convertCJSConfig(config);
          hash = sourceHash + (override ? md5(JSON.stringify(override)) : '');
          await Promise.all([
            this.cache.set(sourceHash, { config: serializedConfig, hash }),
            // move the tmp folder to the known hash now
            (async () => {
              const toDir = path.join(this.cacheDir, 'packages', hash);
              await new Promise((resolve, reject) => rimraf(toDir, err => err ? reject(err) : resolve()));
              await new Promise((resolve, reject) => {
                fs.rename(dir, dir = toDir, err => err ? reject(err) : resolve());
              });
            })()
          ]);
          pjsonPath = path.resolve(dir, 'package.json');
        }

        await writeJSONStyled(pjsonPath, Object.assign(pjson, serializePackageConfig(config)), style || defaultStyle);
        
        await runBinaryBuild(this.util.log, dir, pjson.name, pjson.scripts);

        // run package conversion
        // (on any subfolder containing a "type": "commonjs")
        await convertCJSPackage(this.util.log, dir, config.name, config, this.defaultRegistry);

        var mtime = await new Promise((resolve, reject) => fs.stat(pjsonPath, (err, stats) => err ? reject(err) : resolve(stats.mtimeMs)));
        
        // todo: diffs for invalid?
        // const fileHashes = await calculateFileHashes(dir);
        // will be useful for avoiding mistaken mtime bumps when viewing

        await new Promise((resolve, reject) => {
          fs.writeFile(path.join(dir, '.jspm'), JSON.stringify({ mtime, hash }), err => err ? reject(err) : resolve())
        });


        this.verifiedCache[hash] = VerifyState.VERIFIED_VALID;

        return { config, override, dir, hash, changed: true };
      }
      finally {
        logEnd();
      }
    }
    finally {
      unlock();
    }
  }

  async publish (packagePath: string, registry: string, pjson: any, tarStream: Readable, opts: PublishOptions) {
    const { endpoint } = this.getEndpoint(registry);

    if (!endpoint.publish)
      throw new JspmUserError(`Registry ${highlight(pjson.registry)} does not support publishing.`);
    
    const logEnd = this.util.log.taskStart(`Publishing ${this.util.highlight(`${registry}:${pjson.name}@${pjson.version}`)}`);
    try {
      await endpoint.publish(packagePath, pjson, tarStream, opts);
    }
    finally {
      logEnd();
    }
  }
}

function dirWalk (dir: string, visit: (filePath: string, stats, files?: string[]) => void | boolean | Promise<void | boolean>) {
  return new Promise((resolve, reject) => {
    let errored = false;
    let cnt = 0;
    visitFileOrDir(path.resolve(dir));
    function handleError (err) {
      if (!errored) {
        errored = true;
        reject(err);
      }
    }
    function visitFileOrDir (fileOrDir) {
      cnt++;
      fs.stat(fileOrDir, async (err, stats) => {
        if (err || errored)
          return handleError(err);
        try {
          if (await visit(fileOrDir, stats))
            return resolve();
        }
        catch (err) {
          return handleError(err);
        }
        if (stats.isDirectory()) {
          fs.readdir(fileOrDir, (err, paths) => {
            if (err || errored)
              return handleError(err);
            cnt--;
            if (paths.length === 0 && !errored && cnt === 0)
              return resolve();
            paths.forEach(fileOrDirPath => visitFileOrDir(path.resolve(fileOrDir, fileOrDirPath)));
          });
        }
        else if (!errored && --cnt === 0) {
          resolve();
        }
      });
    }
  });
}