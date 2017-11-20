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

// NB split this out into a separate "dew-transform-cluster" package
// with ability to enable / disable the cache checking
// then it can be used by rollup-plugin-jspm for example

import fs = require('graceful-fs');
import { md5, isWindows, winSepRegEx } from '../utils/common';
import childProcess = require('child_process');
import path = require('path');
import jspmResolve = require('jspm-resolve');
import resolveBuiltin = require('node-browser-builtins');
import crypto = require('crypto');

interface FileTransformRecord {
  path: string;
  hashPromise: Promise<{ resolveMap: ResolveMap, worker: TransformWorker | void }> | void;
  transformPromise: Promise<void> | void;
  mtime: number | void;
  isGlobalCache: boolean;
  checkTime: number | void;
  originalSource: string | void;
  originalSourceHash: string | void;
  deps: string[] | void;
  dew: boolean;
  fullHash: string | void;
  source: string | void;
  sourceMap: string | void;
  watching: boolean;
}

interface CodeError extends Error {
  code?: string;
}

interface ResolveMap {
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
    [path: string]: Promise<string|FileTransformRecord|void>
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
  private cacheInterval: NodeJS.Timer;

  constructor (publicDir: string, resolveCacheClearInterval: number, maxWatchCount: number, production: boolean) {
    if (publicDir[publicDir.length - 1] !== path.sep)
      publicDir += path.sep;
    publicDir = publicDir.replace(winSepRegEx, '/');
    this.publicDir = publicDir;
    this.maxWatchCount = maxWatchCount;
    this.production = production;
    this.watching = [];
    this.workers = [];
    this.transformQueue = [];
    this.nextExpiry = Date.now() + resolveCacheClearInterval;
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
    this.cacheInterval = setInterval(() => {
      this.resolveCache = {};
      this.nextExpiry = Date.now() + resolveCacheClearInterval;
    }, resolveCacheClearInterval);

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
          console.log('worker error ' + this.workers.indexOf(worker));
          const e = new Error(data);
          (e as { code?: string }).code = 'ETRANSFORM';
          worker.msgReject(e);
        }
        else {
          worker.msgResolve(data);
        }
      });
    }
  }

  dispose () {
    clearTimeout(this.cacheInterval);
    for (let watch of this.watching)
      watch.watcher.close();
  }

  private format (filePath: string, cjsResolve = false) {
    return jspmResolve.format(filePath, { cache: this.resolveCache, cjsResolve });
  }

  // throws ENOTFOUND for not found
  // throws ENOTRANSFORM if an invalid dew transform
  // throws ETRANSFORM for a transform error
  // returns correct wrappers for dew cases
  async get (filePath: string, dew: boolean, sourceMap: boolean, etag?: string): Promise<{ source: string, etag: string | void, isGlobalCache: boolean }> {
    const dewSuffix = (dew || sourceMap ? '?' : '') + (dew ? 'dew' : '') + (sourceMap ? 'map' : '');
    let record = await this.records[filePath + dewSuffix];

    if (!record)
      record = await (this.records[filePath + dewSuffix] = (async () => {
        const sourcePromise = new Promise<string>((resolve, reject) => fs.readFile(filePath, (err, source) => err ? reject(err) : resolve(source.toString())));
        sourcePromise.catch(() => {});

        const formatPromise = this.format(filePath, dew);
        formatPromise.catch(() => {});

        const format = await formatPromise;

        if (!sourceMap) {
          if (dew) {
            if (format !== 'cjs' && format !== 'json') {
              const e: CodeError = new Error(`No dew transform for ${format} format.`);
              e.code = 'ENOTRANSFORM';
              throw e;
            }
          }
          else {
            switch (format) {
              case 'cjs':
                return `import { exports, __dew__ } from "./${path.basename(filePath)}?dew"; if (__dew__) __dew__(); export { exports as default };`;
              case 'esm':
              break;
              case 'json':
                return `export { exports as default } from "./${path.basename(filePath)}?dew";`;
              default:
                throw new Error(`Unable to transform module format ${format || 'unknown'}.`);
            }
          }
        }

        const record: FileTransformRecord = {
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
        this.watch(record);

        try {
          record.originalSource = await sourcePromise;
        }
        catch (err) {
          if (err && err.code === 'ENOENT')
            err.code = 'ENOTFOUND';
          throw err;
        }
        return record;
      })());

    if (typeof record !== 'object')
      return { source: record, etag: '2.0', isGlobalCache: false };

    if (record.hashPromise === undefined) {
      // in-progress transform
      if (record.transformPromise !== undefined) {
        if (etag && record.fullHash === etag)
          return { source: undefined, etag, isGlobalCache: record.isGlobalCache };
        else
          await record.transformPromise;
      }
      // done and waiting -> check freshness
      else {
        // check source freshness (updating deps if source changed)
        if (record.checkTime < this.nextExpiry) {
          if (record.watching === false) {
            this.records[filePath + dewSuffix] = (async () => {
              const mtime = await this.getMtime(record.path);
              if (mtime !== record.mtime) {
                try {
                  record.originalSource = await new Promise<string>((resolve, reject) => fs.readFile(filePath, (err, source) => err ? reject(err) : resolve(source.toString())));
                  record.mtime = mtime;
                }
                catch (err) {
                  if (err && err.code === 'ENOENT')
                    return;
                  throw err;
                }
              }
              return record;
            })();
          }
        }
        const { resolveMap, worker } = await this.doHash(record);
        if (etag && record.fullHash === etag) {
          if (worker)
            this.freeWorker(worker);
          return { source: undefined, etag, isGlobalCache: record.isGlobalCache };
        }
        await this.doTransform(record, resolveMap, worker);
      }
    }
    // already a hash promise -> wait on it
    else {
      // worker doesnt belong to us here
      const { resolveMap } = await <Promise<{ resolveMap: ResolveMap }>>record.hashPromise;
      if (etag && record.fullHash === etag)
        return { source: undefined, etag, isGlobalCache: record.isGlobalCache };
      
      if (record.transformPromise !== undefined)
        await record.transformPromise;
      else
        await this.doTransform(record, resolveMap, undefined);
    }

    if (sourceMap) {
      if (!record.sourceMap) {
        const e: CodeError = new Error('No source map for this transform.');
        e.code = 'ENOTRANSFORM';
        throw e;
      }
      return { source: record.sourceMap, etag: record.fullHash, isGlobalCache: record.isGlobalCache };
    }
    return { source: <string>record.source, etag: record.fullHash, isGlobalCache: record.isGlobalCache };
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
        if (record.path.endsWith('.json')) {
          record.hashPromise = undefined;
          record.fullHash = '2.0';
          return {
            resolveMap: undefined,
            worker: undefined
          };
        }

        const sourceHash = md5(<string>record.originalSource);

        // get deps
        let worker: TransformWorker;
        if (record.originalSourceHash !== sourceHash) {
          record.originalSourceHash = sourceHash;
          worker = await this.assignWorker(record);
          record.deps = await new Promise<string[]>((resolve, reject) => {
            worker.msgResolve = resolve;
            worker.msgReject = reject;
            worker.process.send({ type: record.dew ? 'deps-cjs' : 'deps-esm', data: record.dew === false });
          });
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
        record.hashPromise = undefined;
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

      if (!worker)
        worker = await this.assignWorker(record);

      try {
        ({ source: record.source, sourceMap: record.sourceMap } = await new Promise<{ source: string, sourceMap: string }>((resolve, reject) => {
          (<TransformWorker>worker).msgResolve = resolve;
          (<TransformWorker>worker).msgReject = reject;
          (<TransformWorker>worker).process.send({ type: record.dew ? 'transform-dew' : 'transform-esm', data: resolveMap });
        }));

        this.freeWorker(worker);
        record.isGlobalCache = await isGlobalCachePromise;
      }
      finally {
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
      let { resolved, format } = await jspmResolve(dep[dep.length - 1] === '/' ? dep.substr(0, dep.length - 1) : dep, record.path, {
        cache: this.resolveCache,
        env: this.resolveEnv,
        cjsResolve: record.dew
      });
      if (format === undefined) {
        // bad!
      }
      if (format === 'builtin') {
        resolved = resolveBuiltin(resolved);
        if (resolved === '@empty')
          resolved = undefined;
      }
      // @empty maps to resolved undefined
      if (resolved === undefined) {
        resolveMap[dep] = null;
        hash.update(dep);
        hash.update('@empty');
        continue;
      }
      let relResolved = path.relative(base, resolved);
      if (isWindows)
        relResolved = relResolved.replace(winSepRegEx, '/');
      if (!relResolved.startsWith('../'))
        relResolved = './' + relResolved;
      if (!resolved.startsWith(this.publicDir)) {
        const e = new Error(`Path ${path.relative(this.publicDir, record.path).replace(winSepRegEx, '/')} has a dependency ${relResolved} outside of the public directory.`);
        (e as { code?: string }).code = 'ETRANSFORM';
        throw e;
      }
      if (record.dew)
        relResolved += '?dew';
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
    await new Promise<number>((resolve, reject) => {
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

    watcher.on('change', async type => {
      // trigger refresh
      if (type === 'change') {
        const source = await new Promise<string>((resolve, reject) => fs.readFile(record.path, (err, source) => err ? reject(err) : resolve(source.toString())));
        record.originalSource = source;
        const hash = record.fullHash;
        if (record.transformPromise || record.hashPromise)
          await record.transformPromise || record.hashPromise;
        const { resolveMap, worker } = await this.doHash(record);
        if (hash !== record.fullHash)
          this.doTransform(record, resolveMap, worker).catch(() => {});
        else if (worker)
          this.freeWorker(worker);
      }
      else if (type === 'rename') {
        record.watching = false;
        record.checkTime = Date.now();
      }
    });
  }
}