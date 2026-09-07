import { PackageConfig, ExportsTarget, trimPackageConfig } from '../install/package.js';
import { JspmError } from '../common/err.js';
// @ts-ignore
import { fetch, isVirtualUrl } from '../common/fetch.js';
import { importedFrom, isFetchProtocol } from '../common/url.js';
// @ts-ignore
import { parse } from 'es-module-lexer/js';
import type { InstallTarget, PackageTarget } from '../generator.js';
import { getMapMatch, allDotKeys, getWildcardPrefixes } from '../common/package.js';
import { builtinSchemes, mappableSchemes, ProviderManager } from '../providers/index.js';
import {
  Analysis,
  createSystemAnalysis,
  createCjsAnalysis,
  createEsmAnalysis,
  createTsAnalysis
} from './analysis.js';
import { Installer } from '../install/installer.js';
import { SemverRange } from 'sver';
import { getIntegrity } from '../common/integrity.js';
import { isNode } from '../common/env.js';

let realpath: any, pathToFileURL: any;

export function setPathFns(_realpath: any, _pathToFileURL: any) {
  ((realpath = _realpath), (pathToFileURL = _pathToFileURL));
}

function isResponseImmutable(headers: any): boolean {
  if (!headers?.get) return false;
  const cc = headers.get('cache-control');
  if (!cc) return false;
  if (cc.includes('immutable')) return true;
  const maxAgeMatch = cc.match(/max-age=(\d+)/);
  if (maxAgeMatch && parseInt(maxAgeMatch[1]) >= 31536000) return true;
  return false;
}

export function isBuiltinScheme(specifier: string): specifier is `${string}:${string}` {
  if (specifier.indexOf(':') === -1) return false;
  return builtinSchemes.has(specifier.slice(0, specifier.indexOf(':')));
}

export function isMappableScheme(specifier: string): specifier is `${string}:${string}` {
  if (specifier.indexOf(':') === -1) return false;
  return mappableSchemes.has(specifier.slice(0, specifier.indexOf(':')));
}

export interface TraceEntry {
  deps: string[] | null;
  dynamicDeps: string[] | null;
  // assetDeps: { expr: string, start: number, end: number, assets: string[] }
  hasStaticParent: boolean;
  size: number;
  integrity: string;

  // wasCjs is true if the module is a CJS module, but also if it's an ESM
  // module that was transpiled from a CJS module. This is checkable on the
  // jspm.io CDN by looking for an export for the module with a '!cjs'
  // extension in its parent package:
  wasCjs: boolean;

  // usesCjs is true iff the module is both a CJS module and actually _uses_
  // CJS-specific globals like "require" or "module. If not, we can actually
  // link it for browser/deno runtimes despite it being CJS:
  usesCjs: boolean;

  // For cjs modules, the list of hoisted deps
  // this is needed for proper cycle handling
  cjsLazyDeps: string[] | null;
  format: 'esm' | 'commonjs' | 'system' | 'json' | 'css' | 'typescript' | 'wasm' | undefined;

  // network errors are stored on the traceEntryPromises promise, while parser
  // errors are stored here. This allows for existence checks in resolver operations.
  parseError: Error | null;
}

export class Resolver {
  pcfgPromises: Record<string, Promise<PackageConfig | null>> = Object.create(null);
  analysisPromises: Record<string, Promise<void>> = Object.create(null);
  pcfgs: Record<string, PackageConfig | null> = Object.create(null);
  packageBaseCache: Record<string, `${string}/` | Promise<`${string}/`>> = Object.create(null);
  fileLists: Record<string, Set<string> | undefined> = Object.create(null);
  fetchOpts: any;
  preserveSymlinks;
  pm: ProviderManager;
  // null implies "not found"
  traceEntries: Record<string, TraceEntry | null> = Object.create(null);
  // any trace error is retained in this promise
  traceEntryPromises: Record<string, Promise<void>> = Object.create(null);
  env: string[];
  cjsEnv: string[];
  traceCjs: boolean;
  traceTs: boolean;
  traceSystem: boolean;
  installer!: Installer;
  // Track visited URLs during final extraction for cache pruning
  // Populated by extractMap's visitor, cleared on each extractMap call
  visitedUrls: Set<string> = new Set();
  touchedPackageConfigUrls: Set<string> = new Set();
  touchedAnalysisUrls: Set<string> = new Set();
  immutableUrls: Set<string> = new Set();
  // Lazy restoration from trace cache
  restoredAnalysis: Record<string, any> = Object.create(null);
  constructor({
    env,
    fetchOpts,
    providerManager,
    packageConfigs = {},
    preserveSymlinks = false,
    traceCjs = true,
    traceTs = true,
    traceSystem = true
  }: {
    env: string[];
    fetchOpts?: any;
    preserveSymlinks?: boolean;
    packageConfigs?: Record<`${string}/`, PackageConfig>;
    traceCjs?: boolean;
    traceTs?: boolean;
    traceSystem: boolean;
    providerManager: ProviderManager;
  }) {
    if (env.includes('require')) throw new Error('Cannot manually pass require condition');
    if (!env.includes('import')) env.push('import');
    this.env = env;
    this.cjsEnv = this.env.map(e => (e === 'import' ? 'require' : e));
    this.fetchOpts = fetchOpts;
    this.preserveSymlinks = preserveSymlinks;
    this.traceCjs = traceCjs;
    this.traceTs = traceTs;
    this.traceSystem = traceSystem;
    this.pm = providerManager;
    Object.assign(this.pcfgs, packageConfigs);
  }

  resolveBuiltin(
    specifier: string
  ): string | { target: PackageTarget; subpath: '.' | `./${string}` } | undefined {
    return this.pm.resolveBuiltin(specifier, this.env);
  }

  getPackageBase(url: string): `${string}/` | Promise<`${string}/`> {
    const cached = this.packageBaseCache[url];
    if (cached !== undefined) return cached;

    const pkg = this.pm.parseUrlPkg(url);
    if (pkg) {
      const result = this.pm.pkgToUrl(pkg.pkg, pkg.source.provider, pkg.source.layer);
      if (typeof result === 'string') {
        return (this.packageBaseCache[url] = result);
      }
      return result.then(r => (this.packageBaseCache[url] = r));
    }

    let testUrl: URL;
    try {
      testUrl = new URL('./', url);
    } catch {
      return (this.packageBaseCache[url] = url as `${string}/`);
    }
    const packageBasePromise = (async () => {
      const rootUrl = new URL('/', testUrl).href as `${string}/`;
      do {
        let testUrlHref: `${string}/` = testUrl.href as `${string}/`;
        if (await this.checkPjson(testUrlHref)) return testUrlHref;
        if (testUrl.href === rootUrl) return new URL('./', url).href as `${string}/`;
      } while ((testUrl = new URL('../', testUrl)));
    })() as Promise<`${string}/`>;
    this.packageBaseCache[url] = packageBasePromise;
    return packageBasePromise.then(
      packageBase => {
        this.packageBaseCache[url] = packageBase;
        return packageBase;
      },
      error => {
        delete this.packageBaseCache[url];
        throw error;
      }
    );
  }

  // TODO: there are actually two different kinds of "package" in the codebase.
  // There's a registry package, which is something that can be pinned exactly
  // by name and version against a registry like "npm" or "denoland". Then we
  // have a resolver package, which is any URL that has a "package.json" as a
  // child. We should only be doing providerForUrl checks for _registry_
  // packages, and in resolution contexts we should skip straight to npm-style
  // backtracking to find package bases.

  getPackageConfig(pkgUrl: string): PackageConfig | null | Promise<PackageConfig | null> {
    const protocol = pkgUrl.slice(0, pkgUrl.indexOf(':') + 1);
    if (!isFetchProtocol(protocol)) return null;
    if (!pkgUrl.endsWith('/'))
      throw new Error(`Internal Error: Package URL must end in "/". Got ${pkgUrl}`);
    this.touchedPackageConfigUrls.add(pkgUrl);
    let cached = this.pcfgs[pkgUrl];
    // TODO: fix timing bug that requires this return to be a promise
    if (cached === null) return Promise.resolve(null);
    if (cached) return cached;
    if (!this.pcfgPromises[pkgUrl])
      this.pcfgPromises[pkgUrl] = (async () => {
        const pcfg = await this.pm.getPackageConfig(pkgUrl);
        if (typeof pcfg === 'object') {
          if (pcfg !== null) {
            return (this.pcfgs[pkgUrl] = trimPackageConfig(pcfg));
          }
        }

        try {
          var res = await fetch(`${pkgUrl}package.json`, this.fetchOpts);
        } catch (e) {
          // CSP errors can't be detected, but should be treated as missing
          // therefore we just ignore errors as none
          return (this.pcfgs[pkgUrl] = null);
        }
        switch (res.status) {
          case 200:
          case 204:
          case 304:
            break;
          case 400:
          case 401:
          case 403:
          case 404:
          case 406:
          case 500:
            return (this.pcfgs[pkgUrl] = null);
          default:
            throw new JspmError(
              `Invalid status code ${res.status} reading package config for ${pkgUrl}. ${res.statusText}`
            );
        }
        if (isResponseImmutable(res.headers)) this.immutableUrls.add(pkgUrl);
        if (res.headers && !res.headers.get('Content-Type')?.match(/^application\/json(;|$)/)) {
          return (this.pcfgs[pkgUrl] = null);
        } else {
          try {
            return (this.pcfgs[pkgUrl] = trimPackageConfig(await res.json()));
          } catch (e) {
            return (this.pcfgs[pkgUrl] = null);
          }
        }
      })();
    return this.pcfgPromises[pkgUrl];
  }

  async getFileList(pkgUrl: string): Promise<Set<string> | undefined> {
    if (!pkgUrl.endsWith('/')) pkgUrl += '/';
    if (pkgUrl in this.fileLists) return this.fileLists[pkgUrl];
    // First try the provider's own file listing
    const providerFileList = await this.pm.getFileList(pkgUrl);
    if (providerFileList) return (this.fileLists[pkgUrl] = providerFileList);
    // Walk via the fetch shim's 204 directory convention (file: on Node, or virtual URLs)
    if ((isNode && pkgUrl.startsWith('file:')) || isVirtualUrl(pkgUrl)) {
      const fileList = new Set<string>();
      async function walk(path: string, basePath: string) {
        try {
          const res = await fetch(path);
          if (res.status === 200) {
            fileList.add(path.slice(basePath.length));
          } else if (res.status === 204) {
            if (!path.endsWith('/')) path += '/';
            const dirListing = await res.json();
            for (const entry of dirListing) {
              if (entry === 'node_modules' || entry === '.git') continue;
              await walk(path + entry, basePath);
            }
          }
        } catch (e) {
          throw new JspmError(`Unable to read package ${path} - ${(e as Error).toString()}`);
        }
      }
      await walk(pkgUrl, pkgUrl);
      return (this.fileLists[pkgUrl] = fileList);
    }
    // In fetch-only environments, use package.json "files" as the listing
    const pcfg = await this.getPackageConfig(pkgUrl);
    if (pcfg && Array.isArray((pcfg as any).files)) {
      return (this.fileLists[pkgUrl] = new Set(
        (pcfg as any).files.filter(
          (file: string) =>
            typeof file === 'string' &&
            !file.startsWith('/') &&
            !file.endsWith('/') &&
            !file.startsWith('.')
        )
      ));
    }
  }

  getPackageBaseCached(url: string): `${string}/` | undefined {
    let testUrl: URL;
    try {
      testUrl = new URL('./', url);
    } catch {
      return undefined;
    }
    const rootUrl = new URL('/', testUrl).href;
    do {
      const href = testUrl.href as `${string}/`;
      if (this.pcfgs[href]) return href;
      if (testUrl.href === rootUrl) return undefined;
    } while ((testUrl = new URL('../', testUrl)));
    return undefined;
  }

  getWildcardPrefixes(pkgUrl: string): Set<string> {
    if (!pkgUrl.endsWith('/')) pkgUrl += '/';
    const pcfg = this.pcfgs[pkgUrl];
    if (!pcfg?.exports) return new Set();
    return getWildcardPrefixes(pcfg.exports, this.env, this.fileLists[pkgUrl]);
  }

  async getDepList(pkgUrl: string, dev = false): Promise<string[]> {
    const pjson = (await this.getPackageConfig(pkgUrl))!;
    if (!pjson) return [];
    return [
      ...new Set(
        [
          Object.keys(pjson.dependencies || {}),
          Object.keys((dev && pjson.devDependencies) || {}),
          Object.keys(pjson.peerDependencies || {}),
          Object.keys(pjson.optionalDependencies || {}),
          Object.keys(pjson.imports || {})
        ].flat()
      )
    ];
  }

  checkPjson(url: string): boolean | Promise<boolean> {
    const pcfg = this.getPackageConfig(url);
    if (pcfg instanceof Promise) {
      return pcfg.then(pcfg => {
        if (pcfg === null) return false;
        return true;
      });
    }
    return true;
  }

  async exists(resolvedUrl: string) {
    try {
      await this.analyze(resolvedUrl);
    } catch {
      // we ignore network errors when doing exists resolutions
      return false;
    }
    // 404 still caches as null, although this is not currently used
    return !!this.traceEntries[resolvedUrl];
  }

  async wasCommonJS(url: string): Promise<boolean> {
    // TODO: make this a provider hook
    const pkgUrl = await this.getPackageBase(url);
    if (!pkgUrl) return false;
    const pcfg = await this.getPackageConfig(pkgUrl);
    if (!pcfg) return false;
    const subpath = './' + url.slice(pkgUrl.length);
    return (pcfg?.exports as any)?.[subpath + '!cjs'] ? true : false;
  }

  async realPath(url: string): Promise<string> {
    if (!isNode || !url.startsWith('file:') || this.preserveSymlinks) return url;
    let encodedColon = false;
    url = url.replace(/%3a/i, () => {
      encodedColon = true;
      return ':';
    });
    if (!realpath) {
      [{ realpath }, { pathToFileURL }] = await Promise.all([
        import('fs' as any),
        import('url' as any)
      ]);
    }
    const outUrl = pathToFileURL(
      await new Promise((resolve, reject) =>
        realpath(new URL(url), (err: any, result: any) => (err ? reject(err) : resolve(result)))
      )
    ).href;
    if (encodedColon) return 'file:' + outUrl.slice(5).replace(':', '%3a');
    return outUrl;
  }

  async finalizeResolve(
    url: string,
    parentIsCjs: boolean,
    exportsResolution: boolean,
    pkgUrl: `${string}/`
  ): Promise<string> {
    if (parentIsCjs && url.endsWith('/')) url = url.slice(0, -1);
    // Only CJS modules do extension searching for relative resolved paths
    if (parentIsCjs)
      url = await (async () => {
        // subfolder checks before file checks because of fetch
        if (await this.exists(url + '/package.json')) {
          const pcfg = (await this.getPackageConfig(url)) || {};
          const urlUrl = new URL(url + '/');
          if (this.env.includes('browser') && typeof pcfg.browser === 'string')
            return this.finalizeResolve(
              await legacyMainResolve.call(this, pcfg.browser, urlUrl),
              parentIsCjs,
              exportsResolution,
              pkgUrl
            );
          if (this.env.includes('module') && typeof pcfg.module === 'string')
            return this.finalizeResolve(
              await legacyMainResolve.call(this, pcfg.module, urlUrl),
              parentIsCjs,
              exportsResolution,
              pkgUrl
            );
          if (typeof pcfg.main === 'string')
            return this.finalizeResolve(
              await legacyMainResolve.call(this, pcfg.main, urlUrl),
              parentIsCjs,
              exportsResolution,
              pkgUrl
            );
          return this.finalizeResolve(
            await legacyMainResolve.call(this, null, urlUrl),
            parentIsCjs,
            exportsResolution,
            pkgUrl
          );
        }
        if (await this.exists(url + '/index.js')) return url + '/index.js';
        if (await this.exists(url + '/index.json')) return url + '/index.json';
        if (await this.exists(url + '/index.node')) return url + '/index.node';
        if (await this.exists(url)) return url;
        if (await this.exists(url + '.js')) return url + '.js';
        if (await this.exists(url + '.json')) return url + '.json';
        if (await this.exists(url + '.node')) return url + '.node';
        return url;
      })();

    // Only browser maps apply to relative resolved paths
    if (this.env.includes('browser')) {
      pkgUrl = pkgUrl || (await this.getPackageBase(url));
      if (url.startsWith(pkgUrl)) {
        const pcfg = await this.getPackageConfig(pkgUrl);
        if (pcfg && typeof pcfg.browser === 'object' && pcfg.browser !== null) {
          const subpath = './' + url.slice(pkgUrl.length);
          if (subpath in pcfg.browser) {
            const target = pcfg.browser[subpath];
            if (target === false) return this.resolveEmpty(parentIsCjs, url, pkgUrl);
            if (!target.startsWith('./'))
              throw new Error(`TODO: External browser map for ${subpath} to ${target} in ${url}`);
            // for browser mappings to the same module, avoid a loop
            if (pkgUrl + target.slice(2) === url) return url;
            return await this.finalizeResolve(
              pkgUrl + target.slice(2),
              parentIsCjs,
              exportsResolution,
              pkgUrl
            );
          }
        }
      }
    }

    // give some compatibility for packages without "exports" field
    if (!exportsResolution) {
      if (await this.exists(url)) void 0;
      else if (await this.exists(url + '.js')) return url + '.js';
      else if (await this.exists(url + '.json')) return url + '.json';
      else if (await this.exists(url + '.node')) return url + '.node';
    }

    return url;
  }

  // reverse exports resolution
  // returns _a_ possible export which resolves to the given package URL and subpath
  // also handles "imports"
  async getExportResolution(
    pkgUrl: `${string}/`,
    subpath: '.' | `./${string}`,
    originalSpecifier: string
  ): Promise<'.' | `./${string}` | null> {
    const resolvedUrl = subpath === '.' ? pkgUrl.slice(0, -1) : pkgUrl + subpath.slice(2);
    const pcfg = (await this.getPackageConfig(pkgUrl)) || {};
    if (originalSpecifier[0] === '#') {
      if (pcfg.imports === undefined || pcfg.imports === null) return null;
      const match = getMapMatch(originalSpecifier, pcfg.imports as Record<string, ExportsTarget>);
      if (!match) return null;
      const targets = enumeratePackageTargets(pcfg.imports[match]);
      for (const curTarget of targets) {
        try {
          if (
            (await this.finalizeResolve(new URL(curTarget, pkgUrl).href, false, true, pkgUrl)) ===
            resolvedUrl
          ) {
            return '.';
          }
        } catch {}
      }
      return null;
    }
    if (pcfg.exports !== undefined && pcfg.exports !== null) {
      if (typeof pcfg.exports === 'string') {
        if (subpath !== '.') return null;
        const url = new URL(pcfg.exports, pkgUrl).href;
        try {
          if ((await this.finalizeResolve(url, false, true, pkgUrl)) === resolvedUrl) return '.';
        } catch {}
        return null;
      } else if (!allDotKeys(pcfg.exports)) {
        if (subpath !== '.') return null;
        const targets = enumeratePackageTargets(pcfg.exports);
        for (const curTarget of targets) {
          try {
            if (
              (await this.finalizeResolve(new URL(curTarget, pkgUrl).href, false, true, pkgUrl)) ===
              resolvedUrl
            )
              return '.';
          } catch {}
        }
        return null;
      } else {
        let bestMatch;
        for (const expt of Object.keys(pcfg.exports) as ('.' | `./${string}`)[]) {
          const targets = enumeratePackageTargets((pcfg.exports as any)[expt]);
          for (const curTarget of targets) {
            if (curTarget.indexOf('*') === -1) {
              if (
                (await this.finalizeResolve(
                  new URL(curTarget, pkgUrl).href,
                  false,
                  true,
                  pkgUrl
                )) === resolvedUrl
              ) {
                if (bestMatch) {
                  if (originalSpecifier.endsWith(bestMatch.slice(2))) {
                    if (!originalSpecifier.endsWith(expt.slice(2))) continue;
                  } else if (!originalSpecifier.endsWith(expt.slice(2))) {
                    // Normal precedence = shortest export!
                    if (expt.length < bestMatch.length) bestMatch = expt;
                  }
                }
                bestMatch = expt;
              }
            } else {
              const parts = curTarget.split('*');
              if (!subpath.startsWith(parts[0])) continue;
              const matchEndIndex = subpath.indexOf(parts[1], parts[0].length);
              if (matchEndIndex === -1) continue;
              const match = subpath.slice(parts[0].length, matchEndIndex);
              const substitutedTarget = curTarget.replace(/\*/g, match);
              if (subpath === substitutedTarget) {
                const prefix = expt.slice(0, expt.indexOf('*'));
                const suffix = expt.slice(expt.indexOf('*') + 1);
                if (bestMatch) {
                  if (originalSpecifier.endsWith(bestMatch.slice(2))) {
                    if (
                      !originalSpecifier.endsWith(expt.slice(2).replace('*', match)) ||
                      (bestMatch.startsWith(prefix) && bestMatch.endsWith(suffix))
                    )
                      continue;
                  } else if (!originalSpecifier.endsWith(expt.slice(2).replace('*', match))) {
                    if (bestMatch.startsWith(prefix) && bestMatch.endsWith(suffix)) continue;
                  }
                }
                bestMatch = expt.replace('*', match);
              }
            }
          }
        }
        return (bestMatch as '.' | `./${string}`) ?? null;
      }
    } else {
      try {
        if (
          typeof pcfg.main === 'string' &&
          (await this.finalizeResolve(
            await legacyMainResolve.call(
              this,
              pcfg.main,
              new URL(pkgUrl),
              originalSpecifier,
              pkgUrl
            ),
            false,
            false,
            pkgUrl
          )) === resolvedUrl
        )
          return '.';
      } catch {}
      try {
        if (
          (await this.finalizeResolve(
            await legacyMainResolve.call(this, null, new URL(pkgUrl), originalSpecifier, pkgUrl),
            false,
            false,
            pkgUrl
          )) === resolvedUrl
        )
          return '.';
      } catch {}
      try {
        if (
          typeof pcfg.browser === 'string' &&
          (await this.finalizeResolve(
            await legacyMainResolve.call(
              this,
              pcfg.browser,
              new URL(pkgUrl),
              originalSpecifier,
              pkgUrl
            ),
            false,
            false,
            pkgUrl
          )) === resolvedUrl
        )
          return '.';
      } catch {}
      try {
        if (
          typeof pcfg.module === 'string' &&
          (await this.finalizeResolve(
            await legacyMainResolve.call(
              this,
              pcfg.module,
              new URL(pkgUrl),
              originalSpecifier,
              pkgUrl
            ),
            false,
            false,
            pkgUrl
          )) === resolvedUrl
        )
          return '.';
      } catch {}
      try {
        if (
          (await this.finalizeResolve(
            new URL(subpath, new URL(pkgUrl)).href,
            false,
            false,
            pkgUrl
          )) === resolvedUrl
        )
          return subpath;
      } catch {}
    }
    return null;
  }

  async resolveEmpty(cjsEnv: boolean, originalSpecifier: string, parentUrl: string) {
    const stdlibTarget = {
      registry: 'npm',
      name: '@jspm/core',
      range: new SemverRange('*'),
      unstable: true
    };
    const provider = this.installer.getProvider(stdlibTarget);
    const pkg = await this.pm.resolveLatestTarget(stdlibTarget, provider, parentUrl, this);
    return this.resolveExport(
      await this.pm.pkgToUrl(pkg, provider.provider, provider.layer),
      './nodelibs/@empty',
      cjsEnv,
      false,
      originalSpecifier,
      parentUrl
    );
  }

  // Note: updates here must be tracked in function above
  async resolveExport(
    pkgUrl: `${string}/`,
    subpath: `.${string}`,
    cjsEnv: boolean,
    parentIsCjs: boolean,
    originalSpecifier: string,
    parentUrl?: string
  ): Promise<string> {
    const env = cjsEnv ? this.cjsEnv : this.env;
    const pcfg = (await this.getPackageConfig(pkgUrl)) || {};

    // If the package has no exports then we resolve against "node:@empty":
    if (
      typeof pcfg.exports === 'object' &&
      pcfg.exports !== null &&
      Object.keys(pcfg.exports).length === 0
    ) {
      return this.resolveEmpty(cjsEnv, originalSpecifier, parentUrl!);
    }

    function throwExportNotDefined(): never {
      throw new JspmError(
        `No '${subpath}' exports subpath defined in ${pkgUrl} resolving ${originalSpecifier}${importedFrom(
          parentUrl
        )}.`,
        'MODULE_NOT_FOUND'
      );
    }

    if (pcfg.exports !== undefined && pcfg.exports !== null) {
      if (typeof pcfg.exports === 'string') {
        if (subpath === '.')
          return this.finalizeResolve(
            new URL(pcfg.exports, pkgUrl).href,
            parentIsCjs,
            true,
            pkgUrl
          );
        else throwExportNotDefined();
      } else if (!allDotKeys(pcfg.exports)) {
        if (subpath === '.') {
          const url = this.resolvePackageTarget(pcfg.exports, pkgUrl, cjsEnv, '', false);
          if (url === null) throwExportNotDefined();
          return this.finalizeResolve(url, parentIsCjs, true, pkgUrl);
        } else throwExportNotDefined();
      } else {
        const match = getMapMatch(subpath, pcfg.exports as Record<string, ExportsTarget>);
        if (match) {
          let replacement = '';
          const wildcardIndex = match.indexOf('*');
          if (wildcardIndex !== -1) {
            replacement = subpath.slice(
              wildcardIndex,
              subpath.length - (match.length - wildcardIndex - 1)
            );
          } else if (match.endsWith('/')) {
            replacement = subpath.slice(match.length);
          }
          const resolved = this.resolvePackageTarget(
            (pcfg.exports as any)[match],
            pkgUrl,
            cjsEnv,
            replacement,
            false
          );
          if (resolved === null) throwExportNotDefined();
          return this.finalizeResolve(resolved, parentIsCjs, true, pkgUrl);
        }
        throwExportNotDefined();
      }
    } else {
      if (subpath === '.' || (parentIsCjs && subpath === './')) {
        if (env.includes('browser') && typeof pcfg.browser === 'string')
          return this.finalizeResolve(
            await legacyMainResolve.call(
              this,
              pcfg.browser,
              new URL(pkgUrl),
              originalSpecifier,
              pkgUrl
            ),
            parentIsCjs,
            false,
            pkgUrl
          );
        if (env.includes('module') && typeof pcfg.module === 'string')
          return this.finalizeResolve(
            await legacyMainResolve.call(
              this,
              pcfg.module,
              new URL(pkgUrl),
              originalSpecifier,
              pkgUrl
            ),
            parentIsCjs,
            false,
            pkgUrl
          );
        if (typeof pcfg.main === 'string')
          return this.finalizeResolve(
            await legacyMainResolve.call(
              this,
              pcfg.main,
              new URL(pkgUrl),
              originalSpecifier,
              pkgUrl
            ),
            parentIsCjs,
            false,
            pkgUrl
          );
        return this.finalizeResolve(
          await legacyMainResolve.call(this, null, new URL(pkgUrl), originalSpecifier, pkgUrl),
          parentIsCjs,
          false,
          pkgUrl
        );
      } else {
        return this.finalizeResolve(
          new URL(subpath, new URL(pkgUrl)).href,
          parentIsCjs,
          false,
          pkgUrl
        );
      }
    }
  }

  getAnalysis(resolvedUrl: string): TraceEntry | null | undefined {
    let traceEntry = this.traceEntries[resolvedUrl];
    if (traceEntry === undefined) {
      const restoredAnalysis = this.restoredAnalysis[resolvedUrl];
      if (restoredAnalysis) {
        traceEntry = this.traceEntries[resolvedUrl] = {
          ...restoredAnalysis,
          hasStaticParent: true,
          usesCjs: false,
          cjsLazyDeps: null,
          parseError: null
        };
      }
    }
    if (traceEntry?.parseError) throw traceEntry.parseError;
    return traceEntry;
  }

  analyze(resolvedUrl: string): TraceEntry | null | Promise<TraceEntry | null> {
    this.touchedAnalysisUrls.add(resolvedUrl);
    const restoredTraceEntry = this.getAnalysis(resolvedUrl);
    if (restoredTraceEntry !== undefined) return restoredTraceEntry;
    return this._analyzeAsync(resolvedUrl);
  }

  private async _analyzeAsync(resolvedUrl: string): Promise<TraceEntry | null> {
    if (!this.traceEntryPromises[resolvedUrl])
      this.traceEntryPromises[resolvedUrl] = (async () => {
        let traceEntry: TraceEntry | null = null;
        const analysis = await getAnalysis(this, resolvedUrl);
        if (analysis) {
          traceEntry = {
            parseError: null,
            wasCjs: false,
            usesCjs: false,
            deps: null,
            dynamicDeps: null,
            cjsLazyDeps: null,
            hasStaticParent: true,
            size: NaN,
            integrity: '',
            format: undefined
          };
          if ('parseError' in analysis) {
            traceEntry.parseError = analysis.parseError;
          } else {
            const { deps, dynamicDeps, cjsLazyDeps, size, format, integrity } = analysis;
            traceEntry.integrity = integrity;
            traceEntry.format = format;
            traceEntry.size = size;
            traceEntry.deps = deps.sort();
            traceEntry.dynamicDeps = dynamicDeps.sort();
            traceEntry.cjsLazyDeps = cjsLazyDeps ? cjsLazyDeps.sort() : cjsLazyDeps;

            const wasCJS = format === 'commonjs' || (await this.wasCommonJS(resolvedUrl));
            if (wasCJS) traceEntry.wasCjs = true;
          }
        }
        this.traceEntries[resolvedUrl] = traceEntry;
      })();
    await this.traceEntryPromises[resolvedUrl];
    const traceEntry = this.getAnalysis(resolvedUrl);
    if (traceEntry?.parseError) throw traceEntry.parseError;
    return traceEntry ?? null;
  }

  // Note: changes to this function must be updated enumeratePackageTargets too
  resolvePackageTarget(
    target: ExportsTarget,
    packageUrl: string,
    cjsEnv: boolean,
    subpath: string,
    isImport: boolean
  ): string | null {
    if (typeof target === 'string') {
      if (target === '.') {
        // special dot export for file packages
        return packageUrl.slice(0, -1);
      }
      if (!target.startsWith('./')) {
        if (isImport) return target;
        throw new Error(`Invalid exports target ${target} resolving ./${subpath} in ${packageUrl}`);
      }
      if (!target.startsWith('./')) throw new Error('Invalid ');
      if (subpath === '') return new URL(target, packageUrl).href;
      if (target.indexOf('*') !== -1) {
        return new URL(target.replace(/\*/g, subpath), packageUrl).href;
      } else if (target.endsWith('/')) {
        return new URL(target + subpath, packageUrl).href;
      } else {
        throw new Error(`Expected pattern or path export resolving ./${subpath} in ${packageUrl}`);
      }
    } else if (typeof target === 'object' && target !== null && !Array.isArray(target)) {
      for (const condition in target) {
        if (condition === 'default' || (cjsEnv ? this.cjsEnv : this.env).includes(condition)) {
          const resolved = this.resolvePackageTarget(
            target[condition],
            packageUrl,
            cjsEnv,
            subpath,
            isImport
          );
          if (resolved) return resolved;
        }
      }
    } else if (Array.isArray(target)) {
      // TODO: Validation for arrays
      for (const targetFallback of target) {
        return this.resolvePackageTarget(targetFallback, packageUrl, cjsEnv, subpath, isImport);
      }
    }
    return null;
  }
}

export function enumeratePackageTargets(
  target: ExportsTarget,
  targets = new Set<`./${string}` | '.'>()
): Set<`./${string}` | '.'> {
  if (typeof target === 'string') {
    targets.add(target);
  } else if (typeof target === 'object' && target !== null && !Array.isArray(target)) {
    for (const condition in target) {
      enumeratePackageTargets(target[condition], targets);
    }
    return targets;
  } else if (Array.isArray(target)) {
    // TODO: Validation for arrays
    for (const targetFallback of target) {
      enumeratePackageTargets(targetFallback, targets);
      return targets;
    }
  }
  return targets;
}

async function legacyMainResolve(
  this: Resolver,
  main: string | null,
  pkgUrl: URL,
  originalSpecifier?: string,
  parentUrl?: URL | string
) {
  let guess: string;
  if (main?.endsWith('index.js')) {
    if (await this.exists((guess = new URL(`./${main}`, pkgUrl).href))) return guess;
  } else if (main) {
    if (await this.exists((guess = new URL(`./${main}/index.js`, pkgUrl).href))) return guess;
    if (await this.exists((guess = new URL(`./${main}/index.json`, pkgUrl).href))) return guess;
    if (await this.exists((guess = new URL(`./${main}/index.node`, pkgUrl).href))) return guess;
    if (await this.exists((guess = new URL(`./${main}`, pkgUrl).href))) return guess;
    if (await this.exists((guess = new URL(`./${main}.js`, pkgUrl).href))) return guess;
    if (await this.exists((guess = new URL(`./${main}.json`, pkgUrl).href))) return guess;
    if (await this.exists((guess = new URL(`./${main}.node`, pkgUrl).href))) return guess;
  } else {
    if (
      pkgUrl.protocol !== 'file:' &&
      (await this.exists((guess = new URL('./mod.ts', pkgUrl).href)))
    )
      return guess;
    if (await this.exists((guess = new URL('./index.js', pkgUrl).href))) return guess;
    if (await this.exists((guess = new URL('./index.json', pkgUrl).href))) return guess;
    if (await this.exists((guess = new URL('./index.node', pkgUrl).href))) return guess;
  }
  // Not found.
  throw new JspmError(
    `Unable to resolve ${main ? main + ' in ' : ''}${pkgUrl} resolving ${
      originalSpecifier ?? ''
    }${importedFrom(parentUrl)}.`,
    'MODULE_NOT_FOUND'
  );
}

// TODO: Refactor legacy intermediate Analysis type into TraceEntry directly
async function getAnalysis(resolver: Resolver, resolvedUrl: string): Promise<Analysis | null> {
  const parentIsRequire = false;
  const res = await fetch(resolvedUrl, resolver.fetchOpts);
  if (isResponseImmutable(res.headers)) resolver.immutableUrls.add(resolvedUrl);
  let source;
  switch (res.status) {
    case 200:
    case 304:
      source = await res.arrayBuffer();
      break;
    // not found = null
    case 404:
      return null;
    default:
      throw new Error(`Invalid status code ${res.status}`);
  }
  // TODO: headers over extensions for non-file URLs
  var sourceText = '';
  try {
    if (resolvedUrl.endsWith('.wasm')) {
      try {
        var compiled = await WebAssembly.compile(source);
      } catch (e) {
        throw e;
      }
      return {
        deps: WebAssembly.Module.imports(compiled).map(({ module }) => module),
        dynamicDeps: [],
        cjsLazyDeps: null,
        size: source.byteLength,
        format: 'wasm',
        integrity: await getIntegrity(new Uint8Array(source))
      };
    }

    sourceText = new TextDecoder().decode(source);

    // Declaration files are validly exported and remain mapped, but carry no
    // runtime module graph - their specifiers follow TypeScript declaration
    // resolution (a "./x.js" specifier naming an ./x.d.ts), so tracing them as
    // imports resolves against files that need not exist.
    if (
      resolvedUrl.endsWith('.d.ts') ||
      resolvedUrl.endsWith('.d.mts') ||
      resolvedUrl.endsWith('.d.cts')
    ) {
      return {
        deps: [],
        dynamicDeps: [],
        cjsLazyDeps: null,
        size: sourceText.length,
        format: 'typescript',
        integrity: await getIntegrity(sourceText)
      };
    }

    if (
      resolver.traceTs &&
      (resolvedUrl.endsWith('.ts') || resolvedUrl.endsWith('.tsx') || resolvedUrl.endsWith('.jsx'))
    )
      return await createTsAnalysis(sourceText, resolvedUrl);

    if (resolvedUrl.endsWith('.json')) {
      try {
        JSON.parse(sourceText);
        return {
          deps: [],
          dynamicDeps: [],
          cjsLazyDeps: null,
          size: sourceText.length,
          format: 'json',
          integrity: await getIntegrity(sourceText)
        };
      } catch {}
    }

    if (resolvedUrl.endsWith('.css')) {
      try {
        return {
          deps: [],
          dynamicDeps: [],
          cjsLazyDeps: null,
          size: sourceText.length,
          format: 'css',
          integrity: await getIntegrity(sourceText)
        };
      } catch {}
    }

    const [imports, exports] = parse(sourceText);
    if (
      imports.every(impt => impt.type === 'dynamic') &&
      !exports.length &&
      resolvedUrl.startsWith('file:')
    ) {
      // Support CommonJS package boundary checks for non-ESM on file: protocol only
      if (parentIsRequire) {
        if (
          resolver.traceCjs &&
          !(
            resolvedUrl.endsWith('.mjs') ||
            (resolvedUrl.endsWith('.js') &&
              (await resolver.getPackageConfig(await resolver.getPackageBase(resolvedUrl)))
                ?.type === 'module')
          )
        ) {
          return createCjsAnalysis(imports, sourceText, resolvedUrl);
        }
      } else if (
        resolver.traceCjs &&
        (resolvedUrl.endsWith('.cjs') ||
          (resolvedUrl.endsWith('.js') &&
            (await resolver.getPackageConfig(await resolver.getPackageBase(resolvedUrl)))?.type !==
              'module'))
      ) {
        return createCjsAnalysis(imports, sourceText, resolvedUrl);
      }
    }
    return resolver.traceSystem
      ? createSystemAnalysis(sourceText, imports, resolvedUrl)
      : createEsmAnalysis(imports, sourceText, resolvedUrl);
  } catch (e: any) {
    if (!e.message || !e.message.startsWith('Parse error @:')) {
      return {
        parseError: e
      };
    }
    // TODO: better parser errors
    if (e.message && e.message.startsWith('Parse error @:')) {
      const [topline] = e.message.split('\n', 1);
      const pos = topline.slice(14);
      let [line, col] = pos.split(':');
      const lines = sourceText.split('\n');
      let errStack = '';
      if (line > 1) errStack += '\n  ' + lines[line - 2];
      errStack += '\n> ' + lines[line - 1];
      errStack += '\n  ' + ' '.repeat(col - 1) + '^';
      if (lines.length > 1) errStack += '\n  ' + lines[line];
      return {
        parseError: new JspmError(`${errStack}\n\nError parsing ${resolvedUrl}:${pos}`)
      };
    }
    throw e;
  }
}
