import sver from 'sver';
import convertRange from 'sver/convert-range.js';
const { SemverRange } = sver;
import { ImportMap } from './tracemap';
import { InstallOptions } from './installer';
import lexer from 'es-module-lexer';
import { fetch } from './fetch.js';

export interface ExactPackage {
  registry: string;
  name: string;
  version: string;
}
export interface ExactPackagePath extends ExactPackage {
  path: string;
}

type ExportsTarget = string | null | { [condition: string]: ExportsTarget } | ExportsTarget[];

export interface PackageConfig {
  name?: string;
  main?: string;
  browser?: string | Record<string, string>;
  exports?: ExportsTarget | Record<string, ExportsTarget>;
  type?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
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

export function parseInstallTarget (target: string): { target: PackageTarget, subpath: string } {
  const registryIndex = target.indexOf(':');
  const scoped = target[registryIndex + 1] === '@';
  let sepIndex = target.indexOf('/', registryIndex + 1);
  if (scoped) {
    if (sepIndex === -1)
      throw new Error(`Invalid scoped package name ${target}`);
    sepIndex = target.indexOf('/', sepIndex + 1);
  }
  return {
    target: new PackageTarget(target.slice(0, sepIndex === -1 ? target.length : sepIndex)),
    subpath: sepIndex === -1 ? '.' : '.' + target.slice(sepIndex)
  };
}

export class PackageTarget {
  registry: string;
  name: string;
  ranges: any[];

  get registryName () {
    return `${this.registry}:${this.name}`;
  }

  constructor (target: string, depName?: string) {
    const registryIndex = target.indexOf(':');
    this.registry = registryIndex < 1 ? 'npm' : target.substr(0, registryIndex);

    const versionIndex = target.lastIndexOf('@');
    if (versionIndex > registryIndex + 1) {
      this.name = target.slice(registryIndex + 1, versionIndex);
      const version = target.slice(versionIndex + 1);
      this.ranges = (depName || SemverRange.isValid(version)) ? [new SemverRange(version)] : version.split('||').map(v => convertRange(v));
    }
    else if (registryIndex === -1 && depName) {
      this.name = depName;
      this.ranges = SemverRange.isValid(target) ? [new SemverRange(target)] : target.split('||').map(v => convertRange(v));
    }
    else {
      this.name = target.slice(registryIndex + 1);
      this.ranges = [new SemverRange('*')];
    }
  
    if (registryIndex === -1 && this.name.indexOf('/') !== -1 && this.name[0] !== '@')
      this.registry = 'github';
  
    const targetNameLen = this.name.split('/').length;
    if (targetNameLen > 2 || targetNameLen === 1 && this.name[0] === '@')
      throw new TypeError(`Invalid package target ${target}`);
  }

  toString () {
    return `${this.registryName}@${this.ranges.map(range => range.toString()).join(' || ')}`;
  }
};

interface ResolutionMapImports {
  [pkgName: string]: {
    pkg: ExactPackage;
    exports: Record<string, string>;
  }
}

export interface ResolutionMap {
  imports: ResolutionMapImports;
  scopes: {
    [pkgUrl: string]: ResolutionMapImports;
  }
}

function createEsmAnalysis (imports: any, source: string) {
  const deps: string[] = [];
  // dynamic import -> deoptimize trace all dependencies (and all their exports)
  if (imports.some(impt => impt.d >= 0)) {
    console.error('TODO: Dynamic import tracing.');
  }
  for (const impt of imports) {
    if (impt.d === -1)
      deps.push(source.slice(impt.s, impt.e));
  }
  const size = source.length;
  return { deps, size };
}

const registerRegEx = /^\s*(\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\s*\/\/[^\n]*)*\s*System\s*\.\s*register\s*\(\s*(\[[^\]]*\])\s*,\s*function\s*\(\s*([^\)]+(\s*,[^\)]+)?)?\s*\)/;
function createSystemAnalysis (source: string, url: string) {
  const [, , , rawDeps, , contextId] = source.match(registerRegEx) || [];
  if (!rawDeps) {
    throw new Error(`Source ${url} is not a valid System.register module.`);
  }
  const deps = JSON.parse(rawDeps.replace(/'/g, '"'));
  if (source.indexOf(`${contextId}.import`) !== -1)
    console.error('TODO: Dynamic import tracing for system modules.');
  const size = source.length;
  return { deps, size };
}

export function getExportsTarget(target, env): string | null {
  if (typeof target === 'string') {
    return target;
  }
  else if (typeof target === 'object' && target !== null && !Array.isArray(target)) {
    for (const condition in target) {
      if (env.includes(condition)) {
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
      return false;
    default: throw new Error(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
  }
}

export async function analyze (resolvedUrl: string, parentUrl?: URL, system = false): Promise<{ deps: string[], size: number }> {
  const res = await fetch(resolvedUrl);
  switch (res.status) {
    case 200:
    case 304:
      break;
    case 404: throw new Error(`Module not found: ${resolvedUrl}${parentUrl ? `, imported from ${parentUrl.href}` : ''}`);
    default: throw new Error(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
  }
  let source = await res.text();
  try {
    const [imports] = await lexer.parse(source);
    return system ? createSystemAnalysis(source, resolvedUrl) : createEsmAnalysis(imports, source);
  }
  catch (e) {
    // fetch is _unstable_!!!
    // so we retry the fetch first
    const res = await fetch(resolvedUrl);
    switch (res.status) {
      case 200:
      case 304:
        break;
      case 404: throw new Error(`Module not found: ${resolvedUrl}${parentUrl ? `, imported from ${parentUrl.href}` : ''}`);
      default: throw new Error(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
    }
    source = await res.text();
    try {
      const [imports] = await lexer.parse(source);
      return system ? createSystemAnalysis(source, resolvedUrl) : createEsmAnalysis(imports, source);
    }
    catch (e) {
      // TODO: better parser errors
      if (e.message.startsWith('Parse error @:')) {
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
        throw new Error(`Error parsing ${resolvedUrl}:${pos}`);
      }
      throw e;
    }
  }
}

export function importMapToResolutions (inMap: ImportMap, baseUrl: URL, opts: InstallOptions): [ResolutionMap, ImportMap] {
  const map: ImportMap = {
    imports: Object.create(null),
    scopes: Object.create(null),
    depcache: inMap.depcache
  };
  const installs: ResolutionMap = {
    imports: Object.create(null),
    scopes: Object.create(null)
  };

  function processMap (inMap: Record<string, string | null>, scope?: ExactPackage | boolean) {
    const scopeUrl = scope === true ? esmCdnUrl + '/' : scope ? pkgToUrl(scope, esmCdnUrl) : undefined;
    for (const [impt, target] of Object.entries(inMap)) {
      const parsed = parsePkg(impt);
      if (parsed && target !== null) {
        const { pkgName, subpath } = parsed;
        const targetUrl = new URL(target, baseUrl);
        const pkg = parseCdnPkg(targetUrl);
        if (pkg) {
          let resolutions = (scopeUrl ? (installs.scopes[scopeUrl] = installs.scopes[scopeUrl] || Object.create(null)) : installs.imports)[pkgName];
          if (!resolutions || pkgEq(resolutions.pkg, pkg) || opts.clean) {
            resolutions = resolutions || ((scopeUrl ? installs.scopes[scopeUrl] : installs.imports)[pkgName] = {
              pkg,
              exports: Object.create(null)
            });
            resolutions.exports[subpath] = '.' + pkg.path;
            continue;
          }
        }
      }
      (scopeUrl ? (map.scopes[scopeUrl] = map.scopes[scopeUrl] || Object.create(null)) : map.imports)[impt] = target;
    }
  }

  processMap(inMap.imports);

  for (const scope of Object.keys(inMap.scopes)) {
    const scopeUrl = new URL(scope, baseUrl);
    if (scopeUrl.href.startsWith(systemCdnUrl) || scopeUrl.href.startsWith(esmCdnUrl)) {
      if (scopeUrl.href === esmCdnUrl || scopeUrl.href === systemCdnUrl) {
        processMap(inMap.scopes[scope], true);
        continue;
      }
      const parsed = parseCdnPkg(scopeUrl);
      if (parsed && parsed.path === '/') {
        processMap(inMap.scopes[scope], parsed);
        continue;
      }
      if (opts.clean) continue;
    }
    const scopeEntry = map.scopes[scope] = map.scopes[scope] || Object.create(null);
    Object.assign(scopeEntry, inMap.scopes[scope]);
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

export function resolutionsToImportMap (installs: ResolutionMap, cdnUrl: string): ImportMap {
  const outMap = {
    imports: Object.create(null),
    scopes: Object.create(null),
    depcache: Object.create(null)
  };
  for (const [impt, { pkg, exports }] of Object.entries(installs.imports)) {
    for (const [subpath, target] of Object.entries(exports)) {
      outMap.imports[impt + subpath.slice(1)] = pkgToUrl(pkg, cdnUrl) + target.slice(1);
    }
  }
  for (const [scope, scopeEntry] of Object.entries(installs.scopes)) {
    if (!scope.startsWith(esmCdnUrl))
      throw new Error('Internal error.');
    const outScope = outMap.scopes[cdnUrl + scope.slice(esmCdnUrl.length)] = Object.create(null);
    for (const [impt, { pkg, exports }] of Object.entries(scopeEntry)) {
      for (const [subpath, target] of Object.entries(exports)) {
        outScope[impt + subpath.slice(1)] = pkgToUrl(pkg, cdnUrl) + target.slice(1);
      }
    }
  }
  return outMap;
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
export function pkgToStr (pkg: ExactPackage) {
  return `${pkg.registry}:${pkg.name}${pkg.version ? '@' + pkg.version : ''}`;
}
export function pkgToLookupUrl (pkg: ExactPackage, edge = false) {
  return `https://ga.jspm.dev/${pkg.registry}:${pkg.name}${pkg.version ? '@' + pkg.version : edge ? '@' : ''}`;
}
export const esmCdnUrl = 'https://ga.jspm.dev/';
export const systemCdnUrl = 'https://ga.jspm.systems/';
function pkgEq (pkgA: ExactPackage, pkgB: ExactPackage) {
  return pkgA.registry === pkgB.registry && pkgA.name === pkgB.name && pkgA.version === pkgB.version;
}
export function matchesTarget (pkg: ExactPackage, target: PackageTarget) {
  return pkg.registry === target.registry && pkg.name === target.name && target.ranges.some(range => range.has(pkg.version, true));
}
export function pkgToUrl (pkg: ExactPackage, cdnUrl: string) {
  return cdnUrl + pkgToStr(pkg);
}
const exactPkgRegEx = /^([a-z]+):((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;
export function parseCdnPkg (url: URL): ExactPackagePath | undefined {
  const href = url.href;
  let registry, name, version, path;
  if (href.startsWith(esmCdnUrl)) {
    [, registry, name, version, path] = href.slice(esmCdnUrl.length).match(exactPkgRegEx) || [];
  }
  if (href.startsWith(systemCdnUrl)) {
    [, registry, name, version, path] = href.slice(systemCdnUrl.length).match(exactPkgRegEx) || [];
  }
  if (registry)
    return { registry, name, version, path };
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

export function getMapMatch (specifier: string, map: Record<string, string | null>): string | undefined {
  if (specifier in map) return specifier;
  let curMatch;
  for (const match of Object.keys(map)) {
    if (!match.endsWith('/')) continue;
    if (specifier.startsWith(match)) {
      if (!curMatch || match.length > curMatch.length)
        curMatch = match;
    }
  }
  return curMatch;
}
