import { version } from './version.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

let _fetch: typeof fetch;
let clearCache: () => void;
if (typeof fetch !== 'undefined') {
  _fetch = fetch;
}
else if (globalThis?.process?.versions?.node) {
  // @ts-ignore
  const path = require('path');
  // @ts-ignore
  const home = require('os').homedir();
  // @ts-ignore
  const process = require('process');
  // @ts-ignore
  const rimraf = require('rimraf');
  // @ts-ignore
  const makeFetchHappen = require('make-fetch-happen');
  let cacheDir: string;
  if (process.platform === 'darwin')
    cacheDir = path.join(home, 'Library', 'Caches', 'jspm');
  else if (process.platform === 'win32')
    cacheDir = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'jspm-cache');
  else
    cacheDir = path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'jspm');
  clearCache = function () {
    rimraf.sync(path.join(cacheDir, 'fetch-cache'));
  };
  _fetch = makeFetchHappen.defaults({ cacheManager: path.join(cacheDir, 'fetch-cache'), headers: { 'User-Agent': `jspm/${version}` } }) as typeof fetch;
}
else {
  throw new Error('No fetch implementation found for this environment, please post an issue.');
}

const __fetch = _fetch;
_fetch = async function (url, ...args) {
  const urlString = url.toString();
  if (urlString.startsWith('file:') || urlString.startsWith('data:') || urlString.startsWith('node:')) {
    try {
      let source;
      if (urlString.startsWith('file:')) {
        source = await readFile(fileURLToPath(urlString));
      }
      else if (urlString.startsWith('node:')) {
        source = '';
      }
      else {
        source = decodeURIComponent(urlString.slice(urlString.indexOf(',')));
      }
      return {
        status: 200,
        async text () {
          return source.toString();
        },
        async json () {
          return JSON.parse(source.toString());
        }
      };
    }
    catch (e) {
      if (e.code === 'EISDIR' || e.code === 'ENOTDIR')
        return { status: 404, statusText: e.toString() };
      if (e.code === 'ENOENT')
        return { status: 404, statusText: e.toString() };
      return { status: 500, statusText: e.toString() };
    }
  }
  return __fetch(url, ...args);
} as typeof fetch;

export { _fetch as fetch, clearCache };
