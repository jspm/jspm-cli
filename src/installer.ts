import sver from 'sver';
const { Semver, SemverRange } = sver;
import { TraceMap, ImportMap } from './tracemap.js';
import { isPlain, baseUrl, sort, importedFrom, isURL } from './utils.js';
import { fetch } from './fetch.js';
import { log } from './log.js';
import { ExactPackage, PackageConfig, PackageInstall, PackageTarget, pkgToUrl, ResolutionMap, resolutionsToImportMap, importMapToResolutions, pkgToStr, parsePkg, esmCdnUrl, systemCdnUrl, parseCdnPkg, getMapMatch, getScopeMatches, PackageInstallRange, parseInstallTarget, analyze, getExportsTarget, pkgToLookupUrl, matchesTarget } from './installtree.js';

export type Semver = any;
export type SemverRange = any;

export interface InstallOptions {
  // whether existing resolutions should be locked
  lock?: boolean;
  // force use latest versions for everything
  latest?: boolean;
  // whether to trace known mappings as well
  // (implied by clean)
  full?: boolean;
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
  conditions: string[];
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
  tracedMappings = new Set<string>();
  resolvedExportsCache = new WeakMap<PackageConfig, Record<string, string>>();

  completed = false;

  constructor (map: TraceMap, opts: InstallOptions) {
    this.traceMap = map;
    this.mapBaseUrl = this.traceMap.baseUrl;
    this.opts = opts;

    if (this.opts.clean)
      this.opts.full = true;

    this.conditions = map.conditions;
  
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
    const newMap = sort(resolutionsToImportMap(this.installs, this.opts.system ? systemCdnUrl : esmCdnUrl, this.opts.clean ? this.tracedMappings : null));
    this.traceMap.extend(newMap);

    if (this.opts.flatten) this.traceMap.flatten();

    this.completed = true;
  }

  async add (installTarget: string, pkgName?: string): Promise<void> {
    if (pkgName && pkgName.endsWith('/')) pkgName = pkgName.slice(0, -1);
    if (this.completed) throw new Error('New install instance needed.');
    // local / custom URL installs
    if (installTarget.startsWith('./') || installTarget.startsWith('../') || isURL(installTarget)) {
      const targetUrl = new URL(installTarget, this.pageBaseUrl);
      await this.trace(targetUrl.href, false, this.pageBaseUrl);
      // only define in import map if "explicit"
      if (pkgName)
        this.map.imports[pkgName] = this.traceMap.baseUrlRelative(targetUrl);
      return;
    }
    // external package installs
    const { target, subpath } = parseInstallTarget(installTarget);
    const isAlias = pkgName && subpath;
    if (!pkgName) pkgName = target.name;
    const pkg = await this.resolveLatestTarget(target);
    log('install', `${pkgName} ${pkgToStr(pkg)}`);
    const install = { pkgName };
    const pkgExports = this.setResolution(install, pkg);
    let subpaths;
    if (this.opts.installExports) {
      const pcfg = await this.getPackageConfig(pkg);
      const availableSubpaths = Object.fromEntries(Object.keys(await this.resolveExports(pkg, pcfg)).filter(key => !key.endsWith('!cjs')).map(key => [key, key]));
      subpaths = availableSubpaths;
    }
    else if (subpath === '.') {
      const pcfg = await this.getPackageConfig(pkg);
      const availableSubpaths = Object.fromEntries(Object.keys(await this.resolveExports(pkg, pcfg)).filter(key => !key.endsWith('!cjs')).map(key => [key, key]));
      if (!availableSubpaths[subpath])
        subpaths = availableSubpaths;
    }
    else if (subpath === './') {
      const pcfg = await this.getPackageConfig(pkg);
      const availableSubpaths = Object.fromEntries(Object.keys(await this.resolveExports(pkg, pcfg)).filter(key => !key.endsWith('!cjs')).map(key => [key, key]));
      if (!availableSubpaths[subpath])
        subpaths = availableSubpaths;
    }
    subpaths = subpaths || { [isAlias ? '.' : subpath]: subpath };
    for (const subpath of Object.keys(subpaths))
      this.tracedMappings.add(install.pkgName + subpath.slice(1));
    await this.tracePkg(pkg, subpaths, pkgExports, true, false);
  }

  setResolution (install: PackageInstall, pkg: ExactPackage): Record<string, string> {
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
  async resolveExports (_pkg: ExactPackage, pcfg: PackageConfig, cjsResolve = false): Promise<Record<string, string>> {
    const cached = this.resolvedExportsCache.get(pcfg);
    if (cached) return cached;

    let conditions = this.conditions;
    if (cjsResolve)
      conditions = ['require', ...this.conditions.filter(condition => condition !== 'import')];
    else
      conditions = ['import', ...this.conditions.filter(condition => condition !== 'require')];

    // conditional resolution from conditions
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
        exports['.'] = getExportsTarget(pcfg.exports, conditions);
      }
      else {
        for (const expt of Object.keys(pcfg.exports)) {
          exports[expt] = getExportsTarget(pcfg.exports[expt], conditions);
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

  async getPackageConfig (pkg: ExactPackage): Promise<PackageConfig> {
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

  async getInstalledPackages (_pkg: { name: string, registry: string }): Promise<PackageInstallRange[]> {
    return [];
  }

  getBestMatch (_pkg: PackageTarget): ExactPackage | undefined {
    return;
  }

  // if a version was elliminated, then it does the upgrade
  // it then returns the combined subpaths list for the orphaned packages
  upgradePackagesTo (installed: PackageInstallRange[], pkg: ExactPackage): string[] | undefined {
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

  isNodeCorePeer (specifier: string) {
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
      this.tracedMappings.add(pkgScope.slice(esmCdnUrl.length) + '|' + specifier);
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
        return this.installPkg(pkgName, pkgScope, target, { [subpath]: subpath }, cjsResolve, parentUrl);
      }
      if (pcfg.dependencies?.[pkgName]) {
        const target = new PackageTarget(pcfg.dependencies[pkgName], pkgName);
        return this.installPkg(pkgName, pkgScope, target, { [subpath]: subpath }, cjsResolve, parentUrl);
      }
      if (pcfg.peerDependencies?.[pkgName]) {
        const target = new PackageTarget(pcfg.peerDependencies[pkgName], pkgName);
        this.tracedMappings.add(pkgScope.slice(esmCdnUrl.length));
        return this.installPkg(pkgName, undefined, target, { [subpath]: subpath }, cjsResolve, parentUrl);
      }
      if (pcfg.optionalDependencies?.[pkgName]) {
        const target = new PackageTarget(pcfg.optionalDependencies[pkgName], pkgName);
        this.tracedMappings.add(pkgScope.slice(esmCdnUrl.length));
        return this.installPkg(pkgName, undefined, target, { [subpath]: subpath }, cjsResolve, parentUrl);
      }
      // Self resolve patch
      // CDN TODO: we should be able to remove this with "exports" support always on CDN
      if (pkgName === pcfg.name) {
        const pkgExports = this.setResolution({ pkgName, pkgScope }, parentPkg);
        return this.tracePkg(parentPkg, { [subpath]: subpath }, pkgExports, false, cjsResolve, parentUrl);
      }
      if (this.isNodeCorePeer(specifier) && subpath === '.') {
        this.tracedMappings.add(pkgScope.slice(esmCdnUrl.length));
        const target = new PackageTarget('@jspm/core@2', pkgName);
        let pkg: ExactPackage = (pkgScope && this.installs.scopes[pkgScope]?.[pkgName] || this.installs.imports[pkgName])?.pkg;
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

      console.warn(`Package ${specifier} not declared in package.json dependencies - installing from latest${importedFrom(parentUrl)}`);
      const target = new PackageTarget('*', pkgName);
      return this.installPkg(pkgName, pkgScope, target, { [subpath]: subpath }, cjsResolve, parentUrl);
    }
    else {
      this.tracedMappings.add(specifier);
      const userImportsMatch = getMapMatch(specifier, this.map.imports);
      const existingResolution = this.installs.imports[pkgName];
      if (userImportsMatch && existingResolution) {
        throw new Error(`TODO: deconflicting between user and resolution imports resolutions for ${specifier}`);
      }
      if (userImportsMatch) {
        const resolvedUrl = new URL((<string>this.map.imports[userImportsMatch]) + subpath.slice(1 + Number(userImportsMatch.endsWith('/'))), this.mapBaseUrl);
        if (resolvedUrl.origin === 'https://jspm.dev') {
          delete this.map.imports[userImportsMatch];
          return this.add(resolvedUrl.pathname.slice(1), specifier);
        }
        return this.trace(resolvedUrl.href, cjsResolve, parentUrl);
      }
      if (existingResolution) {
        return this.tracePkg(existingResolution.pkg, Object.fromEntries(Object.keys(existingResolution.exports).map(key => [key, key])), existingResolution.exports, false, cjsResolve, parentUrl);
      }

      if (this.isNodeCorePeer(specifier) && subpath === '.') {
        const target = new PackageTarget('@jspm/core@2', pkgName);
        let pkg: ExactPackage = (pkgScope && this.installs.scopes[pkgScope]?.[pkgName] || this.installs.imports[pkgName])?.pkg;
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

      // No match -> we can auto install if we are within the package boundary, and able to write
      if (pkgName) {
        const target = new PackageTarget('*', pkgName);
        return this.installPkg(pkgName, pkgScope, target, { [subpath]: subpath }, cjsResolve, parentUrl);
      }
      
      throw new Error(`TODO: Can this branch ever happen?`);
    }
  }

  async installPkg (pkgName: string, pkgScope: string | undefined, target: PackageTarget, subpaths: Record<string, string>, cjsResolve: boolean, parentUrl?: URL): Promise<void> {
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
          if (!subpaths[subpath])
            subpaths[subpath] = subpath;
        }
      }
    }
    const pkgExports = this.setResolution({ pkgName, pkgScope }, pkg);
    return this.tracePkg(pkg, subpaths, pkgExports, false, cjsResolve, parentUrl);
  }

  async tracePkg (pkg: ExactPackage, subpaths: Record<string, string>, pkgExports: Record<string, string>, exactSubpaths: boolean, cjsResolve: boolean, parentUrl?: URL) {
    await Promise.all(Object.keys(subpaths).map(async subpath => {
      const subpathTarget = subpaths[subpath];

      let exports = pkgExports;
      let exportMatch = getMapMatch(subpathTarget, pkgExports);
      // if no exports -> lookup exports
      if (!exportMatch) {
        const pkgExports = await this.resolveExports(pkg, await this.getPackageConfig(pkg), cjsResolve);
        exportMatch = getMapMatch(subpathTarget, pkgExports);
        if (exportMatch)
          exports = pkgExports;
      }
      
      if (!exportMatch) {
        console.log((await this.getPackageConfig(pkg)).exports);
        console.log(`No package exports defined for ${subpathTarget} in ${pkgToStr(pkg)}${importedFrom(parentUrl)}`);
        // Consider a non-encapsulated fallback?
        throw new Error(`No package exports defined for ${subpathTarget} in ${pkgToStr(pkg)}${importedFrom(parentUrl)}`);
      }
      
      const exportTarget = exports[exportMatch];

      const subpathTrailer = subpathTarget.slice(exportMatch.length);

      if (exactSubpaths)
        pkgExports[subpath] = exportTarget + subpathTrailer;
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

  async trace (resolvedUrl: string, cjsResolve: boolean, parentUrl?: URL) {
    if (this.tracedUrls[resolvedUrl]) return;
    if (resolvedUrl.endsWith('/')) {
      const pkg = parseCdnPkg(new URL(resolvedUrl));
      if (!pkg)
        throw new Error('TODO: subpath exports for non packages');
      const pcfg = await this.getPackageConfig(pkg);
      const exports = await this.resolveExports(pkg, pcfg);
      const subpaths: Record<string, string> = Object.create(null);
      for (const expt of Object.keys(exports)) {
        if (expt.endsWith('!cjs')) continue;
        if (!expt.startsWith('.' + pkg.path)) continue;
        if (expt.endsWith('/')) {
          throw new Error(`TODO: trace directory listing / trace package dependency deoptimizations, importing ${resolvedUrl}${importedFrom(parentUrl)}`);
        }
        else {
          subpaths[expt] = expt;
        }
      }
      await this.tracePkg(pkg, subpaths, exports, true, cjsResolve, parentUrl);
      return;
    }
    const tracedDeps: string[] = this.tracedUrls[resolvedUrl] = [];
    const { deps, dynamicDeps, /*integrity*/ } = await analyze(resolvedUrl, parentUrl, resolvedUrl.startsWith(esmCdnUrl) ? false : this.opts.system);
    // TODO: install integrity
    // this.map.integrity[resolvedUrl] = integrity;
    if (dynamicDeps.length) {
      for (const dep of dynamicDeps) {
        if (deps.indexOf(dep) === -1)
          deps.push(dep);
      }
    }
    const resolvedUrlObj = new URL(resolvedUrl);
    await Promise.all(deps.map(dep => {
      tracedDeps.push(dep);
      return this.traceInstall(dep, resolvedUrlObj, cjsResolve);
    }));
  }

  async resolveLatestTarget (target: PackageTarget, parentUrl?: URL): Promise<ExactPackage> {
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
  
  async lookupRange (registry: string, name: string, range: string, parentUrl?: URL): Promise<ExactPackage | null> {
    const res = await fetch(pkgToLookupUrl({ registry, name, version: range }));
    switch (res.status) {
      case 304: case 200: return { registry, name, version: (await res.text()).trim() };
      case 404: return null;
      default: throw new Error(`Invalid status code ${res.status} looking up "${registry}:${name}" - ${res.statusText}${importedFrom(parentUrl)}`);
    }
  }
}
