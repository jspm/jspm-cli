import { version } from './version';

let _fetch: typeof fetch;
let clearCache: () => void;
if (typeof fetch !== 'undefined') {
  _fetch = fetch;
}
else if (typeof process !== 'undefined' && process.versions?.node) {
  const path = require('path');
  const home = require('os').homedir();
  let cacheDir: string;
  if (process.platform === 'darwin')
    cacheDir = path.join(home, 'Library', 'Caches', 'jspm');
  else if (process.platform === 'win32')
    cacheDir = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'jspm-cache');
  else
    cacheDir = path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'jspm');
  clearCache = function () {
    require('rimraf').sync(path.join(cacheDir, 'fetch-cache'));
  };
  const __fetch = <typeof fetch>require('make-fetch-happen').defaults({ cacheManager: path.join(cacheDir, 'fetch-cache'), headers: { 'User-Agent': `jspm/${version}` } });
  const { fileURLToPath } = require('url');
  const { readFile } = require('fs').promises;
  _fetch = async function (url) {
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
    return __fetch.apply(this, arguments);
  }
}
else {
  throw new Error('No fetch implementation found for this environment, please post an issue.');
}

export { _fetch as fetch, clearCache };
