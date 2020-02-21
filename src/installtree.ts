import sver from 'sver';
import convertRange from 'sver/convert-range.js';
const { SemverRange } = sver;
import { ImportMap } from './tracemap';
import { InstallOptions } from './installer';

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
  range: any;

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
      this.range = (depName || SemverRange.isValid(version)) ? new SemverRange(version) : convertRange(version);
    }
    else if (registryIndex === -1 && depName) {
      this.name = depName;
      this.range = SemverRange.isValid(target) ? new SemverRange(target) : convertRange(target);
    }
    else {
      this.name = target.slice(registryIndex + 1);
      this.range = new SemverRange('*');
    }
  
    if (registryIndex === -1 && this.name.indexOf('/') !== -1 && this.name[0] !== '@')
      this.registry = 'github';
  
    const targetNameLen = this.name.split('/').length;
    if (targetNameLen > 2 || targetNameLen === 1 && this.name[0] === '@')
      throw new TypeError(`Invalid package target ${target}`);
  }

  toString () {
    return `${this.registryName}@${this.range.toString()}`;
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

  function processMap (inMap: Record<string, string | null>, scope?: string, scopeUrl?: URL) {
    for (const [impt, target] of Object.entries(inMap)) {
      const parsed = parsePkg(impt);
      if (parsed && target !== null) {
        const { pkgName, subpath } = parsed;
        const targetUrl = new URL(target, baseUrl);
        const pkg = parseCdnPkg(targetUrl);
        if (pkg) {
          const scopeHref = <string>(scopeUrl && scopeUrl.href);
          let resolutions = (scope ? (installs.scopes[scopeHref] = installs.scopes[scopeHref] || Object.create(null)) : installs.imports)[pkgName];
          if (!resolutions || pkgEq(resolutions.pkg, pkg) || opts.clean) {
            resolutions = resolutions || ((scope ? installs.scopes[scopeHref] : installs.imports)[pkgName] = {
              pkg,
              exports: Object.create(null)
            });
            resolutions.exports[subpath] = '.' + pkg.path;
            continue;
          }
        }
      }
      (scope ? (map.scopes[scope] = map.scopes[scope] || Object.create(null)) : map.imports)[impt] = target;
    }
  }

  processMap(inMap.imports);

  for (const scope of Object.keys(inMap.scopes)) {
    const scopeUrl = new URL(scope, baseUrl);
    if (scopeUrl.href.startsWith(cdnUrl)) {
      if (scopeUrl.href === cdnUrl) {
        processMap(inMap.scopes[scope], scope, scopeUrl);
        continue;
      }
      const parsed = parseCdnPkg(scopeUrl);
      if (parsed && parsed.path === '/') {
        processMap(inMap.scopes[scope], scope, scopeUrl);
        continue;
      }
      if (opts.clean) continue;
    }
    const scopeEntry = map.scopes[scope] = map.scopes[scope] || Object.create(null);
    Object.assign(scopeEntry, inMap.scopes[scope]);
  }
  return [installs, map];
}

export function resolutionsToImportMap (installs: ResolutionMap): ImportMap {
  const outMap = {
    imports: Object.create(null),
    scopes: Object.create(null),
    depcache: Object.create(null)
  };
  for (const [impt, { pkg, exports }] of Object.entries(installs.imports)) {
    for (const [subpath, target] of Object.entries(exports)) {
      outMap.imports[impt + subpath.slice(1)] = pkgToUrl(pkg) + target.slice(1);
    }
  }
  for (const [scope, scopeEntry] of Object.entries(installs.scopes)) {
    const outScope = outMap.scopes[scope] = Object.create(null);
    for (const [impt, { pkg, exports }] of Object.entries(scopeEntry)) {
      for (const [subpath, target] of Object.entries(exports)) {
        outScope[impt + subpath.slice(1)] = pkgToUrl(pkg) + target.slice(1);
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
export const cdnUrl = 'https://cdn.jspm.io/';
function pkgEq (pkgA: ExactPackage, pkgB: ExactPackage) {
  return pkgA.registry === pkgB.registry && pkgA.name === pkgB.name && pkgA.version === pkgB.version;
}
export function pkgToUrl (pkg: ExactPackage) {
  return cdnUrl + pkgToStr(pkg);
}
const exactPkgRegEx = /^([a-z]+):((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;
export function parseCdnPkg (url: URL): ExactPackagePath | undefined {
  const href = url.href;
  if (!href.startsWith(cdnUrl)) return;
  const [, registry, name, version, path] = href.slice(cdnUrl.length).match(exactPkgRegEx) || [];
  if (registry)
    return { registry, name, version, path };
}

const scopeCache = new WeakMap<Record<string, Record<string, string | null>>, { scopeKeys: string[], scopeUrls: string[] }>();
export function getScopeMatches (parentUrl: URL, scopes: Record<string, Record<string, string | null>>, baseUrl: URL): [string, string][] {
  const parentUrlHref = parentUrl.href;

  const cached = scopeCache.get(scopes);
  let scopeKeys: string[], scopeUrls: string[];
  if (cached) {
    ({ scopeKeys, scopeUrls } = cached);
  }
  else {
    // TODO: sorting / algorithmic optimization
    scopeKeys = Object.keys(scopes);
    scopeUrls = scopeKeys.map(scope => new URL(scope, baseUrl).href);
    scopeCache.set(scopes, { scopeKeys, scopeUrls });
  }

  const scopeMatches: [string, string][] = [];

  let scopeIndex = scopeUrls.indexOf(parentUrlHref);
  if (scopeIndex !== -1) scopeMatches.push([scopeKeys[scopeIndex], parentUrlHref]);

  for (const [i, scopeUrl] of scopeUrls.entries()) {
    if (!scopeUrl.endsWith('/')) continue;
    if (parentUrlHref.startsWith(scopeUrl))
      scopeMatches.push([scopeKeys[i], scopeUrl]);
  }
  return scopeMatches.sort(([,matchA], [,matchB]) => matchA.length > matchB.length ? 1 : -1);
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
