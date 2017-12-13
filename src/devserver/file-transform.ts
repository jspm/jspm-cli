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
import fs = require('graceful-fs');
import { md5, isWindows, winSepRegEx, hasProperties } from '../utils/common';
import childProcess = require('child_process');
import path = require('path');
import jspmResolve = require('jspm-resolve');
import crypto = require('crypto');

const noop = () => {};

interface FileTransformRecord {
  path: string;
  loadPromise: Promise<boolean>;
  hashPromise: Promise<{ resolveMap: ResolveMap, worker: TransformWorker | void }>;
  transformPromise: Promise<void>;
  mtime: number;
  isGlobalCache: boolean;
  checkTime: number;
  originalSource: string;
  originalSourceHash: string;
  deps: string[];
  dew: boolean;
  fullHash: string;
  source: string;
  sourceMap: string;
  watching: boolean;
}

export interface ResolveMap {
  [name: string]: string
};

interface TransformWorker {
  record: FileTransformRecord | void;
  process: childProcess.ChildProcess;
  msgResolve: (any) => void;
  msgReject: (err) => void;
}

export default class FileTransformCache {
  private maxWatchCount: number;
  private production: boolean;
  private records: {
    [path: string]: FileTransformRecord
  };
  private publicDir: string;
  private watching: {
    record: FileTransformRecord;
    watcher: fs.FSWatcher;
  }[];
  private workers: TransformWorker[];
  private transformQueue: ((TransformWorker) => void)[];
  private resolveCache: any;
  private resolveEnv: any;
  private nextExpiry: number;
  private cacheInterval: NodeJS.Timer | void;
  private cacheClearInterval: number;

  constructor (publicDir: string, cacheClearInterval: number, maxWatchCount: number, production: boolean) {
    if (publicDir[publicDir.length - 1] !== path.sep)
      publicDir += path.sep;
    publicDir = publicDir.replace(winSepRegEx, '/');
    this.publicDir = publicDir;
    this.maxWatchCount = maxWatchCount;
    this.production = production;
    this.watching = [];
    this.workers = [];
    this.transformQueue = [];
    this.nextExpiry = Date.now() + cacheClearInterval;
    this.resolveCache = {
      jspmConfigCache: {},
      pjsonConfigCache: {},
      isFileCache: {},
      isDirCache: {}
    };
    this.resolveEnv = {
      production,
      browser: true
    };
    this.records = {};

    // instead of watching or polling which can be tricky with
    // the number of files touched by the resolver, we instead
    // just clear the resolver cache every ~500ms, then hash
    // resolutions as a transform cache input
    this.cacheClearInterval = cacheClearInterval;
    if (cacheClearInterval > 0)
      this.cacheInterval = setInterval(<typeof FileTransformCache.prototype.clearResolveCache>this.clearResolveCache.bind(this), cacheClearInterval);

    const workerCnt = require('os').cpus().length;
    for (let i = 0; i < workerCnt; i++) {
      const worker: TransformWorker = {
        record: undefined,
        process: childProcess.fork(path.join(__dirname, 'dew-transform-worker')),
        msgResolve: undefined,
        msgReject: undefined
      };
      this.workers.push(worker);
      worker.process.on('message', ({ type, data }) => {
        if (type === 'error') {
          const e = new Error(`Processing ${(<FileTransformRecord>worker.record).path}:\n${data}`);
          (e as { code?: string }).code = 'ETRANSFORM';
          worker.msgReject(e);
        }
        else if (type === 'syntax-error') {
          const codeFrameColumns = require('@babel/code-frame').codeFrameColumns;
          const errOutput = `Error parsing ${(<FileTransformRecord>worker.record).path}:\n${data.msg}\n` + codeFrameColumns((<FileTransformRecord>worker.record).originalSource, { start: data.loc }, {});
          worker.msgReject(errOutput);
        }
        else {
          worker.msgResolve(data);
        }
      });
    }
  }

  clearResolveCache () {
    this.resolveCache = {};
    this.nextExpiry = Date.now() + this.cacheClearInterval;
  }

  dispose () {
    if (this.cacheInterval)
      clearTimeout(this.cacheInterval);
    for (let watch of this.watching)
      watch.watcher.close();
  }

  async resolve (name: string, parentPath: string, cjsResolve = false) {
    const { resolved } = await jspmResolve(name[name.length - 1] === '/' ? name.substr(0, name.length - 1) : name, parentPath, {
      cache: this.resolveCache,
      env: this.resolveEnv,
      cjsResolve
    });
    return resolved;
  }

  private format (filePath: string, cjsResolve = false) {
    return jspmResolve.format(filePath, { cache: this.resolveCache, cjsResolve });
  }

  // throws ENOTFOUND for not found
  // throws ENOTRANSFORM if an invalid dew transform
  // throws ETRANSFORM for a transform error
  // returns correct wrappers for dew cases
  async get (recordPath: string, hash?: string | void): Promise<{ source: string, sourceMap: string, hash: string, isGlobalCache: boolean }> {
    const dew = recordPath.endsWith('?dew');
    const filePath = dew ? recordPath.substr(0, recordPath.length - 4) : recordPath;
    let record: FileTransformRecord = await this.records[recordPath];

    if (record === undefined)
      record = this.records[recordPath] = {
        loadPromise: undefined,
        path: filePath,
        hashPromise: undefined,
        transformPromise: undefined,
        mtime: undefined,
        isGlobalCache: false,
        checkTime: Date.now(),
        originalSource: undefined,
        originalSourceHash: undefined,
        deps: undefined,
        fullHash: undefined,
        dew,
        source: undefined,
        sourceMap: undefined,
        watching: false
      };
    
    if (record.loadPromise === undefined || record.watching === false && record.checkTime < this.nextExpiry)
      record.loadPromise = (async () => {
        const formatPromise = this.format(filePath, dew);
        formatPromise.catch(noop);

        const sourcePromise = new Promise<string>((resolve, reject) => fs.readFile(filePath, (err, source) => err ? reject(err) : resolve(source.toString())));
        sourcePromise.catch(noop);

        const mtimePromise = this.getMtime(record.path);
        mtimePromise.catch(noop);

        const format = await formatPromise;

        if (dew) {
          if (format !== 'cjs' && format !== 'json') {
            const e = new Error(`No dew transform for ${format} format.`);
            (<{ code?: string }>e).code = 'ENOTRANSFORM';
            throw e;
          }
        }
        else if (format !== 'esm') {
          return false;
        }

        record.mtime = await mtimePromise;
  
        if (!record.watching && record.mtime !== -1)
          this.watch(record);
  
        try {
          record.originalSource = await sourcePromise;
        }
        catch (err) {
          if (err && err.code === 'ENOENT')
            err.code = 'ENOTFOUND';
          throw err;
        }

        record.hashPromise = undefined;

        return true;
      })();
    
    if (await record.loadPromise === false)
      return;

    if (record.hashPromise === undefined) {
      const prevHash = record.fullHash;
      const { resolveMap, worker } = await this.doHash(record);
      if (record.fullHash !== prevHash)
        record.transformPromise = undefined;
      if (hash && record.fullHash === hash) {
        if (worker)
          this.freeWorker(worker);
        return { source: undefined, sourceMap: undefined, hash, isGlobalCache: record.isGlobalCache };
      }
      await this.doTransform(record, resolveMap, worker);
    }
    // already a hash promise -> wait on it
    else {
      // worker doesnt belong to us here
      const { resolveMap } = await <Promise<{ resolveMap: ResolveMap }>>record.hashPromise;
      if (hash && record.fullHash === hash)
        return { source: undefined, sourceMap: undefined, hash, isGlobalCache: record.isGlobalCache };
      
      if (record.transformPromise !== undefined)
        await record.transformPromise;
      else
        await this.doTransform(record, resolveMap, undefined);
    }

    return { source: <string>record.source, sourceMap: <string>record.sourceMap, hash: <string>record.fullHash, isGlobalCache: record.isGlobalCache };
  }

  async isGlobalCache (filePath: string): Promise<boolean> {
    const packagePath = await jspmResolve.packagePath(filePath, { cache: this.resolveCache });
    if (packagePath === undefined)
      return false;
    return new Promise<boolean>(resolve => fs.readlink(packagePath, err => resolve(err === null)));
  }

  private doHash (record: FileTransformRecord): Promise<{ resolveMap: ResolveMap, worker: TransformWorker | void }> {
    if (record.hashPromise)
      return record.hashPromise;

    return record.hashPromise = (async () => {
      try {
        const sourceHash = md5(<string>record.originalSource);

        if (record.path.endsWith('.json')) {
          record.hashPromise = undefined;
          record.fullHash = sourceHash;
          return {
            resolveMap: undefined,
            worker: undefined
          };
        }

        // get deps
        let worker: TransformWorker;
        if (record.originalSourceHash !== sourceHash) {
          record.originalSourceHash = sourceHash;
          worker = await this.assignWorker(record);
          try {
            const { deps } = await new Promise<{
              deps: string[]
            }>((resolve, reject) => {
              worker.msgResolve = resolve;
              worker.msgReject = reject;
              worker.process.send({ type: record.dew ? 'analyze-cjs' : 'analyze-esm', data: false });
            });
            record.deps = deps;
          }
          catch (err) {
            this.freeWorker(worker);
            throw err;
          }
        }

        // get resolveMap
        const { map: resolveMap, hash: resolveMapHash } = await this.getResolveMap(record);

        record.fullHash = sourceHash + resolveMapHash;
        return {
          resolveMap,
          worker
        };
      }
      finally {
        setTimeout(() => {
          record.hashPromise = undefined;
        }, this.cacheClearInterval);
      }
    })();
  }

  private doTransform (record: FileTransformRecord, resolveMap: ResolveMap, worker: TransformWorker | void): Promise<void> {
    if (record.transformPromise)
      return record.transformPromise;
    
    return record.transformPromise = (async () => {
      const isGlobalCachePromise = this.isGlobalCache(record.path);
      isGlobalCachePromise.catch(() => {});

      if (record.path.endsWith('.json')) {
        record.source = `export var __dew__ = null; export var exports = ${record.originalSource}`;
        record.isGlobalCache = await isGlobalCachePromise;
        // we leave transformPromise in place as there is no invalidation apart from just the source
        return;
      }

      // esm with no deps -> no need to transform
      if (record.dew === false && hasProperties(resolveMap) === false) {
        record.source = record.originalSource;
        record.isGlobalCache = await isGlobalCachePromise;
        if (worker)
          this.freeWorker(worker);
        return;
      }

      if (!worker)
        worker = await this.assignWorker(record);

      try {
        ({ source: record.source, sourceMap: record.sourceMap } = await new Promise<{ source: string, sourceMap: string }>((resolve, reject) => {
          (<TransformWorker>worker).msgResolve = resolve;
          (<TransformWorker>worker).msgReject = reject;
          (<TransformWorker>worker).process.send({ type: record.dew ? 'transform-dew' : 'transform-esm', data: resolveMap });
        }));
        
        record.isGlobalCache = await isGlobalCachePromise;
      }
      finally {
        this.freeWorker(worker);
        record.transformPromise = undefined;
      }
    })();
  }

  private async assignWorker (record: FileTransformRecord): Promise<TransformWorker> {
    // find a free worker and give it the transform
    let worker;
    for (let _worker of this.workers) {
      if (_worker.record === undefined) {
        worker = _worker;
        break;
      }
    }

    // no free worker found -> add to job queue
    if (worker)
      worker.record = record;
    else
      worker = await new Promise<TransformWorker>(resolve => this.transformQueue.push(worker => {
        worker.record = record;
        resolve(worker);
      }));
    
    worker.process.send({
      type: 'source', 
      data: {
        source: record.originalSource,
        filename: path.basename(record.path),
        production: this.production
      }
    });
    await new Promise((resolve, reject) => {
      worker.msgResolve = resolve;
      worker.msgReject = reject;
    });

    return worker;
  }

  private freeWorker (worker: TransformWorker) {
    worker.record = undefined;
    worker.msgReject = undefined;
    worker.msgResolve = undefined;

    if (this.transformQueue.length === 0)
      return;
    
    const resolveNextJob = this.transformQueue.shift();
    resolveNextJob(worker);
  }

  private async getResolveMap (record: FileTransformRecord): Promise<{ map: ResolveMap, hash: string }> {
    const base = path.dirname(record.path);
    const resolveMap = {};
    const hash = crypto.createHash('md5');
    for (let dep of <string[]>record.deps) {
      let resolved, format;
      try {
        ({ resolved, format } = await jspmResolve(dep[dep.length - 1] === '/' ? dep.substr(0, dep.length - 1) : dep, record.path, {
          cache: this.resolveCache,
          env: this.resolveEnv,
          cjsResolve: record.dew,
          browserBuiltins: false
        }));
      }
      catch (err) {
        // external URLs
        if (err && err.code === 'INVALID_MODULE_NAME') {
          resolveMap[dep] = dep;
          hash.update(dep);
          hash.update(dep);
          continue;
        }
        else {
          throw err;
        }
      }
      if (format === 'builtin') {
        if (nodeCoreBrowserUnimplemented.indexOf(resolved) !== -1) {
          resolved = undefined;
        }
        else {
          hash.update(dep);
          hash.update(resolveMap[dep] = record.dew ? `/@node/${resolved}.js?dew` : `/@node/${resolved}.js?cjs`);
          continue;
        }
      }
      // @empty maps to resolved undefined
      if (resolved === undefined) {
        resolveMap[dep] = '/@empty' + (record.dew ? '?dew' : '?cjs');
        hash.update(dep);
        hash.update('@empty');
        continue;
      }
      let relResolved = path.relative(base, resolved);
      if (isWindows)
        relResolved = relResolved.replace(winSepRegEx, '/');
      if (!relResolved.startsWith('../'))
        relResolved = './' + relResolved;
      if (record.path.startsWith(this.publicDir) && !resolved.startsWith(this.publicDir)) {
        const e = new Error(`Path ${path.relative(this.publicDir, record.path).replace(winSepRegEx, '/')} has a dependency ${relResolved} outside of the public directory.`);
        (e as { code?: string }).code = 'ETRANSFORM';
        throw e;
      }
      if (record.dew)
        relResolved += '?dew';
      else if (format === 'cjs' || format === 'json')
        relResolved += '?cjs';
      if (dep !== relResolved)
        resolveMap[dep] = relResolved;
      hash.update(dep);
      hash.update(resolved);
    }
    return {
      map: resolveMap,
      hash: hash.digest('hex')
    };
  }

  private async getMtime (path: string) {
    return await new Promise<number>((resolve, reject) => {
      fs.stat(path, (err, stats) => {
        if (err && (err.code === 'ENOENT' || err.code === 'EACCES'))
          resolve(-1);
        else if (err)
          reject(err)
        else
          resolve(stats.mtimeMs);
      });
    });
  }

  private watch (record: FileTransformRecord) {
    // at full watch count shift to mtime checking
    if (this.watching.length === this.maxWatchCount) {
      record.watching = false;
      this.getMtime(record.path).then(mtime => record.mtime = mtime);
      return;
    }

    const watcher = fs.watch(record.path);
    this.watching.push({ record, watcher });
    record.watching = true;

    watcher.on('change', type => {
      if (type === 'rename') {
        record.watching = false;
        record.checkTime = Date.now();
      }
      else if (type === 'change') {
        (async () => {
          const lastLoadPromise = record.loadPromise;
          await record.loadPromise;
          // debouncing
          await new Promise(resolve => setTimeout(resolve, 10));
          // beaten to reload -> our job has been done for us
          if (record.loadPromise !== lastLoadPromise)
            return;
          record.loadPromise = undefined;
          return this.get(record.path + (record.dew ? '?dew' : ''), record.fullHash);
        })().catch(noop);
      }
    });
  }
}

const nodeCoreBrowserUnimplemented = ['child_process', 'cluster', 'dgram', 'dns', 'fs', 'module', 'net', 'readline', 'repl', 'tls'];