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

import * as path from 'path';
import fs = require('graceful-fs');
import lockfile = require('proper-lockfile');
import { readJSON, JspmError } from './common';
import promiseRetry = require('promise-retry');
import mkdirp = require('mkdirp');

/*
 * multi-process fs caching with lock file
 * with in-memory single-process cache and lock queue
 */
export default class Cache {
  private basePath: string;

  constructor (basePath) {
    this.basePath = path.resolve(basePath);
    mkdirp.sync(this.basePath);
  }
  get (cachePath: string) {
    const resolved = path.resolve(this.basePath, cachePath);
    return readJSON(resolved).catch(_err => {
      // gracefully handle corruptions
    });
  }
  async set (cachePath: string, value: any) {
    const resolved = path.resolve(this.basePath, cachePath);
    if (path.relative(this.basePath, resolved).indexOf(path.sep) !== -1)
      await new Promise((resolve, reject) => mkdirp(path.dirname(resolved), err => err ? reject(err) : resolve()));
    await new Promise((resolve, reject) => fs.writeFile(resolved, JSON.stringify(value), err => err ? reject(err) : resolve()));
  }
  async setUnlock (cachePath: string, value: any) {
    const resolved = path.resolve(this.basePath, cachePath);
    if (path.relative(this.basePath, resolved).indexOf(path.sep) !== -1)
      await new Promise((resolve, reject) => mkdirp(path.dirname(resolved), err => err ? reject(err) : resolve()));
    await new Promise((resolve, reject) => fs.writeFile(resolved, JSON.stringify(value), err => err ? reject(err) : resolve()));
    await lockfile.unlock(resolved, {
      realpath: false
    });
  }
  async del (cachePath: string) {
    const resolved = path.resolve(this.basePath, cachePath);
    await new Promise((resolve, reject) => fs.unlink(resolved, err => err ? reject(err) : resolve()));
  }
  async lock (cachePath: string, timeout = 3000): Promise<() => Promise<void>> {
    const resolved = path.resolve(this.basePath, cachePath);
    await new Promise((resolve, reject) => mkdirp(path.dirname(resolved), err => err ? reject(err) : resolve()));
    const unlock = await lockfile.lock(resolved, {
      stale: 30000,
      // exponential backoff of 5 checks from 200ms up to 3s
      // followed by a constant timeout check of 3 seconds
      // to an absolute maximum of the given timeout
      realpath: false,
      retries: {
        retries: 2 + Math.floor(timeout / 3000),
        factor: 1.5707,
        minTimeout: 200,
        maxTimeout: 3000
      }
    });
    return unlock;
  }
  // get, but only if unlocked, waiting on unlock
  // in fs terms between instances for specific unused scenarios this can be racy on a small margin,
  // if a get applies after a promise, ensure any corresponding locked sets itself to be idempotently accessible
  async getUnlocked (cachePath, timeout = 3000): Promise<any> {
    const resolved = path.resolve(this.basePath, cachePath);      
    await promiseRetry(async retry => {
      const locked = await lockfile.check(resolved, { realpath: false });
      if (locked)
        retry(new Error(`Operation timeout.`));
    }, {
      retries: 2 + Math.floor(timeout / 3000),
      factor: 1.5707,
      minTimeout: 200,
      maxTimeout: 3000
    });
    return this.get(resolved);
  }
  // get, waiting on any lock, locking,
  // creating and then unlocking if not existing
  async getOrCreate<T> (path: string, timeout = 3, createTask: () => Promise<T>) {
    let result = <T>await this.getUnlocked(path, timeout);
    if (result)
      return result;
    let unlock = await this.lock(path, timeout);
    // could have been beaten to the lock
    result = <T>await this.getUnlocked(path, timeout);
    if (result)
      return result;
    let timer;
    let timeoutPromise = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new JspmError('Operation timeout.')));
    });
    try {
      let value = <T>await Promise.race([timeoutPromise, createTask()]);
      clearTimeout(timer);
      this.set(path, value);
      return value;
    }
    finally {
      unlock();
    }
  }
}
