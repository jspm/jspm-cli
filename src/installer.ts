import sver from 'sver';
const { Semver, SemverRange } = sver;
import { TraceMap, ImportMap } from './tracemap.js';
import { isPlain, baseUrl } from './utils.js';
import { fetch } from './fetch.js';
import lexer from 'es-module-lexer';
import { log } from './log.js';
import { ExactPackage, PackageConfig, PackageInstall, PackageTarget, pkgToUrl, ResolutionMap, resolutionsToImportMap, importMapToResolutions, pkgToStr, parsePkg, parseCdnPkg, getMapMatch, getScopeMatches, cdnUrl, PackageInstallRange, parseInstallTarget } from './installtree.js';

export type Semver = any;
export type SemverRange = any;

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
  // whether to log the full install trace as it happens
  traceLog?: boolean;
};

export class Installer {
  traceMap: TraceMap;

  mapBaseUrl: URL;
  pageBaseUrl: URL = baseUrl;
  env: string[];
  installs: ResolutionMap;
  map: ImportMap;

  resolveCache: Record<string, {
    latest: Promise<ExactPackage>;
    majors: Record<string, Promise<ExactPackage>>;
    minors: Record<string, Promise<ExactPackage>>;
    tags: Record<string, Promise<ExactPackage>>;
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
    [this.installs, this.map] = importMapToResolutions(this.traceMap.map, this.mapBaseUrl, opts);
  }

  complete () {
    if (this.opts.depcache) {
      if (this.opts.clean) this.map.depcache = Object.create(null);
      for (const [url, deps] of Object.entries(this.tracedUrls)) {
        if (deps.length) this.map.depcache[url] = deps;
      }
    }

    this.traceMap.set(this.map);
    this.traceMap.extend(resolutionsToImportMap(this.installs));

    if (this.opts.flatten) this.traceMap.flatten();
    this.traceMap.sort();

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
    let subpaths = [subpath];
    if (this.opts.installExports) {
      const pcfg = await this.getPackageConfig(pkg);
      subpaths = Object.keys(this.resolveExports(pcfg));
    }
    await this.tracePkg(pkg, subpaths, pkgExports, true);
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
  private resolveExports (pcfg: PackageConfig): Record<string, string> {
    const cached = this.resolvedExportsCache.get(pcfg);
    if (cached) return cached;
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
    if (typeof pcfg.browser === 'object') {
      for (const subpath of Object.keys(pcfg.browser)) {
        if (subpath.startsWith('./')) {
          exports[subpath] = pcfg.browser[subpath];
        }
        else {
          log('todo', `Non ./ subpaths in browser field: ${pcfg.name}.browser['${subpath}'] = ${pcfg.browser[subpath]}`);
        }
      }
    }
    
    // TODO: Proper main checking for index mains...
    if (typeof pcfg.browser === 'string') {
      exports['.'] = pcfg.browser.startsWith('./') ? pcfg.browser : './' + pcfg.browser;
    }
    else if (typeof pcfg.main === 'string') {
      exports['.'] = pcfg.main.startsWith('./') ? pcfg.main : './' + pcfg.main;
    }
    if (typeof pcfg.exports === 'undefined' || pcfg.exports === null) {
      exports['./'] = './';
    }
    else {
      throw new Error('TODO: Exports resolution');
    }
    this.resolvedExportsCache.set(pcfg, exports);
    return exports;
  }

  private async getPackageConfig (pkg: ExactPackage): Promise<PackageConfig> {
    const pkgStr = pkgToStr(pkg);
    let cached = this.pcfgs[pkgStr];
    if (cached) return cached;
    await (this.pcfgPromises[pkgStr] = this.pcfgPromises[pkgStr] || (async () => {
      const res = await fetch(`${pkgToUrl(pkg)}/package.json`);
      switch (res.status) {
        case 200: break;
        case 404: throw new Error(`No package.json defined for ${pkgStr}`);;
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
        if (!this.opts.force && !target.range.has(pkg.version, true)) {
          hasVersionUpgrade = false;
          continue;
        }
        if (pkgVersion.lt(pkg.version) || !target.range.has(pkgVersion, true)) {
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
      '@empty',
      '@empty.dew',
      'assert',
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
      'module',
      'net',
      'os',
      'path',
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

  async traceInstall (specifier: string, parentUrl: URL) {
    log('trace', `${specifier} ${parentUrl}`);
    if (parentUrl.origin === 'https://dev.jspm.io') {
      // latest -> cdn
      throw new Error('TODO: dev conversion');
    }
    if (!isPlain(specifier)) {
      const resolvedUrl = new URL(specifier, parentUrl);
      return this.trace(resolvedUrl.href, parentUrl);
    }

    const parsed = parsePkg(specifier);
    if (!parsed) throw new Error(`Invalid package name ${specifier}`);
    const { pkgName, subpath } = parsed;

    const parentPkg = parseCdnPkg(parentUrl);

    if (parentPkg) {
      const pkgScope = pkgToUrl(parentPkg) + '/';
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
        if (this.installs.scopes[cdnUrl]) {
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
        throw new Error('TODO: package name self-resolution');
      }
      if (pcfg.dependencies?.[pkgName]) {
        const target = new PackageTarget(pcfg.dependencies[pkgName], pkgName);
        return this.installPkg(pkgName, pkgScope, target, [subpath], parentUrl);
      }
      if (pcfg.peerDependencies?.[pkgName]) {
        const target = new PackageTarget(pcfg.peerDependencies[pkgName], pkgName);
        return this.installPkg(pkgName, undefined, target, [subpath], parentUrl);
      }
      if (pcfg.optionalDependencies?.[pkgName]) {
        const target = new PackageTarget(pcfg.optionalDependencies[pkgName], pkgName);
        return this.installPkg(pkgName, undefined, target, [subpath], parentUrl);
      }
      // Self resolve patch
      // CDN TODO: we should be able to remove this with "exports" support always on CDN
      if (pkgName === pcfg.name) {
        const pkgExports = this.setResolution({ pkgName, pkgScope }, parentPkg);
        return this.tracePkg(parentPkg, [subpath], pkgExports, false, parentUrl);
      }
      // CDN TODO: buffer and process should be @jspm/core/buffer and @jspm/core/process, with it as a enforced peerDependency
      if (this.isNodeCorePeer(specifier) && subpath === '.') {
        // exceptions...
        const target = new PackageTarget('@jspm/core@1', pkgName);
        let pkg: ExactPackage = (!pkgScope ? this.installs.imports[pkgName] : this.installs.scopes[pkgScope]?.[pkgName])?.pkg;
        if (!this.opts.lock || !pkg) {
          const bestMatch = this.getBestMatch(target);
          const latest = await this.resolveLatestTarget(target);
          const installed = await this.getInstalledPackages(target);
          const upgradeSubpaths = this.upgradePackagesTo(installed, latest);
          pkg = upgradeSubpaths || !bestMatch || this.opts.latest ? latest : bestMatch;
        }
        const pkgExports = this.setResolution({ pkgName, pkgScope: undefined }, pkg);
        const pkgUrl = pkgToUrl(pkg);
        const toPath = `./nodelibs/${specifier}.js`;
        pkgExports['.'] = toPath;
        return this.trace(pkgUrl + toPath.slice(1), parentUrl);
      }
    }
    else {
      const userImportsMatch = getMapMatch(specifier, this.map.imports);
      const existingResolution = this.installs.imports[pkgName];
      if (userImportsMatch && existingResolution) {
        throw new Error(`TODO: deconflicting between user and resolution imports resolutions for ${specifier}`);
      }
      if (userImportsMatch) {
        return this.trace(new URL((<string>this.map.imports[userImportsMatch]) + subpath.slice(1), this.mapBaseUrl).href, parentUrl);
      }
      if (existingResolution) {
        return this.tracePkg(existingResolution.pkg, Object.keys(existingResolution.exports), existingResolution.exports, false, parentUrl);
      }
      // No match -> we can auto install if we are within the package boundary, and able to write
      if (pkgName) {
        throw new Error(`TODO: Auto install of ${pkgName}, detecting package boudnary`);
      }
    }
    throw new Error(`Package dependency ${specifier} not found, imported from ${parentUrl.href}`);
  }

  private async installPkg (pkgName: string, pkgScope: string | undefined, target: PackageTarget, subpaths: string[], parentUrl?: URL): Promise<void> {
    let pkg: ExactPackage | undefined = (!pkgScope ? this.installs.imports[pkgName] : this.installs.scopes[pkgScope]?.[pkgName])?.pkg;
    if (!this.opts.lock || !pkg) {
      const bestMatch = this.getBestMatch(target);
      const latest = await this.resolveLatestTarget(target);
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
    return this.tracePkg(pkg, subpaths, pkgExports, false, parentUrl);
  }

  private async tracePkg (pkg: ExactPackage, subpaths: string[], pkgExports: Record<string, string>, exactSubpaths: boolean, parentUrl?: URL) {
    let exports: Record<string, string> | undefined;
    await Promise.all(subpaths.map(async subpath => {
      let exportMatch = getMapMatch(subpath, pkgExports);
      let exportTarget = exportMatch && pkgExports[exportMatch];
      if (!exportMatch) {
        exports = exports || this.resolveExports(await this.getPackageConfig(pkg));
        exportMatch = getMapMatch(subpath, exports);
        if (exportMatch === undefined) {
          throw new Error(`No package exports defined for ${subpath} in ${pkgToStr(pkg)}${parentUrl ? `, imported from ${parentUrl.href}` : ''}`);
        }
        exportTarget = exports[exportMatch];
        if (!exactSubpaths) pkgExports[exportMatch] = exportTarget;
      }
      if (!exportTarget) throw new Error('Internal error');
      if (exactSubpaths)
        pkgExports[exportMatch + subpath.slice(exportMatch.length)] = exportTarget + subpath.slice(exportMatch.length);
      const pkgUrl = pkgToUrl(pkg);
      return this.trace(pkgUrl + exportTarget.slice(1) + subpath.slice(exportMatch.length), parentUrl);
    }));
  }

  private async trace (resolvedUrl: string, parentUrl?: URL) {
    if (this.tracedUrls[resolvedUrl]) return;
    if (resolvedUrl.endsWith('/')) {
      throw new Error('TODO: Full package deoptimization in tracing.');
    }
    const deps: string[] = this.tracedUrls[resolvedUrl] = [];
    const res = await fetch(resolvedUrl);
    switch (res.status) {
      case 200: break;
      case 404: throw new Error(`Module not found: ${resolvedUrl}${parentUrl ? `, imported from ${parentUrl.href}` : ''}`);
      default: throw new Error(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
    }
    let source = await res.text();
    try {
      var [imports] = await lexer.parse(source);
    }
    catch (e) {
      // fetch is _unstable_!!!
      // so we retry the fetch first
      const res = await fetch(resolvedUrl);
      switch (res.status) {
        case 200: break;
        case 404: throw new Error(`Module not found: ${resolvedUrl}${parentUrl ? `, imported from ${parentUrl.href}` : ''}`);
        default: throw new Error(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
      }
      source = await res.text();
      try {
        var [imports] = await lexer.parse(source);
      }
      catch (e) {
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
    // dynamic import -> deoptimize trace all dependencies (and all their exports)
    if (imports.some(impt => impt.d >= 0)) {
      throw new Error('TODO: Dynamic import trace deoptimization');
    }
    for (const impt of imports) {
      if (impt.d === -1)
        deps.push(source.slice(impt.s, impt.e));
    }
    const resolvedUrlObj = new URL(resolvedUrl);
    await Promise.all(deps.map(dep => {
      return this.traceInstall(dep, resolvedUrlObj);
    }));
  }

  private async resolveLatestTarget (target: PackageTarget): Promise<ExactPackage> {
    const { registry, name, range } = target;

    // exact version optimization
    if (range.isExact && !range.version.tag)
      return { registry, name, version: range.version.toString() };

    const cache = this.resolveCache[target.registryName] = this.resolveCache[target.registryName] || {
      latest: null,
      majors: Object.create(null),
      minors: Object.create(null),
      tags: Object.create(null)
    };
    
    if (range.isWildcard) {
      if (cache.latest) return cache.latest;
      return cache.latest = this.lookupRange(registry, name, '');
    }
    else if (range.isExact && range.version.tag) {
      const tag = range.version.tag;
      if (cache.tags[tag]) return cache.tags[tag];
      return cache.tags[tag] = this.lookupRange(registry, name, tag);
    }
    else if (range.isMajor) {
      const major = range.version.major;
      if (cache.majors[major]) return cache.majors[major];
      return cache.majors[major] = this.lookupRange(registry, name, major);
    }
    else if (range.isStable) {
      const minor = `${range.version.major}.${range.version.minor}`;
      if (cache.minors[minor]) return cache.minors[minor];
      return cache.minors[minor] = this.lookupRange(registry, name, minor);
    }
    throw new Error('Internal error.');
  }
  
  private async lookupRange (registry: string, name: string, range: string): Promise<ExactPackage> {
    const pkgUrl = `https://cdn.jspm.io/${registry}:${name}`;
    const res = await fetch(`${pkgUrl}${range ? '@' + range : ''}/package.json`);
    switch (res.status) {
      case 200: break;
      case 404: throw new Error(`Unable to find a resolution for ${registry}:${name}${range ? '@' + range : ''}`);
      default: throw new Error(`Invalid status code ${res.status} looking up ${registry}:${name}. ${res.statusText}`);
    }
    const version = res.url.slice(pkgUrl.length + 1, res.url.indexOf('/', pkgUrl.length + 1));

    const pjson = await res.json();
    if (!this.pcfgPromises[pkgToStr({ registry, name, version })])
      this.pcfgs[pkgToStr({ registry, name, version })] = pjson;

    return { registry, name, version };
  }
}
