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
const path = require("path");
const fs = require("graceful-fs");
const lockfile = require("proper-lockfile");
const common_1 = require("./common");
const promiseRetry = require("promise-retry");
const mkdirp = require("mkdirp");
/*
 * multi-process fs caching with lock file
 * with in-memory single-process cache and lock queue
 */
class Cache {
    constructor(basePath) {
        this.basePath = path.resolve(basePath);
        mkdirp.sync(this.basePath);
    }
    get(cachePath) {
        const resolved = path.resolve(this.basePath, cachePath);
        return common_1.readJSON(resolved).catch(_err => {
            // gracefully handle corruptions
        });
    }
    async set(cachePath, value) {
        const resolved = path.resolve(this.basePath, cachePath);
        if (path.relative(this.basePath, resolved).indexOf(path.sep) !== -1)
            await new Promise((resolve, reject) => mkdirp(path.dirname(resolved), err => err ? reject(err) : resolve()));
        await new Promise((resolve, reject) => fs.writeFile(resolved, JSON.stringify(value), err => err ? reject(err) : resolve()));
    }
    async setUnlock(cachePath, value) {
        const resolved = path.resolve(this.basePath, cachePath);
        if (path.relative(this.basePath, resolved).indexOf(path.sep) !== -1)
            await new Promise((resolve, reject) => mkdirp(path.dirname(resolved), err => err ? reject(err) : resolve()));
        await new Promise((resolve, reject) => fs.writeFile(resolved, JSON.stringify(value), err => err ? reject(err) : resolve()));
        await new Promise((resolve, reject) => lockfile.unlock(resolved, {
            realpath: false
        }, err => err ? reject(err) : resolve()));
    }
    async del(cachePath) {
        const resolved = path.resolve(this.basePath, cachePath);
        await new Promise((resolve, reject) => fs.unlink(resolved, err => err ? reject(err) : resolve()));
    }
    async lock(cachePath, timeout = 3000) {
        const resolved = path.resolve(this.basePath, cachePath);
        await new Promise((resolve, reject) => mkdirp(path.dirname(resolved), err => err ? reject(err) : resolve()));
        const unlock = await new Promise((resolve, reject) => lockfile.lock(resolved, {
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
        }, (err, unlock) => err ? reject(err) : resolve(unlock)));
        return () => {
            return new Promise((resolve, reject) => unlock(err => err ? reject(err) : resolve()));
        };
    }
    // get, but only if unlocked, waiting on unlock
    // in fs terms between instances for specific unused scenarios this can be racy on a small margin,
    // if a get applies after a promise, ensure any corresponding locked sets itself to be idempotently accessible
    async getUnlocked(cachePath, timeout = 3000) {
        const resolved = path.resolve(this.basePath, cachePath);
        await promiseRetry(async (retry) => {
            const locked = await new Promise((resolve, reject) => lockfile.check(resolved, { realpath: false }, (err, locked) => err ? reject(err) : resolve(locked)));
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
    async getOrCreate(path, timeout = 3, createTask) {
        let result = await this.getUnlocked(path, timeout);
        if (result)
            return result;
        let unlock = await this.lock(path, timeout);
        // could have been beaten to the lock
        result = await this.getUnlocked(path, timeout);
        if (result)
            return result;
        let timer;
        let timeoutPromise = new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new common_1.JspmError('Operation timeout.')));
        });
        try {
            let value = await Promise.race([timeoutPromise, createTask()]);
            clearTimeout(timer);
            this.set(path, value);
            return value;
        }
        finally {
            unlock();
        }
    }
}
exports.default = Cache;
//# sourceMappingURL=cache.js.map