import sver from 'sver';
import convertRange from 'sver/convert-range';
const { SemverRange } = sver;
import { ImportMap } from './tracemap.ts';
import { parse } from 'es-module-lexer';
import { fetch } from './fetch.ts';
import { computeIntegrity, importedFrom, JspmError } from './utils.ts';

export interface ExactPackage {
  registry: string;
  name: string;
  version: string;
}
export interface ExactPackagePath extends ExactPackage {
  system: boolean;
  path: string;
}

type ExportsTarget = string | null | { [condition: string]: ExportsTarget } | ExportsTarget[];

export interface PackageConfig {
  registry?: string;
  name?: string;
  version?: string;
  main?: string;
  files?: string[];
  browser?: string | Record<string, string>;
  exports?: ExportsTarget | Record<string, ExportsTarget>;
  type?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface PackageInstall {
  pkgName: string;
  pkgScope?: string | undefined;
}

export interface PackageInstallRange {
  pkg: ExactPackage;
  target: PackageTarget;
  install: PackageInstall;
}

export function parsePackageTarget (target: string): { target: PackageTarget, subpath: string } {
  const registryIndex = target.indexOf(':');
  const scoped = target[registryIndex + 1] === '@';
  let sepIndex = target.indexOf('/', registryIndex + 1);
  if (scoped) {
    if (sepIndex === -1)
      throw new JspmError(`Invalid scoped package name ${target}`);
    sepIndex = target.indexOf('/', sepIndex + 1);
  }
  return {
    target: newPackageTarget(target.slice(0, sepIndex === -1 ? target.length : sepIndex)),
    subpath: sepIndex === -1 ? '.' : '.' + target.slice(sepIndex)
  };
}

export type InstallTarget = PackageTarget | URL;

export interface PackageTarget {
  registry: string;
  name: string;
  ranges: any[];
}

export function newPackageTarget (target: string, depName?: string): PackageTarget {
  let registry: string, name: string, ranges: any[];

  const registryIndex = target.indexOf(':');
  registry = registryIndex < 1 ? 'npm' : target.substr(0, registryIndex);

  if (registry === 'file')
    throw new Error('TODO: file: dependency installs, installing ' + target);

  const versionIndex = target.lastIndexOf('@');
  if (versionIndex > registryIndex + 1) {
    name = target.slice(registryIndex + 1, versionIndex);
    const version = target.slice(versionIndex + 1);
    ranges = (depName || SemverRange.isValid(version)) ? [new SemverRange(version)] : version.split('||').map(v => convertRange(v));
  }
  else if (registryIndex === -1 && depName) {
    name = depName;
    ranges = SemverRange.isValid(target) ? [new SemverRange(target)] : target.split('||').map(v => convertRange(v));
  }
  else {
    name = target.slice(registryIndex + 1);
    ranges = [new SemverRange('*')];
  }

  if (registryIndex === -1 && name.indexOf('/') !== -1 && name[0] !== '@')
    registry = 'github';

  const targetNameLen = name.split('/').length;
  if (targetNameLen > 2 || targetNameLen === 1 && name[0] === '@')
    throw new JspmError(`Invalid package target ${target}`);

  return { registry, name, ranges };
}

// export function pkgTargetToString(pkgTarget: PackageTarget) {
//   return `${pkgTarget.registry}@${pkgTarget.ranges.map(range => range.toString()).join(' || ')}`;
// }

interface ResolutionMapImports {
  [pkgName: string]: {
    pkgUrl: string,
    exports: Record<string, string>
  }
}

export interface ResolutionMap {
  imports: ResolutionMapImports;
  scopes: {
    [pkgUrl: string]: ResolutionMapImports;
  }
}

function createEsmAnalysis (imports: any, source: string, url: string) {
  if (!imports.length && registerRegEx.test(source))
    return createSystemAnalysis(source, imports, url);
  const deps: string[] = [];
  const dynamicDeps: string[] = [];
  for (const impt of imports) {
    if (impt.d === -1) {
      deps.push(source.slice(impt.s, impt.e));
      continue;
    }
    // dynamic import -> deoptimize trace all dependencies (and all their exports)
    if (impt.d >= 0) {
      const dynExpression = source.slice(impt.s, impt.e);
      if (dynExpression.startsWith('"') || dynExpression.startsWith('\'')) {
        try {
          dynamicDeps.push(JSON.parse('"' + dynExpression.slice(1, -1) + '"'));
        }
        catch (e) {
          console.warn('TODO: Dynamic import custom expression tracing.');
        }
      }
    }
  }
  const size = source.length;
  return { deps, dynamicDeps, size, integrity: computeIntegrity(source), system: false };
}

const registerRegEx = /^\s*(\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\s*\/\/[^\n]*)*\s*System\s*\.\s*register\s*\(\s*(\[[^\]]*\])\s*,\s*\(?function\s*\(\s*([^\),\s]+\s*(,\s*([^\),\s]+)\s*)?\s*)?\)/;
function createSystemAnalysis (source: string, imports: string[], url: string) {
  const [, , , rawDeps, , , contextId] = source.match(registerRegEx) || [];
  if (!rawDeps)
    return createEsmAnalysis(imports, source, url);
  const deps = JSON.parse(rawDeps.replace(/'/g, '"'));
  const dynamicDeps: string[] = [];
  if (contextId) {
    const dynamicImport = `${contextId}.import(`;
    let i = -1;
    while ((i = source.indexOf(dynamicImport, i + 1)) !== -1) {
      const importStart = i + dynamicImport.length + 1;
      const quote = source[i + dynamicImport.length];
      if (quote === '"' || quote === '\'') {
        const importEnd = source.indexOf(quote, i + dynamicImport.length + 1);
        if (importEnd !== -1) {
          try {
            dynamicDeps.push(JSON.parse('"' + source.slice(importStart, importEnd) + '"'));
            continue;
          }
          catch (e) {}
        }
      }
      console.warn('TODO: Dynamic import custom expression tracing.');
    }
  }
  const size = source.length;
  return { deps, dynamicDeps, size, integrity: computeIntegrity(source), system: true };
}

export function getExportsTarget(target, env): string | null {
  if (typeof target === 'string') {
    return target;
  }
  else if (typeof target === 'object' && target !== null && !Array.isArray(target)) {
    for (const condition in target) {
      if (condition === 'default' || env.includes(condition)) {
        const resolved = getExportsTarget(target[condition], env);
        if (resolved)
          return resolved;
      }
    }
  }
  else if (Array.isArray(target)) {
    // TODO: Validation for arrays
    for (const targetFallback of target) {
      return getExportsTarget(targetFallback, env);
    }
  }
  return null;
}

export async function exists (resolvedUrl: string): Promise<boolean> {
  const res = await fetch(resolvedUrl);
  switch (res.status) {
    case 200:
    case 304:
      return true;
    case 404:
    case 406:
      return false;
    default: throw new JspmError(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
  }
}

export async function analyze (resolvedUrl: string, parentUrl?: URL, system = false): Promise<{ deps: string[], dynamicDeps: string[], size: number, integrity: string, system: boolean }> {
  const res = await fetch(resolvedUrl);
  switch (res.status) {
    case 200:
    case 304:
      break;
    case 404: throw new JspmError(`Module not found: ${resolvedUrl}${importedFrom(parentUrl)}`);
    default: throw new JspmError(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
  }
  let source = await res.text();
  try {
    const [imports] = await parse(source);
    return system ? createSystemAnalysis(source, imports, resolvedUrl) : createEsmAnalysis(imports, source, resolvedUrl);
  }
  catch (e) {
    if (!e.message || !e.message.startsWith('Parse error @:'))
      throw e;
    // fetch is _unstable_!!!
    // so we retry the fetch first
    const res = await fetch(resolvedUrl);
    switch (res.status) {
      case 200:
      case 304:
        break;
      case 404: throw new JspmError(`Module not found: ${resolvedUrl}${importedFrom(parentUrl)}`);
      default: throw new JspmError(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
    }
    source = await res.text();
    try {
      const [imports] = await parse(source);
      return system ? createSystemAnalysis(source, imports, resolvedUrl) : createEsmAnalysis(imports, source, resolvedUrl);
    }
    catch (e) {
      // TODO: better parser errors
      if (e.message && e.message.startsWith('Parse error @:')) {
        const pos = e.message.slice(14, e.message.indexOf('\n'));
        let [line, col] = pos.split(':');
        const lines = source.split('\n');
        // console.log(source);
        if (line > 1)
          console.log('  ' + lines[line - 2]);
        console.log('> ' + lines[line - 1]);
        console.log('  ' + ' '.repeat(col - 1) + '^');
        if (lines.length > 1)
          console.log('  ' + lines[line]);
        throw new JspmError(`Error parsing ${resolvedUrl}:${pos}`);
      }
      throw e;
    }
  }
}

export async function checkPjson (url: URL): Promise<URL | false> {
  const res = await fetch(new URL('package.json', url).href);
  switch (res.status) {
    case 304:
    case 200:
      if (!res.headers)
        return res.url ? new URL(res.url) : url;
      const contentType = res.headers.get('content-type');
      if (contentType?.match(/^application\/json(;|$)/))
        return res.url ? new URL(res.url) : url;
    case 404:
    case 406:
      return false;
    default: throw new JspmError(`Invalid status code ${res.status} looking up ${url.href} - ${res.statusText}`);
  }
}

export async function getPackageBase (url: URL) {
  const cdnPkg = parseCdnPkg(url.href);
  if (cdnPkg)
    return pkgToUrl(cdnPkg, cdnPkg.system ? systemCdnUrl : esmCdnUrl);

  if (url.protocol === 'node:')
    return url.href;
  
  do {
    let responseUrl;
    if (responseUrl = await checkPjson(url))
      return new URL('.', responseUrl).href;
    if (url.pathname === '/')
      return url.href;
  } while (url = new URL('../', url));
  throw new Error('Internal Error.');
}

export async function importMapToResolutions (inMap: ImportMap, baseUrl: URL): Promise<[ResolutionMap, ImportMap]> {
  const map: ImportMap = {
    imports: Object.create(null),
    scopes: Object.create(null),
    depcache: inMap.depcache,
    integrity: Object.create(null)
  };
  const installs: ResolutionMap = {
    imports: Object.create(null),
    scopes: Object.create(null)
  };

  async function processMap (inMap: Record<string, string | null>, scopeUrl?: string) {
    for (const [impt, target] of Object.entries(inMap)) {
      const parsed = parsePkg(impt);
      if (parsed && target !== null) {
        const { pkgName, subpath } = parsed;

        const targetUrl = new URL(target, baseUrl);
        const pkgUrl = await getPackageBase(targetUrl);
        const pkgPath = targetUrl.href.length > pkgUrl.length ? targetUrl.href.slice(pkgUrl.length - 1) : '';

        let resolutions = (scopeUrl ? (installs.scopes[scopeUrl] = installs.scopes[scopeUrl] || Object.create(null)) : installs.imports)[pkgName];
        if (!resolutions || resolutions.pkgUrl === pkgUrl) {
          resolutions = resolutions || ((scopeUrl ? installs.scopes[scopeUrl] : installs.imports)[pkgName] = {
            pkgUrl,
            exports: Object.create(null)
          });
          resolutions.exports[subpath] = '.' + pkgPath;
          continue;
        }
      }
      (scopeUrl ? (map.scopes[scopeUrl] = map.scopes[scopeUrl] || Object.create(null)) : map.imports)[impt] = target;
    }
  }

  await processMap(inMap.imports);

  for (const scope of Object.keys(inMap.scopes)) {
    const scopeUrl = new URL(scope, baseUrl);
    await processMap(inMap.scopes[scope], scopeUrl.href);
  }

  return [installs, map];
}

const encodedHashRegEx = /%23/g;
const encodedPercentRegEx = /%25/g;
export function unsanitizeUrl (url) {
  if (url.indexOf('%') === -1)
    return url;
  return url.replace(encodedHashRegEx, '#').replace(encodedPercentRegEx, '%');
}

export function resolutionsToImportMap (installs: ResolutionMap, filter: Set<string> | null, system: boolean): ImportMap {
  const outMap = {
    imports: Object.create(null),
    scopes: Object.create(null),
    depcache: Object.create(null),
    integrity: Object.create(null)
  };
  for (let [impt, { pkgUrl, exports }] of Object.entries(installs.imports)) {
    for (const [subpath, target] of Object.entries(exports)) {
      const specifier = impt + subpath.slice(1);
      if (filter && !filter.has(specifier))
        continue;
      if (system && pkgUrl.startsWith(esmCdnUrl))
        pkgUrl = systemCdnUrl + pkgUrl.slice(esmCdnUrl.length);
      else if (!system && pkgUrl.startsWith(systemCdnUrl))
        pkgUrl = esmCdnUrl + pkgUrl.slice(systemCdnUrl.length);
      outMap.imports[specifier] = pkgUrl + target.slice(2);
    }
  }
  for (let [scopeKey, scopeEntry] of Object.entries(installs.scopes)) {
    const outScope = Object.create(null);
    for (let [impt, { pkgUrl, exports }] of Object.entries(scopeEntry)) {
      for (const [subpath, target] of Object.entries(exports)) {
        const specifier = impt + subpath.slice(1);
        if (filter && !filter.has(scopeKey + '|' + specifier))
          continue;
        if (system && pkgUrl.startsWith(esmCdnUrl))
          pkgUrl = systemCdnUrl + pkgUrl.slice(esmCdnUrl.length);
        else if (!system && pkgUrl.startsWith(systemCdnUrl))
          pkgUrl = esmCdnUrl + pkgUrl.slice(systemCdnUrl.length);
        if (target === null)
          outScope[specifier] = null;
        else
          outScope[specifier] = pkgUrl + target.slice(2);
      }
    }
    if (Object.keys(outScope).length) {
      if (system && scopeKey.startsWith(esmCdnUrl))
        scopeKey = systemCdnUrl + scopeKey.slice(esmCdnUrl.length);
      else if (!system && scopeKey.startsWith(systemCdnUrl))
        scopeKey = esmCdnUrl + scopeKey.slice(systemCdnUrl.length);
      outMap.scopes[scopeKey] = outScope;
    }
  }
  return outMap;
}

export function derivePackageName (pkgUrl: URL, targetUrl: URL): string {
  let pathname = pkgUrl.pathname;
  if (pathname === '/') {
    const parts = targetUrl.href.split('/');
    if (parts[parts.length - 1] === '')
      parts.pop();
    const name = <string>parts.pop();
    const extIndex = name.lastIndexOf('.');
    return extIndex === -1 ? name : name.slice(0, extIndex);
  }
  const parts = pathname.split('/');
  if (parts[parts.length - 1] === '')
    parts.pop();
  let name: string;
  if (parts[parts.length - 2] && parts[parts.length - 2].startsWith('@'))
    name = parts.slice(parts.length - 2, parts.length).join('/');
  else if (parts.length)
    name = <string>parts.pop();
  else
    throw new Error('Internal error');
  if (name.indexOf(':') > 0)
    name = name.slice(name.indexOf(':') + 1);
  if (name.indexOf('@') > 0)
    return name.slice(0, name.indexOf('@'));
  else
    return name;
}

export function parsePkg (specifier: string): { pkgName: string, subpath: string } | undefined {
  let sepIndex = specifier.indexOf('/');
  if (specifier[0] === '@') {
    if (sepIndex === -1) return;
    sepIndex = specifier.indexOf('/', sepIndex + 1);
  }
  // TODO: Node.js validations like percent encodng checks
  if (sepIndex === -1)
    return { pkgName: specifier, subpath: '.' };
  return { pkgName: specifier.slice(0, sepIndex), subpath: '.' + specifier.slice(sepIndex) };
}
export function nicePkgStr (pkgUrl: string) {
  if (pkgUrl.startsWith(esmCdnUrl))
    return decodeURIComponent(pkgUrl.slice(esmCdnUrl.length));
  if (pkgUrl.startsWith(systemCdnUrl))
    return decodeURIComponent(pkgUrl.slice(systemCdnUrl.length));
  return pkgUrl;
}
export function pkgToStr (pkg: ExactPackage) {
  return `${pkg.registry}:${pkg.name}${pkg.version ? '@' + pkg.version : ''}`;
}
export function pkgToLookupUrl (pkg: ExactPackage, edge = false) {
  return `https://ga.jspm.io/${pkg.registry}:${pkg.name}${pkg.version != undefined ? '@' + pkg.version : edge ? '@' : ''}`;
}
export const esmCdnUrl = 'https://ga.jspm.io/';
export const systemCdnUrl = 'https://ga.system.jspm.io/';
export function matchesTarget (pkg: ExactPackage, target: PackageTarget) {
  return pkg.registry === target.registry && pkg.name === target.name && target.ranges.some(range => range.has(pkg.version, true));
}
export function pkgToUrl (pkg: ExactPackage, cdnUrl: string) {
  return cdnUrl + pkgToStr(pkg) + '/';
}
const exactPkgRegEx = /^([a-z]+):((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;
export function parseCdnPkg (url: string): ExactPackagePath | undefined {
  let registry, name, version, path, system = false;
  if (url.startsWith(esmCdnUrl)) {
    [, registry, name, version, path] = url.slice(esmCdnUrl.length).match(exactPkgRegEx) || [];
  }
  if (url.startsWith(systemCdnUrl)) {
    system = true;
    [, registry, name, version, path] = url.slice(systemCdnUrl.length).match(exactPkgRegEx) || [];
  }
  if (registry)
    return { registry, name, version, path, system };
}

const scopeCache = new WeakMap<Record<string, Record<string, string | null>>, [string, string][]>();
export function getScopeMatches (parentUrl: URL, scopes: Record<string, Record<string, string | null>>, baseUrl: URL): [string, string][] {
  const parentUrlHref = parentUrl.href;

  let scopeCandidates = scopeCache.get(scopes);
  if (!scopeCandidates) {
    scopeCandidates = Object.keys(scopes).map(scope => [scope, new URL(scope, baseUrl).href]);
    scopeCandidates = scopeCandidates.sort(([, matchA], [, matchB]) => matchA.length < matchB.length ? 1 : -1);
    scopeCache.set(scopes, scopeCandidates);
  }

  return scopeCandidates.filter(([, scopeUrl]) => {
    return scopeUrl === parentUrlHref || scopeUrl.endsWith('/') && parentUrlHref.startsWith(scopeUrl);
  });
}

export function getMapMatch<T = any> (specifier: string, map: Record<string, T>): string | undefined {
  if (specifier in map) return specifier;
  let curMatch;
  for (const match of Object.keys(map)) {
    const wildcard = match.endsWith('*');
    if (!match.endsWith('/') && !wildcard) continue;
    if (specifier.startsWith(wildcard ? match.slice(0, -1) : match)) {
      if (!curMatch || match.length > curMatch.length)
        curMatch = match;
    }
  }
  return curMatch;
}

export function getMapResolved (exportMatch: string, exportTarget: string | null, subpathTarget: string): string | null {
  if (exportTarget === null)
    return null;
  const wildcard = exportMatch.endsWith('*');
  const subpathTrailer = subpathTarget.slice(wildcard ? exportMatch.length - 1 : exportMatch.length);
  if (wildcard)
    return exportTarget.slice(2).replace(/\*/g, subpathTrailer);
  return exportTarget.slice(2) + subpathTrailer;
}