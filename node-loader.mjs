import mfh from 'make-fetch-happen';

import process from 'process';
import path from 'path';
import { homedir } from 'os';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

const home = homedir();
let cacheDir;
if (process.platform === 'darwin')
  cacheDir = path.join(home, 'Library', 'Caches', 'jspm');
else if (process.platform === 'win32')
  cacheDir = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'jspm-cache');
else
  cacheDir = path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'jspm');

const version = 'NODE-BETA';

const fetch = mfh.defaults({ cacheManager: path.join(cacheDir, 'fetch-cache'), headers: { 'User-Agent': `jspm/${version}` } });

const baseUrl = pathToFileURL(process.cwd() + '/').href;
const map = resolveAndComposeImportMap(JSON.parse(readFileSync('./node.importmap')), baseUrl, { imports: {}, scopes: {}, depcache: {} }, baseUrl);

export function resolve (specifier, context) {
  const parentUrl = context.parentURL || baseUrl;
  const resolved = resolveImportMap(map, specifier, parentUrl) || resolveIfNotPlainOrUrl(specifier, parentUrl);
  if (!resolved)
    return { url: 'data:application/javascript,export default null;' };
  return { url: resolved };
}
export function getFormat (url) {
  if (url.startsWith('node:'))
    return { format: 'builtin' };
  return { format: 'module' };
}
export async function getSource (url, context, defaultGetSource) {
  if (url.startsWith('data:'))
    return defaultGetSource(url, context);
  if (url.startsWith('file:'))
    return defaultGetSource(url, context);
  const res = await fetch(url);
  return { source: await res.text() };
}

export function resolveIfNotPlainOrUrl (relUrl, parentUrl) {
  if (/^\.?\.?\//.test(relUrl)) return new URL(relUrl, parentUrl).href;
}

/*
 * Import maps implementation
 *
 * To make lookups fast we pre-resolve the entire import map
 * and then match based on backtracked hash lookups
 *
 */
export function resolveUrl (relUrl, parentUrl) {
  return resolveIfNotPlainOrUrl(relUrl, parentUrl) || (relUrl.indexOf(':') !== -1 ? relUrl : resolveIfNotPlainOrUrl('./' + relUrl, parentUrl));
}

function resolveAndComposePackages (packages, outPackages, baseUrl, parentMap, parentUrl) {
  for (let p in packages) {
    const resolvedLhs = resolveIfNotPlainOrUrl(p, baseUrl) || p;
    let target = packages[p];
    if (typeof target !== 'string') 
      continue;
    const mapped = resolveImportMap(parentMap, resolveIfNotPlainOrUrl(target, baseUrl) || target, parentUrl);
    if (mapped) {
      outPackages[resolvedLhs] = mapped;
      continue;
    }
    targetWarning(p, packages[p], 'bare specifier did not resolve');
  }
}

export function resolveAndComposeImportMap (json, baseUrl, parentMap) {
  const outMap = { imports: Object.assign({}, parentMap.imports), scopes: Object.assign({}, parentMap.scopes), depcache: Object.assign({}, parentMap.depcache) };

  if (json.imports)
    resolveAndComposePackages(json.imports, outMap.imports, baseUrl, parentMap, null);

  if (json.scopes)
    for (let s in json.scopes) {
      const resolvedScope = resolveUrl(s, baseUrl);
      resolveAndComposePackages(json.scopes[s], outMap.scopes[resolvedScope] || (outMap.scopes[resolvedScope] = {}), baseUrl, parentMap, resolvedScope);
    }

  if (json.depcache)
    for (let d in json.depcache) {
      const resolvedDepcache = resolveUrl(d, baseUrl);
      outMap.depcache[resolvedDepcache] = json.depcache[d];
    }

  return outMap;
}

function getMatch (path, matchObj) {
  if (matchObj[path])
    return path;
  let sepIndex = path.length;
  do {
    const segment = path.slice(0, sepIndex + 1);
    if (segment in matchObj)
      return segment;
  } while ((sepIndex = path.lastIndexOf('/', sepIndex - 1)) !== -1)
}

function applyPackages (id, packages) {
  const pkgName = getMatch(id, packages);
  if (pkgName) {
    const pkg = packages[pkgName];
    if (pkg === null) return;
    if (id.length > pkgName.length && pkg[pkg.length - 1] !== '/')
      targetWarning(pkgName, pkg, "should have a trailing '/'");
    else
      return pkg + id.slice(pkgName.length);
  }
}

function targetWarning (match, target, msg) {
  console.warn("Package target " + msg + ", resolving target '" + target + "' for " + match);
}

export function resolveImportMap (importMap, resolvedOrPlain, parentUrl) {
  let scopeUrl = parentUrl && getMatch(parentUrl, importMap.scopes);
  while (scopeUrl) {
    const packageResolution = applyPackages(resolvedOrPlain, importMap.scopes[scopeUrl]);
    if (packageResolution)
      return packageResolution;
    scopeUrl = getMatch(scopeUrl.slice(0, scopeUrl.lastIndexOf('/')), importMap.scopes);
  }
  const resolved = applyPackages(resolvedOrPlain, importMap.imports);
  if (resolved === undefined && resolvedOrPlain.indexOf(':') !== -1)
    return resolvedOrPlain;
  return resolved;
}
