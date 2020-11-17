import sver from 'sver';
const { Semver, SemverRange } = sver;
import { TraceMap, ImportMap } from './tracemap.js';
import { isPlain, baseUrl, importedFrom, isURL } from './utils.js';
import { fetch } from './fetch.js';
import { log } from './log.js';
import { ExactPackage, PackageConfig, PackageInstall, PackageTarget, pkgToUrl, ResolutionMap, resolutionsToImportMap, importMapToResolutions, pkgToStr, parsePkg, esmCdnUrl, parseCdnPkg, getMapMatch, getScopeMatches, PackageInstallRange, parseInstallTarget, analyze, getExportsTarget, pkgToLookupUrl, matchesTarget, nicePkgStr, getPackageBase, exists, derivePackageName } from './installtree.js';

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
  resolvedExportsCache = new Map<string, Record<string, string>>();

  completed = false;
  changed = false;

  initPromise: Promise<void>;

  constructor (map: TraceMap, opts: InstallOptions) {
    this.traceMap = map;
    this.mapBaseUrl = this.traceMap.baseUrl;
    this.opts = opts;

    if (this.opts.clean)
      this.opts.full = true;

    this.conditions = map.conditions;
    this.initPromise = (async () => {
      [this.installs, this.map] = await importMapToResolutions(this.traceMap.map, this.mapBaseUrl);
    })();
  }

  complete () {
    if (this.opts.depcache) {
      if (this.opts.clean) this.map.depcache = Object.create(null);
      for (const [url, deps] of Object.entries(this.tracedUrls)) {
        if (deps.length) this.map.depcache[url] = deps;
      }
    }

    this.traceMap.set(this.map);
    const newMap = resolutionsToImportMap(this.installs, this.opts.clean ? this.tracedMappings : null, this.opts.system || false);
    this.traceMap.extend(newMap);
    this.traceMap.rebase();
    this.traceMap.sort();

    if (this.opts.flatten) this.traceMap.flatten();

    this.completed = true;
  }

  async add (installTarget: string, pkgName?: string): Promise<void> {
    await this.initPromise;
    if (pkgName && pkgName.endsWith('/')) pkgName = pkgName.slice(0, -1);
    if (this.completed) throw new Error('New install instance needed.');
    // custom URL installs
    if (isURL(installTarget)) {
      let targetUrl = new URL(installTarget, this.pageBaseUrl);
      if (!installTarget.endsWith('/') && await exists(targetUrl.href + '/package.json'))
        targetUrl = new URL(installTarget + '/');
      const pkgUrl = await getPackageBase(targetUrl);
      const pkgExports = this.setResolution({
        pkgName: pkgName || (await this.getPackageConfig(pkgUrl)).name || derivePackageName(new URL(pkgUrl), targetUrl)
      }, pkgUrl);
      const pkgSubpath = targetUrl.href.slice(pkgUrl.length);
      const subpaths: Record<string, string> = Object.create(null);
      const exports = await this.resolveExports(pkgUrl, false);
      for (const expt of Object.keys(exports)) {
        if (expt.endsWith('!cjs')) continue;
        if (!expt.startsWith(pkgSubpath.length === 0 ? '.' : './' + pkgSubpath)) continue;
        if (expt.endsWith('/')) {
          throw new Error(`TODO: trace directory listing / trace package dependency deoptimizations`);
        }
        else {
          subpaths[expt] = expt;
        }
      }
      if (!Object.keys(subpaths).length) {
        pkgExports['.'] = './' + pkgSubpath;
        subpaths['.'] = '.';
      }
      await this.tracePkg(pkgUrl, subpaths, pkgExports, true, false);
      return;
    }
    // external package installs
    const { target, subpath } = parseInstallTarget(installTarget);
    const isAlias = pkgName && subpath;
    if (!pkgName) pkgName = target.name;
    const pkg = await this.resolveLatestTarget(target);
    log('install', `${pkgName} ${pkgToStr(pkg)}`);
    const install = { pkgName };
    const pkgExports = this.setResolution(install, pkgToUrl(pkg, esmCdnUrl));
    let subpaths;
    if (this.opts.installExports) {
      const pkgUrl = pkgToUrl(pkg, esmCdnUrl);
      const availableSubpaths = Object.fromEntries(Object.keys(await this.resolveExports(pkgUrl)).filter(key => !key.endsWith('!cjs')).map(key => [key, key]));
      subpaths = availableSubpaths;
    }
    else if (subpath === '.') {
      const pkgUrl = pkgToUrl(pkg, esmCdnUrl);
      const availableSubpaths = Object.fromEntries(Object.keys(await this.resolveExports(pkgUrl)).filter(key => !key.endsWith('!cjs')).map(key => [key, key]));
      if (!availableSubpaths[subpath])
        subpaths = availableSubpaths;
    }
    else if (subpath === './') {
      const pkgUrl = pkgToUrl(pkg, esmCdnUrl);
      const availableSubpaths = Object.fromEntries(Object.keys(await this.resolveExports(pkgUrl)).filter(key => !key.endsWith('!cjs')).map(key => [key, key]));
      if (!availableSubpaths[subpath])
        subpaths = availableSubpaths;
    }
    subpaths = subpaths || { [isAlias ? '.' : subpath]: subpath };
    for (const subpath of Object.keys(subpaths))
      this.tracedMappings.add(install.pkgName + subpath.slice(1));
    const pkgUrl = pkgToUrl(pkg, esmCdnUrl);
    await this.tracePkg(pkgUrl, subpaths, pkgExports, true, false);
  }

  setResolution (install: PackageInstall, pkgUrl: string): Record<string, string> {
    if (!install.pkgScope) {
      let resolutionMap = this.installs.imports[install.pkgName];
      if (resolutionMap)
        resolutionMap.pkgUrl = pkgUrl;
      else
        resolutionMap = this.installs.imports[install.pkgName] = { pkgUrl, exports: Object.create(null) };
      // TODO: make change detection actually work
      this.changed = true;
      return resolutionMap.exports;
    }
    else {
      const scope = this.installs.scopes[install.pkgScope] = this.installs.scopes[install.pkgScope] || Object.create(null);
      let resolutionMap = scope[install.pkgName];
      if (resolutionMap)
        resolutionMap.pkgUrl = pkgUrl;
      else
        resolutionMap = scope[install.pkgName] = { pkgUrl, exports: Object.create(null) };
      // TODO: make change detection actually work
      this.changed = true;
      return resolutionMap.exports;
    } 
  }

  async resolveExports (pkgUrl: string, cjsResolve = false): Promise<Record<string, string>> {
    const cached = this.resolvedExportsCache.get(pkgUrl);
    if (cached) return cached;

    let conditions = this.conditions;
    if (cjsResolve)
      conditions = ['require', ...this.conditions.filter(condition => condition !== 'import')];
    else
      conditions = ['import', ...this.conditions.filter(condition => condition !== 'require')];

    const pcfg = await this.getPackageConfig(pkgUrl);

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
    this.resolvedExportsCache.set(pkgUrl, exports);
    return exports;
  }

  async getPackageConfig (pkgUrl: string): Promise<PackageConfig> {
    if (!pkgUrl.endsWith('/'))
      throw new Error('Internal Error: Package URL must end in "/"');
    let cached = this.pcfgs[pkgUrl];
    if (cached) return cached;
    await (this.pcfgPromises[pkgUrl] = this.pcfgPromises[pkgUrl] || (async () => {
      const res = await fetch(`${pkgUrl}package.json`);
      switch (res.status) {
        case 200: case 304: break;
        case 404: return this.pcfgs[pkgUrl] = Object.create(null);
        default: throw new Error(`Invalid status code ${res.status} reading package config for ${pkgUrl}. ${res.statusText}`);
      }
      if (res.headers && !res.headers.get('Content-Type')?.match(/^application\/json(;|$)/))
        this.pcfgs[pkgUrl] = Object.create(null);
      else
        this.pcfgs[pkgUrl] = await res.json();
    })());
    return this.pcfgs[pkgUrl];
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
          const pkgExports = this.setResolution(install, pkgToUrl(pkg, esmCdnUrl));
          for (const subpath of Object.keys(pkgExports))
            upgradeSubpaths.add(subpath);
        }
      }
    }
    if (this.opts.latest) return [...upgradeSubpaths];
    return hasUpgrade ? [...upgradeSubpaths] : undefined;
  }

  isNodeCoreLib (specifier: string) {
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
    await this.initPromise;
    log('trace', `${specifier} ${parentUrl}`);
    if (!isPlain(specifier)) {
      const resolvedUrl = new URL(specifier, parentUrl);
      return this.trace(resolvedUrl.href, cjsResolve, parentUrl);
    }

    const parsed = parsePkg(specifier);
    if (!parsed) throw new Error(`Invalid package name ${specifier}`);
    const { pkgName, subpath } = parsed;

    const parentPkgUrl = await getPackageBase(parentUrl);

    if (!parentPkgUrl)
      throw new Error('Expected package base');

    // Subscope override
    const scopeMatches = getScopeMatches(parentUrl, this.map.scopes, this.mapBaseUrl);
    const pkgSubscopes = scopeMatches.filter(([, url]) => url.startsWith(parentPkgUrl));
    if (pkgSubscopes.length) {
      for (const [scope] of pkgSubscopes) {
        const mapMatch = getMapMatch(specifier, this.map.scopes[scope]);
        if (mapMatch) {
          this.tracedMappings.add(parentPkgUrl + '|' + specifier);
          const resolved = new URL(this.map.scopes[scope][mapMatch] + specifier.slice(mapMatch.length), this.mapBaseUrl).href;
          return this.trace(resolved, cjsResolve, parentUrl);
        }
      }
    }

    // Scope override
    const userScopeMatch = scopeMatches.find(([, url]) => url === parentPkgUrl);
    if (userScopeMatch) {
      const imports = this.map.scopes[userScopeMatch[0]];
      const userImportsMatch = getMapMatch(specifier, imports);
      const userImportsResolved = userImportsMatch ? new URL(imports[userImportsMatch] + specifier.slice(userImportsMatch.length), this.mapBaseUrl).href : null;
      if (userImportsResolved) {
        this.tracedMappings.add(parentPkgUrl + '|' + specifier);
        return this.trace(<string>userImportsResolved, cjsResolve, parentUrl);
      }
    }

    // Scope resolution
    if (this.installs.scopes[parentPkgUrl]) {
      const packages = this.installs.scopes[parentPkgUrl];
      const pkg = packages[pkgName];
      if (pkg) {
        if (pkg.pkgUrl.startsWith('node:'))
          return;
        const match = getMapMatch(subpath, pkg.exports);
        if (match) {
          this.tracedMappings.add(parentPkgUrl + '|' + specifier);
          const resolved = new URL(pkg.exports[match] + subpath.slice(match.length), pkg.pkgUrl).href;
          return this.trace(resolved, cjsResolve, parentUrl);
        }
      }
    }

    // User import overrides
    const userImportsMatch = getMapMatch(specifier, this.map.imports);
    const userImportsResolved = userImportsMatch ? new URL(this.map.imports[userImportsMatch] + specifier.slice(userImportsMatch.length), this.mapBaseUrl).href : null;
    if (userImportsResolved) {
      this.tracedMappings.add(parentPkgUrl + '|' + specifier);
      return this.trace(<string>userImportsResolved, cjsResolve, parentUrl);
    }

    // New install
    const pcfg = await this.getPackageConfig(parentPkgUrl);

    /* if (pkgName === pcfg.name && pcfg.exports !== null && pcfg.exports !== undefined) {
      const pkgExports = this.setResolution({ pkgName, pkgScope: parentPkgUrl }, parentPkgUrl);

      const subpaths: Record<string, string> = Object.create(null);
      const exports = await this.resolveExports(parentPkgUrl, cjsResolve);
      for (const expt of Object.keys(exports)) {
        if (expt.endsWith('!cjs')) continue;
        if (!expt.startsWith(subpath)) continue;
        if (expt.endsWith('/')) {
          throw new Error(`TODO: trace directory listing / trace package dependency deoptimizations`);
        }
        else {
          subpaths[expt] = expt;
        }
      }
      this.tracedMappings.add(parentPkgUrl + '|' + specifier);
      return this.tracePkg(parentPkgUrl, subpaths, pkgExports, true, false);
    }*/

    // exports "own name" resolution
    if (pkgName === pcfg.name && pcfg.exports) {
      const pkgExports = this.setResolution({ pkgName, pkgScope: parentPkgUrl }, parentPkgUrl);
      this.tracedMappings.add(parentPkgUrl + '|' + specifier);
      return this.tracePkg(parentPkgUrl, { [subpath]: subpath }, pkgExports, false, cjsResolve, parentUrl);
    }

    // package dependencies
    if (pcfg.dependencies?.[pkgName]) {
      const target = new PackageTarget(pcfg.dependencies[pkgName], pkgName);
      this.tracedMappings.add(parentPkgUrl + '|' + specifier);
      return this.installPkg(pkgName, parentPkgUrl, target, { [subpath]: subpath }, cjsResolve, parentUrl);
    }
    if (pcfg.peerDependencies?.[pkgName]) {
      const target = new PackageTarget(pcfg.peerDependencies[pkgName], pkgName);
      this.tracedMappings.add(specifier);
      return this.installPkg(pkgName, parentPkgUrl, target, { [subpath]: subpath }, cjsResolve, parentUrl);
    }
    if (pcfg.optionalDependencies?.[pkgName]) {
      const target = new PackageTarget(pcfg.optionalDependencies[pkgName], pkgName);
      this.tracedMappings.add(parentPkgUrl + '|' + specifier);
      return this.installPkg(pkgName, parentPkgUrl, target, { [subpath]: subpath }, cjsResolve, parentUrl);
    }

    // node.js core
    if (this.isNodeCoreLib(specifier) && subpath === '.') {
      const target = new PackageTarget('@jspm/core@2', pkgName);
      this.tracedMappings.add(parentPkgUrl + '|' + specifier);
      return this.installPkg(pkgName, parentPkgUrl, target, { '.': `./nodelibs/${specifier}` }, cjsResolve, parentUrl);
    }

    // local installs / peers
    // should this integrate with peerDependencies?
    if (parentUrl.origin === this.mapBaseUrl.origin) {
      const installPkg = this.installs.imports[pkgName];
      if (installPkg && installPkg.exports[subpath]) {
        const resolved = installPkg.pkgUrl + installPkg.exports[subpath].slice(2);
        this.tracedMappings.add(specifier);
        return this.trace(resolved, cjsResolve, parentUrl);
      }
    }

    // global install fallback
    console.warn(`Package ${specifier} not declared in package.json dependencies - installing from latest${importedFrom(parentUrl)}`);
    const target = new PackageTarget('*', pkgName);
    this.tracedMappings.add(parentPkgUrl + '|' + specifier);
    return this.installPkg(pkgName, parentPkgUrl, target, { [subpath]: subpath }, cjsResolve, parentUrl);
  }

  async installPkg (pkgName: string, pkgScope: string | undefined, target: PackageTarget, subpaths: Record<string, string>, cjsResolve: boolean, parentUrl?: URL): Promise<void> {
    let pkgUrl = (!pkgScope ? this.installs.imports[pkgName] : this.installs.scopes[pkgScope]?.[pkgName])?.pkgUrl;
    let pkg: ExactPackage | undefined = pkgUrl ? parseCdnPkg(pkgUrl) : undefined;
    const locked = pkg && (this.opts.lock || matchesTarget(pkg, target));
    if (!locked) {
      const bestMatch = this.getBestMatch(target);
      const latest = await this.resolveLatestTarget(target, parentUrl);
      const installed = await this.getInstalledPackages(target);
      const upgradeSubpaths = this.upgradePackagesTo(installed, latest);
      pkg = upgradeSubpaths || !bestMatch || this.opts.latest ? latest : bestMatch;
      pkgUrl = pkgToUrl(pkg, esmCdnUrl);
      log('install', `${pkgName} ${pkgUrl}${pkgScope ? ' [' + pkgScope + ']' : ''}`);
      if (upgradeSubpaths) {
        for (const subpath of upgradeSubpaths || []) {
          if (!subpaths[subpath])
            subpaths[subpath] = subpath;
        }
      }
    }
    const pkgExports = this.setResolution({ pkgName, pkgScope }, pkgUrl);
    return this.tracePkg(pkgUrl, subpaths, pkgExports, false, cjsResolve, parentUrl);
  }

  async tracePkg (pkgUrl: string, subpaths: Record<string, string>, pkgExports: Record<string, string | null>, exactSubpaths: boolean, cjsResolve: boolean, parentUrl?: URL) {
    if (!pkgUrl.endsWith('/'))
      throw new Error('Internal Error: Package URL should end in "/"');
    await Promise.all(Object.keys(subpaths).map(async subpath => {
      const subpathTarget = subpaths[subpath];

      let exports = pkgExports;
      let exportMatch = getMapMatch(subpathTarget, pkgExports);
      // if no exports -> lookup exports
      if (!exportMatch) {
        const pkgExports = await this.resolveExports(pkgUrl, cjsResolve);
        exportMatch = getMapMatch(subpathTarget, pkgExports);
        if (exportMatch)
          exports = pkgExports;
      }

      if (!exportMatch) {
        console.log((await this.getPackageConfig(pkgUrl)).exports);
        console.log(`No package exports defined for ${subpathTarget} in ${nicePkgStr(pkgUrl)}${importedFrom(parentUrl)}`);
        // Consider a non-encapsulated fallback?
        pkgExports[subpath] = null;
        return;
        throw new Error(`No package exports defined for ${subpathTarget} in ${nicePkgStr(pkgUrl)}${importedFrom(parentUrl)}`);
      }

      const exportTarget = exports[exportMatch];

      if (exportTarget === null)
        return;

      const subpathTrailer = subpathTarget.slice(exportMatch.length);

      if (exactSubpaths)
        pkgExports[subpath] = exportTarget + subpathTrailer;
      else
        pkgExports[subpath] = exportTarget;

      let resolvedUrl = pkgUrl + exportTarget.slice(2) + subpathTrailer;

      // with the resolved URL, check if there is an exports !cjs entry
      // and if so, jump into cjsResolve mode
      if (!cjsResolve && exports[exportTarget + subpathTrailer + '!cjs'])
        cjsResolve = true;

      return this.trace(resolvedUrl, cjsResolve, parentUrl);
    }));
  }

  async trace (resolvedUrl: string, cjsResolve: boolean, parentUrl?: URL) {
    if (this.tracedUrls[resolvedUrl]) return;
    if (resolvedUrl.endsWith('/')) {
      const pkgUrl = await getPackageBase(new URL(resolvedUrl));
      const pkgSubpath = new URL(resolvedUrl).href.slice(pkgUrl.length);
      const exports = await this.resolveExports(pkgUrl);
      const subpaths: Record<string, string> = Object.create(null);
      for (const expt of Object.keys(exports)) {
        if (expt.endsWith('!cjs')) continue;
        if (!expt.startsWith(pkgSubpath.length === 0 ? '.' : './' + pkgSubpath)) continue;
        if (expt.endsWith('/')) {
          console.log(`TODO: trace directory listing / trace package dependency deoptimizations, importing ${resolvedUrl}${importedFrom(parentUrl)}`);
          return;
        }
        else {
          subpaths[expt] = expt;
        }
      }
      await this.tracePkg(pkgUrl, subpaths, exports, true, cjsResolve, parentUrl);
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
