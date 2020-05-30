import sver from 'sver';
const { Semver, SemverRange } = sver;
import { TraceMap, ImportMap } from './tracemap.js';
import { isPlain, baseUrl, sort } from './utils.js';
import { fetch } from './fetch.js';
import { log } from './log.js';
import { ExactPackage, PackageConfig, PackageInstall, PackageTarget, pkgToUrl, ResolutionMap, resolutionsToImportMap, importMapToResolutions, pkgToStr, parsePkg, esmCdnUrl, systemCdnUrl, parseCdnPkg, getMapMatch, getScopeMatches, PackageInstallRange, parseInstallTarget, analyze, exists, getExportsTarget, pkgToLookupUrl, matchesTarget } from './installtree.js';

export type Semver = any;
export type SemverRange = any;

function importedFrom (parentUrl?: URL) {
  if (!parentUrl) return '';
  parentUrl.pathname = parentUrl.pathname
    .replace(/:/g, '%3A')
    .replace(/@/g, '%40');
  return ` imported from ${parentUrl.href}`;
}

export interface InstallOptions {
  // whether existing resolutions should be locked
  lock?: boolean;
  // force use latest versions for everything
  latest?: boolean;
  // any untouched branches at the end of the install
  // should be removed. That is, _install is exhaustive_.
  // this is used by uninstall and lock install clean
  clean?: boolean;
  // if a resolution is not in its expected range
  // / expected URL (usually due to manual user edits),
  // force override a new install
  // when clean: true is set, applies clean to unknowns too
  force?: boolean;
  // whether to construct depcache metadata for the install tree
  depcache?: boolean;
  // whether to flatten scopes after the install
  flatten?: boolean;
  // whether to include all the exports
  // in the install, or only those exports used
  installExports?: boolean;
  // output System modules
  system?: boolean;
};

export class Installer {
  traceMap: TraceMap;

  mapBaseUrl: URL;
  pageBaseUrl: URL = baseUrl;
  env: string[];
  installs: ResolutionMap;
  map: ImportMap;

  resolveCache: Record<string, {
    latest: Promise<ExactPackage | null>;
    majors: Record<string, Promise<ExactPackage | null>>;
    minors: Record<string, Promise<ExactPackage | null>>;
    tags: Record<string, Promise<ExactPackage | null>>;
  }> = {};
  pcfgPromises: Record<string, Promise<void>> = Object.create(null);
  pcfgs: Record<string, PackageConfig> = Object.create(null);
  opts: InstallOptions;

  tracedUrls: Record<string, string[]> = Object.create(null);
  resolvedExportsCache = new WeakMap<PackageConfig, Record<string, string>>();

  completed = false;

  constructor (map: TraceMap, opts: InstallOptions) {
    this.traceMap = map;
    this.mapBaseUrl = this.traceMap.baseUrl;
    this.opts = opts;


    // TODO: env detection from existing resolutions?
    this.env = ['import', 'default', 'browser', 'production'];

    [this.installs, this.map] = importMapToResolutions(this.traceMap.map, this.mapBaseUrl, opts);
  }

  complete () {
    if (this.opts.depcache) {
      if (this.opts.clean) this.map.depcache = Object.create(null);
      for (const [url, deps] of Object.entries(this.tracedUrls)) {
        if (deps.length) this.map.depcache[url] = deps;
      }
    }

    this.traceMap.set(sort(this.map));
    this.traceMap.extend(sort(resolutionsToImportMap(this.installs, this.opts.system ? systemCdnUrl : esmCdnUrl)));

    if (this.opts.flatten) this.traceMap.flatten();

    this.completed = true;
  }

  async install (installTarget: string, pkgName?: string): Promise<void> {
    if (this.completed) throw new Error('New install instance needed.');
    const { target, subpath } = parseInstallTarget(installTarget);
    if (!pkgName) pkgName = target.name;
    const pkg = await this.resolveLatestTarget(target);
    log('install', `${pkgName} ${pkgToStr(pkg)}`);
    const install = { pkgName };
    const pkgExports = this.setResolution(install, pkg);
    let subpaths;
    if (this.opts.installExports) {
      const pcfg = await this.getPackageConfig(pkg);
      const availableSubpaths = Object.keys(await this.resolveExports(pkg, pcfg));
      subpaths = availableSubpaths;
    }
    else if (subpath === '.') {
      const pcfg = await this.getPackageConfig(pkg);
      const availableSubpaths = Object.keys(await this.resolveExports(pkg, pcfg));
      if (!availableSubpaths.includes(subpath))
        subpaths = availableSubpaths;
    }
    else if (subpath === './') {
      const pcfg = await this.getPackageConfig(pkg);
      const availableSubpaths = Object.keys(await this.resolveExports(pkg, pcfg));
      if (!availableSubpaths.includes(subpath))
        subpaths = availableSubpaths;
    }
    subpaths = subpaths || [subpath];
    await this.tracePkg(pkg, subpaths, pkgExports, true, false);
  }

  private setResolution (install: PackageInstall, pkg: ExactPackage): Record<string, string> {
    if (!install.pkgScope) {
      let resolutionMap = this.installs.imports[install.pkgName];
      if (resolutionMap)
        resolutionMap.pkg = pkg;
      else
        resolutionMap = this.installs.imports[install.pkgName] = { pkg, exports: Object.create(null) };
      return resolutionMap.exports;
    }
    else {
      const scope = this.installs.scopes[install.pkgScope] = this.installs.scopes[install.pkgScope] || Object.create(null);
      let resolutionMap = scope[install.pkgName];
      if (resolutionMap)
        resolutionMap.pkg = pkg;
      else
        resolutionMap = scope[install.pkgName] = { pkg, exports: Object.create(null) };
      return resolutionMap.exports;
    } 
  }

  // CDN TODO: CDN must disable extension checks
  // CDN TODO: CDN should set "exports" explicitly from its analysis, thereby encapsulating the CDN package
  private async resolveExports (pkg: ExactPackage, pcfg: PackageConfig, cjsResolve = false): Promise<Record<string, string>> {
    const cached = this.resolvedExportsCache.get(pcfg);
    if (cached) return cached;

    let env = this.env;
    if (cjsResolve)
      env = ['require', ...this.env.filter(env => env !== 'import')];

    // conditional resolution from env
    // does in-browser package resolution
    // index.js | index.json
    // main[.js|.json|.node|'']
    // 
    // Because of extension checks on CDN, we do .js|.json|.node FIRST (if not already one of those extensions)
    // all works out
    // exports are exact files
    // done
    const exports = {};
    if (pcfg.exports !== undefined && pcfg.exports !== null) {
      function allDotKeys (exports) {
        for (let p in exports) {
          if (p[0] !== '.')
            return false;
        }
        return true;
      }
      if (typeof pcfg.exports === 'string') {
        exports['.'] = pcfg.exports;
      }
      else if (!allDotKeys(pcfg.exports)) {
        exports['.'] = getExportsTarget(pcfg.exports, env);
      }
      else {
        for (const expt of Object.keys(pcfg.exports)) {
          exports[expt] = getExportsTarget(pcfg.exports[expt], env);
        }
      }
    }
    else {
      if (typeof pcfg.browser === 'string') {
        exports['.'] = pcfg.browser.startsWith('./') ? pcfg.browser : './' + pcfg.browser;
      }
      else if (typeof pcfg.main === 'string') {
        exports['.'] = pcfg.main.startsWith('./') ? pcfg.main : './' + pcfg.main;
      }
      if (typeof pcfg.browser === 'object') {
        for (const subpath of Object.keys(pcfg.browser)) {
          if (subpath.startsWith('./')) {
            if (exports['.'] === subpath)
              exports['.'] = pcfg.browser[subpath];
            exports[subpath] = pcfg.browser[subpath];
          }
          else {
            log('todo', `Non ./ subpaths in browser field: ${pcfg.name}.browser['${subpath}'] = ${pcfg.browser[subpath]}`);
          }
        }
      }
      if (!exports['./'])
        exports['./'] = './';
      if (!exports['.'])
        exports['.'] = '.';
    }
    this.resolvedExportsCache.set(pcfg, exports);
    return exports;
  }

  private async getPackageConfig (pkg: ExactPackage): Promise<PackageConfig> {
    const pkgStr = pkgToStr(pkg);
    let cached = this.pcfgs[pkgStr];
    if (cached) return cached;
    await (this.pcfgPromises[pkgStr] = this.pcfgPromises[pkgStr] || (async () => {
      const res = await fetch(`${pkgToLookupUrl(pkg)}/package.json`);
      switch (res.status) {
        case 200: case 304: break;
        case 404: throw new Error(`Package ${pkgStr} not found.`);
        default: throw new Error(`Invalid status code ${res.status} reading package config for ${pkgStr}. ${res.statusText}`);
      }
      this.pcfgs[pkgStr] = await res.json();
    })());
    return this.pcfgs[pkgStr];
  }

  private async getInstalledPackages (_pkg: { name: string, registry: string }): Promise<PackageInstallRange[]> {
    return [];
  }

  private getBestMatch (_pkg: PackageTarget): ExactPackage | undefined {
    return;
  }

  // if a version was elliminated, then it does the upgrade
  // it then returns the combined subpaths list for the orphaned packages
  private upgradePackagesTo (installed: PackageInstallRange[], pkg: ExactPackage): string[] | undefined {
    if (this.opts.lock) return;
    const pkgVersion = new Semver(pkg.version);
    let hasUpgrade = false;
    const upgradeSubpaths = new Set<string>();
    for (const version of new Set(installed.map(({ pkg }) => pkg.version))) {
      let hasVersionUpgrade = true;
      for (const { pkg, target } of installed) {
        if (pkg.version !== version) continue;
        // user out-of-version lock
        if (!this.opts.force && !target.ranges.some(range => range.has(pkg.version, true))) {
          hasVersionUpgrade = false;
          continue;
        }
        if (pkgVersion.lt(pkg.version) || !target.ranges.some(range => range.has(pkgVersion, true))) {
          hasVersionUpgrade = false;
          continue;
        }
      }
      if (hasVersionUpgrade) hasUpgrade = true;
      if (hasUpgrade || this.opts.latest) {
        for (const { pkg, install } of installed) {
          if (pkg.version !== version) continue;
          const pkgExports = this.setResolution(install, pkg);
          for (const subpath of Object.keys(pkgExports))
            upgradeSubpaths.add(subpath);
        }
      }
    }
    if (this.opts.latest) return [...upgradeSubpaths];
    return hasUpgrade ? [...upgradeSubpaths] : undefined;
  }

  private isNodeCorePeer (specifier: string) {
    return [
      'assert',
      'async_hooks',
      'buffer',
      'child_process',
      'cluster',
      'console',
      'constants',
      'crypto',
      'dgram',
      'dns',
      'domain',
      'events',
      'fs',
      'http',
      'http2',
      'https',
      'inspector',
      'module',
      'net',
      'os',
      'path',
      'perf_hooks',
      'process',
      'punycode',
      'querystring',
      'readline',
      'repl',
      'stream',
      'string_decoder',
      'sys',
      'timers',
      'tls',
      'tty',
      'url',
      'util',
      'vm',
      'worker_threads',
      'zlib'
    ].indexOf(specifier) !== -1;
  }

  async traceInstall (specifier: string, parentUrl: URL, cjsResolve: boolean) {
    log('trace', `${specifier} ${parentUrl}`);
    if (!isPlain(specifier)) {
      const resolvedUrl = new URL(specifier, parentUrl);
      return this.trace(resolvedUrl.href, cjsResolve, parentUrl);
    }

    const parsed = parsePkg(specifier);
    if (!parsed) throw new Error(`Invalid package name ${specifier}`);
    const { pkgName, subpath } = parsed;

    const parentPkg = parseCdnPkg(parentUrl);
    const pkgScope = parentPkg ? pkgToUrl(parentPkg, esmCdnUrl) + '/' : undefined;
    if (parentPkg && pkgScope) {
      const scopeMatches = getScopeMatches(parentUrl, this.map.scopes, this.mapBaseUrl);
      const pkgSubscopes = scopeMatches.filter(([, url]) => url.startsWith(pkgScope));
      // Subscope override
      // - if there is a match, we use it, unless forcing in which case skip and remove it
      if (pkgSubscopes.length) {
        throw new Error('TODO: Support custom user subscopes.');
      }
      // Not an existing install
      if (!this.installs.scopes[pkgScope]) {
        // Package scope override
        if (scopeMatches.some(([, url]) => !url.startsWith(pkgScope))) {
          throw new Error('TODO: Support custom user package scope scopes.');
        }
        // Flattened scope (including Self Resolve)
        if (this.installs.scopes[esmCdnUrl]) {
          throw new Error('TODO: Reading flattened scopes');
        }
        const userImportsMatch = getMapMatch(specifier, this.map.imports);
        if (userImportsMatch) {
          // Note: this must check it is not an existing install match first...
          throw new Error('TODO: Custom user import');
        }
      }
      // New / existing install
      const pcfg = await this.getPackageConfig(parentPkg);
      if (pkgName === pcfg.name && pcfg.exports !== null && pcfg.exports !== undefined) {
        // Very lazy self resolution implementation
        const target = new PackageTarget(parentPkg.version, parentPkg.name);
        return this.installPkg(pkgName, pkgScope, target, [subpath], cjsResolve, parentUrl);
      }
      if (pcfg.dependencies?.[pkgName]) {
        const target = new PackageTarget(pcfg.dependencies[pkgName], pkgName);
        return this.installPkg(pkgName, pkgScope, target, [subpath], cjsResolve, parentUrl);
      }
      if (pcfg.peerDependencies?.[pkgName]) {
        const target = new PackageTarget(pcfg.peerDependencies[pkgName], pkgName);
        return this.installPkg(pkgName, undefined, target, [subpath], cjsResolve, parentUrl);
      }
      if (pcfg.optionalDependencies?.[pkgName]) {
        const target = new PackageTarget(pcfg.optionalDependencies[pkgName], pkgName);
        return this.installPkg(pkgName, undefined, target, [subpath], cjsResolve, parentUrl);
      }
      // Self resolve patch
      // CDN TODO: we should be able to remove this with "exports" support always on CDN
      if (pkgName === pcfg.name) {
        const pkgExports = this.setResolution({ pkgName, pkgScope }, parentPkg);
        return this.tracePkg(parentPkg, [subpath], pkgExports, false, cjsResolve, parentUrl);
      }
      if (this.isNodeCorePeer(specifier) && subpath === '.') {
        const target = new PackageTarget('@jspm/core@2', pkgName);
        let pkg: ExactPackage = (!pkgScope && this.installs.scopes[pkgScope]?.[pkgName] || this.installs.imports[pkgName])?.pkg;
        const locked = pkg && (this.opts.lock || !matchesTarget(pkg, target));
        if (!locked) {
          const bestMatch = this.getBestMatch(target);
          const latest = await this.resolveLatestTarget(target, parentUrl);
          const installed = await this.getInstalledPackages(target);
          const upgradeSubpaths = this.upgradePackagesTo(installed, latest);
          pkg = upgradeSubpaths || !bestMatch || this.opts.latest ? latest : bestMatch;
        }
        const pkgExports = this.setResolution({ pkgName, pkgScope: undefined }, pkg);
        const exports = await this.resolveExports(pkg, await this.getPackageConfig(pkg));
        const pkgUrl = pkgToUrl(pkg, esmCdnUrl);
        pkgExports['.'] = locked && pkgExports['.'] || exports[`./nodelibs/${specifier}`] || './nodelibs/@empty.js';
        return this.trace(pkgUrl + pkgExports['.'].slice(1), cjsResolve, parentUrl);
      }
    }
    else {
      const userImportsMatch = getMapMatch(specifier, this.map.imports);
      const existingResolution = this.installs.imports[pkgName];
      if (userImportsMatch && existingResolution) {
        throw new Error(`TODO: deconflicting between user and resolution imports resolutions for ${specifier}`);
      }
      if (userImportsMatch) {
        const resolvedUrl = new URL((<string>this.map.imports[userImportsMatch]) + subpath.slice(1), this.mapBaseUrl);
        if (resolvedUrl.origin === 'https://dev.jspm.io')
          return this.install(resolvedUrl.pathname.slice(1), specifier);
        return this.trace(resolvedUrl.href, cjsResolve, parentUrl);
      }
      if (existingResolution) {
        return this.tracePkg(existingResolution.pkg, Object.keys(existingResolution.exports), existingResolution.exports, false, cjsResolve, parentUrl);
      }
      // No match -> we can auto install if we are within the package boundary, and able to write
      if (pkgName) {
        throw new Error(`TODO: Auto install of ${pkgName}, detecting package boudnary`);
      }
    }
    // default to installing the dependency from master
    console.warn(`Package ${specifier} not declared in package.json dependencies - installing from latest${importedFrom(parentUrl)}`);
    const target = new PackageTarget('*', pkgName);
    return this.installPkg(pkgName, pkgScope, target, [subpath], cjsResolve, parentUrl);
  }

  private async installPkg (pkgName: string, pkgScope: string | undefined, target: PackageTarget, subpaths: string[], cjsResolve: boolean, parentUrl?: URL): Promise<void> {
    let pkg: ExactPackage | undefined = (!pkgScope ? this.installs.imports[pkgName] : this.installs.scopes[pkgScope]?.[pkgName])?.pkg;
    const locked = pkg && (this.opts.lock || matchesTarget(pkg, target));
    if (!locked) {
      const bestMatch = this.getBestMatch(target);
      const latest = await this.resolveLatestTarget(target, parentUrl);
      const installed = await this.getInstalledPackages(target);
      const upgradeSubpaths = this.upgradePackagesTo(installed, latest);
      pkg = upgradeSubpaths || !bestMatch || this.opts.latest ? latest : bestMatch;
      log('install', `${pkgName} ${pkgToStr(pkg)}${pkgScope ? ' [' + pkgToStr(<ExactPackage>parseCdnPkg(new URL(pkgScope))) + ']' : ''}`);
      if (upgradeSubpaths) {
        for (const subpath of upgradeSubpaths || []) {
          if (subpaths.indexOf(subpath) === -1)
            subpaths.push(subpath);
        }
      }
    }
    const pkgExports = this.setResolution({ pkgName, pkgScope }, pkg);
    return this.tracePkg(pkg, subpaths, pkgExports, false, cjsResolve, parentUrl);
  }

  private async tracePkg (pkg: ExactPackage, subpaths: string[], pkgExports: Record<string, string>, exactSubpaths: boolean, cjsResolve: boolean, parentUrl?: URL) {
    await Promise.all(subpaths.map(async subpath => {
      const exports = await this.resolveExports(pkg, await this.getPackageConfig(pkg), cjsResolve);
      let exportMatch = getMapMatch(subpath, exports);
      
      if (exportMatch === undefined) {
        console.log((await this.getPackageConfig(pkg)).exports);
        console.log(`No package exports defined for ${subpath} in ${pkgToStr(pkg)}${importedFrom(parentUrl)}`);
        // Consider a non-encapsulated fallback?
        throw new Error(`No package exports defined for ${subpath} in ${pkgToStr(pkg)}${importedFrom(parentUrl)}`);
      }

      const exportTarget = exports[exportMatch];
      const subpathTrailer = subpath.slice(exportMatch.length);

      if (exactSubpaths)
        pkgExports[exportMatch + subpathTrailer] = exportTarget + subpathTrailer;
      else
        pkgExports[exportMatch] = exportTarget;


      const pkgUrl = pkgToUrl(pkg, esmCdnUrl);
      let resolvedUrl = pkgUrl + exportTarget.slice(1) + subpathTrailer;

      // with the resolved URL, check if there is an exports !cjs entry
      // and if so, jump into cjsResolve mode
      if (!cjsResolve && exports[exportTarget + subpathTrailer + '!cjs'])
        cjsResolve = true;

      /*let found = true;
      if (!resolvedUrl.endsWith('/') && !await exists(resolvedUrl)) {
        // this is now a custom "mapping"
        if (await exists(resolvedUrl + '.js')) {
          resolvedUrl = resolvedUrl + '.js';
          pkgExports[exportMatch + subpathTrailer] = '.' + resolvedUrl.slice(pkgUrl.length);
        }
        else if (await exists(resolvedUrl + '.json')) {
          resolvedUrl = resolvedUrl + '.json';
          pkgExports[exportMatch + subpathTrailer] = '.' + resolvedUrl.slice(pkgUrl.length);
        }
        else if (await exists(pkgToLookupUrl(pkg) + exportTarget.slice(1) + subpathTrailer + '/package.json')) {
          const pjson = await (await fetch(pkgToLookupUrl(pkg) + exportTarget.slice(1) + subpathTrailer + '/package.json')).json();
          if (pjson.main) {
            if (pjson.main.startsWith('../../'))
              throw new Error('TODO: double backtracking lol');
            else if (pjson.main.startsWith('../'))
              resolvedUrl = resolvedUrl.slice(0, resolvedUrl.lastIndexOf('/')) + pjson.main.slice(2);
            else if (pjson.main.startsWith('./'))
              resolvedUrl = resolvedUrl + pjson.main.slice(1);
            else
              resolvedUrl = resolvedUrl + '/' + pjson.main;
            if (!await exists(resolvedUrl)) {
              if (await exists(resolvedUrl + '.js')) {
                resolvedUrl = resolvedUrl + '.js';
                pkgExports[exportMatch + subpathTrailer] = '.' + resolvedUrl.slice(pkgUrl.length);
              }
              else if (await exists(resolvedUrl + '.json')) {
                resolvedUrl = resolvedUrl + '.json';
                pkgExports[exportMatch + subpathTrailer] = '.' + resolvedUrl.slice(pkgUrl.length);
              }
              else {
                found = false;
              }
            }
            else {
              pkgExports[exportMatch + subpathTrailer] = '.' + resolvedUrl.slice(pkgUrl.length);
            }
          }
          else if (await exists(resolvedUrl + '/index.js')) {
            resolvedUrl = resolvedUrl + '/index.js';
            pkgExports[exportMatch + subpathTrailer] = '.' + resolvedUrl.slice(pkgUrl.length);
          }
          else if (await exists(resolvedUrl + '/index.json')) {
            resolvedUrl = resolvedUrl + '/index.json';
            pkgExports[exportMatch + subpathTrailer] = '.' + resolvedUrl.slice(pkgUrl.length);
          }
          else {
            found = false;
          }
        }
        else if (await exists(resolvedUrl + '/index.js')) {
          resolvedUrl = resolvedUrl + '/index.js';
          pkgExports[exportMatch + subpathTrailer] = '.' + resolvedUrl.slice(pkgUrl.length);
        }
        else if (await exists(resolvedUrl + '/index.json')) {
          resolvedUrl = resolvedUrl + '/index.json';
          pkgExports[exportMatch + subpathTrailer] = '.' + resolvedUrl.slice(pkgUrl.length);
        }
        else {
          found = false;
        }
        if (!found)
          throw new Error(`Unable to resolve "${subpath}" in ${pkg.registry}:${pkg.name}@${pkg.version}${importedFrom(parentUrl)}`);
      }*/

      return this.trace(resolvedUrl, cjsResolve, parentUrl);
    }));
  }

  private async trace (resolvedUrl: string, cjsResolve: boolean, parentUrl?: URL) {
    if (this.tracedUrls[resolvedUrl]) return;
    if (resolvedUrl.endsWith('/')) {
      const pkg = parseCdnPkg(new URL(resolvedUrl));
      if (!pkg)
        throw new Error('TODO: subpath exports for non packages');
      const pcfg = await this.getPackageConfig(pkg);
      const exports = await this.resolveExports(pkg, pcfg);
      const subpaths: string[] = [];
      for (const expt of Object.keys(exports)) {
        if (!expt.startsWith('.' + pkg.path)) continue;
        if (expt.endsWith('/')) {
          throw new Error(`TODO: trace directory listing / trace package dependency deoptimizations, importing ${resolvedUrl}${importedFrom(parentUrl)}`);
        }
        else {
          subpaths.push(expt);
        }
      }
      await this.tracePkg(pkg, subpaths, exports, true, cjsResolve, parentUrl);
      return;
    }
    const tracedDeps: string[] = this.tracedUrls[resolvedUrl] = [];
    const { deps } = await analyze(resolvedUrl, parentUrl);
    const resolvedUrlObj = new URL(resolvedUrl);
    await Promise.all(deps.map(dep => {
      tracedDeps.push(dep);
      return this.traceInstall(dep, resolvedUrlObj, cjsResolve);
    }));
  }

  private async resolveLatestTarget (target: PackageTarget, parentUrl?: URL): Promise<ExactPackage> {
    const { registry, name, ranges } = target;

    // exact version optimization
    if (ranges.length === 1 && ranges[0].isExact && !ranges[0].version.tag)
      return { registry, name, version: ranges[0].version.toString() };

    const cache = this.resolveCache[target.registryName] = this.resolveCache[target.registryName] || {
      latest: null,
      majors: Object.create(null),
      minors: Object.create(null),
      tags: Object.create(null)
    };
    
    for (const range of ranges.reverse()) {
      if (range.isWildcard) {
        const lookup = await (cache.latest || (cache.latest = this.lookupRange(registry, name, '', parentUrl)));
        if (lookup)
          return lookup;
      }
      else if (range.isExact && range.version.tag) {
        const tag = range.version.tag;
        const lookup = await (cache.tags[tag] || (cache.tags[tag] = this.lookupRange(registry, name, tag, parentUrl)));
        if (lookup)
          return lookup;
      }
      else if (range.isMajor) {
        const major = range.version.major;
        const lookup = await (cache.majors[major] || (cache.majors[major] = this.lookupRange(registry, name, major, parentUrl)));
        if (lookup)
          return lookup;
      }
      else if (range.isStable) {
        const minor = `${range.version.major}.${range.version.minor}`;
        const lookup = await (cache.minors[minor] || (cache.minors[minor] = this.lookupRange(registry, name, minor, parentUrl)));
        if (lookup)
          return lookup;
      }
    }
    throw new Error(`Unable to resolve package ${registry}:${name} to "${ranges.join(' || ')}"${importedFrom(parentUrl)}`);
  }
  
  private async lookupRange (registry: string, name: string, range: string, parentUrl?: URL): Promise<ExactPackage | null> {
    const res = await fetch(pkgToLookupUrl({ registry, name, version: range }));
    switch (res.status) {
      case 304: case 200: return { registry, name, version: (await res.text()).trim() };
      case 404: return null;
      default: throw new Error(`Invalid status code ${res.status} looking up "${registry}:${name}" - ${res.statusText}${importedFrom(parentUrl)}`);
    }
  }
}
