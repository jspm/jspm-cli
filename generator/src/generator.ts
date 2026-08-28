/**
 * Copyright 2020-2025 Guy Bedford
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 */

/**
 * The main entry point into the @jspm/generator package.
 * @module generator.ts
 */

import { baseUrl as _baseUrl, isURL, relativeUrl, resolveUrl } from './common/url.js';
import {
  ExactModule,
  ExactPackage,
  PackageConfig,
  parseTarget,
  validatePkgName
} from './install/package.js';
import TraceMap from './trace/tracemap.js';
// @ts-ignore
import {
  clearCache as clearFetchCache,
  fetch as _fetch,
  setFetch,
  setRetryCount,
  setVirtualSourceData,
  type SourceData
} from './common/fetch.js';
import { type IImportMap, ImportMap } from '@jspm/import-map';
import { SemverRange } from 'sver';
import { JspmError } from './common/err.js';
import { getIntegrity } from './common/integrity.js';
import { createLogger, type Log, type LogStream } from './common/log.js';
import { Replacer } from './common/str.js';
import {
  analyzeHtml,
  type HtmlAttr,
  type HtmlTag,
  type ParsedMap,
  type HtmlAnalysis
} from './html/analyze.js';
import { InstallTarget, PackageProvider, type InstallMode } from './install/installer.js';
import type { LockResolutions } from './install/lock.js';
import {
  type PublishOutput,
  getDefaultProviderStrings,
  ProviderManager,
  type Provider
} from './providers/index.js';
import * as nodemodules from './providers/nodemodules.js';
import { Resolver } from './trace/resolver.js';
import { getMaybeWrapperUrl } from './common/wrapper.js';
import { expandExportsResolutions } from './common/package.js';
import { isNode } from './common/env.js';
import { minimatch } from 'minimatch';
import type { ExportsTarget, LatestPackageTarget, PackageTarget } from './install/package.js';

/**
 * Cached analysis data for a module
 */
export interface CachedAnalysis {
  deps: string[];
  dynamicDeps: string[];
  size: number;
  integrity: string;
  format: 'json' | 'esm' | 'css' | 'wasm';
  wasCjs: boolean;
}

/**
 * Serializable cache structure for the Generator.
 * Can be saved to disk and restored to speed up subsequent runs.
 */
export interface GeneratorCache {
  /** Package configurations keyed by full package URL */
  packageConfigs: Record<string, PackageConfig | null>;
  /** Module analysis data keyed by full module URL */
  analysis: Record<string, CachedAnalysis>;
  /** Cached package-base lookups keyed by full module URL */
  packageBases?: Record<string, string>;
}

/**
 * @interface GeneratorOptions.
 */
export interface GeneratorOptions {
  /**
   * The URL to use for resolutions without a parent context.
   *
   * Defaults to mapUrl or the process base URL.
   *
   * Also determines the default scoping base for the import map when flattening.
   */
  baseUrl?: URL | string;

  /**
   * The URL of the import map itself, used to construct relative import map URLs.
   *
   * Defaults to the base URL.
   *
   * The `mapUrl` is used in order to output relative URLs for modules located on the same
   * host as the import map.
   *
   * E.g. for `mapUrl: 'file:///path/to/project/map.importmap'`, installing local file packages
   * will be output as relative URLs to their file locations from the map location, since all URLs in an import
   * map are relative to the URL of the import map.
   */
  mapUrl?: URL | string;

  /**
   * The URL to treat as the root of the serving protocol of the
   * import map, used to construct absolute import map URLs.
   *
   * When set, `rootUrl` takes precendence over `mapUrl` and is used to normalize all import map URLs
   * as absolute paths against this URL.
   *
   * E.g. for `rootUrl: 'file:///path/to/project/public'`, any local module `public/local/mod.js` within the `public` folder
   * will be normalized to `/local/mod.js` in the output map.
   */
  rootUrl?: URL | string | null;

  /**
   * An authoritative initial import map.
   *
   * An initial import map to start with - can be from a previous
   * install or to provide custom mappings.
   */
  inputMap?: IImportMap;

  /**
   * When using JSPM {@link Generator.link}, all dependencies
   * will be placed into scopes instead of top-level "imports" in the map.
   *
   * This will default to true in the next major version.
   */
  scopedLink?: boolean;

  /**
   * The provider to use for top-level (i.e. root package) installs if there's no context in the inputMap. This can be used to set the provider for a new import map. To use a specific provider for an install, rather than relying on context, register an override using the 'providers' option.
   *
   * Supports: 'jspm.io' | 'jspm.io#system' | 'nodemodules' | 'skypack' | 'jsdelivr' | 'unpkg' | 'esm.sh';
   *
   * Providers are responsible for resolution from abstract package names and version ranges to exact URL locations.
   *
   * Providers resolve package names and semver ranges to exact CDN package URL paths using provider hooks.
   *
   * These hooks include version resolution and converting package versions into URLs and back again.
   *
   * See `src/providers/[name].ts` for how to define a custom provider.
   *
   * New providers can be provided via the `customProviders` option. PRs to merge in providers are welcome as well.
   */
  defaultProvider?: string;

  /**
   * The default registry to use when no registry is provided to an install.
   * Defaults to 'npm:'.
   *
   * Registries are separated from providers because multiple providers can serve
   * any public registry.
   *
   * Internally, the default providers for registries are handled by the providers object
   */
  defaultRegistry?: string;

  /**
   * The conditional environment resolutions to apply.
   *
   * The conditions passed to the `env` option are environment conditions, as [supported by Node.js](https://nodejs.org/dist/latest-v16.x/docs/api/packages.html#packages_conditions_definitions) in the package exports field.
   *
   * By default the `"default"`, `"require"` and `"import"` conditions are always supported regardless of what `env` conditions are provided.
   *
   * In addition the default conditions applied if no `env` option is set are `"browser"`, `"development"` and `"module"`.
   *
   * Webpack and RollupJS support a custom `"module"` condition as a bundler-specific solution to the [dual package hazard](https://nodejs.org/dist/latest-v16.x/docs/api/packages.html#packages_dual_package_hazard), which is by default included in the JSPM resolution as well although
   * can be turned off if needed.
   *
   * Note when providing custom conditions like setting `env: ["production"]` that the `"browser"` and `"module"` conditions still need to be
   * applied as well via `env: ["production", "browser", "module"]`. Ordering does not matter though.
   *
   * Any other custom condition strings can also be provided.
   */
  env?: string[];

  /**
   * Whether to use a local FS cache for fetched modules. Set to 'offline' to use the offline cache.
   *
   * By default a global fetch cache is maintained between runs on the file system.
   *
   * This caching can be disabled by setting `cache: false`.
   *
   * When running offline, setting `cache: 'offline'` will only use the local cache and not touch the network at all,
   * making fully offline workflows possible provided the modules have been seen before.
   */
  cache?: 'offline' | boolean;

  /**
   * User-provided fetch options for fetching modules, eg check https://github.com/npm/make-fetch-happen#extra-options for Node.js fetch
   */
  fetchOptions?: Record<string, any>;

  /**
   * Custom provider definitions.
   *
   * When installing from a custom CDN it can be advisable to define a custom provider in order to be able to get version deduping against that CDN.
   *
   * Custom provider definitions define a provider name, and the provider instance consisting of three main hooks:
   *
   * * `pkgToUrl({ registry: string, name: string, version: string }, layer: string) -> String URL`: Returns the URL for a given exact package registry, name and version to use for this provider. If the provider is using layers, the `layer` string can be used to determine the URL layer (where the `defaultProvider: '[name].[layer]'` form is used to determine the layer, eg minified v unminified etc). It is important that package URLs always end in `/`, because packages must be treated as folders not files. An error will be thrown for package URLs returned not ending in `/`.
   * * `parseUrlPkg(url: string) -> { { registry: string, name: string, version: string }, layer: string } | undefined`: Defines the converse operation to `pkgToUrl`, converting back from a string URL
   * into the exact package registry, name and version, as well as the layer. Should always return `undefined` for unknown URLs as the first matching provider is treated as authoritative when dealing with
   * multi-provider installations.
   * * `resolveLatestTarget(target: { registry: string, name: string, range: SemverRange }, unstable: boolean, layer: string, parentUrl: string) -> Promise<{ registry: string, name: string, version: string } | null>`: Resolve the latest version to use for a given package target. `unstable` indicates that prerelease versions can be matched. The definition of `SemverRange` is as per the [sver package](https://www.npmjs.com/package/sver#semverrange). Returning `null` corresponds to a package not found error.
   *
   * The use of `pkgToUrl` and `parseUrlPkg` is what allows the JSPM Generator to dedupe package versions internally based on their unique internal identifier `[registry]:[name]@[version]` regardless of what CDN location is used. URLs that do not support `parseUrlPkg` can still be installed and used fine, they just do not participate in version deduping operations.
   *
   * @example
   * ```js
   * const unpkgUrl = 'https://unpkg.com/';
   * const exactPkgRegEx = /^((?:@[^/\\%@]+\/)?[^./\\%@][^/\\%@]*)@([^\/]+)(\/.*)?$/;
   *
   * const generator = new Generator({
   *   defaultProvider: 'custom',
   *   customProviders: {
   *     custom: {
   *       pkgToUrl ({ registry, name, version }) {
   *         return `${unpkgUrl}${name}@${version}/`;
   *       },
   *       parseUrlPkg (url) {
   *         if (url.startsWith(unpkgUrl)) {
   *           const [, name, version] = url.slice(unpkgUrl.length).match(exactPkgRegEx) || [];
   *           return { registry: 'npm', name, version };
   *         }
   *       },
   *       resolveLatestTarget ({ registry, name, range }, unstable, layer, parentUrl) {
   *         return { registry, name, version: '3.6.0' };
   *       }
   *     }
   *   }
   * });
   *
   * await generator.install('custom:jquery');
   * ```
   */
  customProviders?: Record<string, Provider>;

  /**
   * A map of custom scoped providers.
   *
   * The provider map allows setting custom providers for specific package names, package scopes or registries.
   *
   * @example
   * For example, an organization with private packages with names like `npmpackage` and `@orgscope/...` can define the custom providers to reference these from a custom source:
   *
   * ```js
   *   providers: {
   *     'npmpackage': 'nodemodules',
   *     '@orgscope': 'nodemodules',
   *     'npm:': 'nodemodules'
   *   }
   * ```
   *
   * Alternatively a custom provider can be referenced this way for eg private CDN / registry support.
   */
  providers?: Record<string, string>;

  /**
   * Custom dependency resolution overrides for all installs.
   *
   * The resolutions option allows configuring a specific dependency version to always be used overriding all version resolution
   * logic for that dependency for all nestings.
   *
   * It is a map from package name to package version target just like the package.json "dependencies" map, but that applies and overrides universally.
   *
   * @example
   * ```js
   * const generator = new Generator({
   *   resolutions: {
   *     dep: '1.2.3'
   *   }
   * });
   * ```
   *
   * It is also useful for local monorepo patterns where all local packages should be located locally.
   * When referencing local paths, the baseUrl configuration option is used as the URL parent.
   *
   * ```js
   * const generator = new Generator({
   *   mapUrl: new URL('./app.html', import.meta.url),
   *   baseUrl: new URL('../', import.meta.url),
   *   resolutions: {
   *     '@company/pkgA': `./pkgA`,
   *     '@company/pkgB': `./pkgB`
   *     '@company/pkgC': `./pkgC`
   *   }
   * })
   * ```
   *
   * All subpath and main resolution logic will follow the package.json definitions of the resolved package, unlike `inputMap`
   * which only maps specific specifiers.
   */
  resolutions?: Record<string, string>;

  /**
   * Override package.json configurations for package URLs.
   *
   * Key is a full normalized URL to a package path, optionally ending in `/` or `/package.json`.
   * Value is a package configuration, as per a package.json file contents.
   *
   * This field can also be set to null to indicate no package configuration for this URL.
   *
   * This can be useful to remove 404 not found errors in browser workflows for URLs that
   * clearly do not have a package.json.
   *
   * For example:
   *
   * const generator = new Generator({
   *   packageConfig: {
   *     'https://mysite.com/': null
   *   }
   * });
   * generator.link('https://mysite.com/path/to/file.js');
   *
   * Can be used to avoid JSPM Generator from attempting to fetch `https://mysite.com/package.json` at all.
   */
  packageConfigs?: Record<string, (PackageConfig & { [key: string]: any }) | null>;

  /**
   * Allows ignoring certain module specifiers during the tracing process.
   * It can be useful, for example, when you provide an `inputMap`
   * that contains a mapping that can't be traced in current context,
   * but you know it will work in the context where the generated map
   * is going to be used.
   * ```js
   * const generator = new Generator({
   *   inputMap: {
   *       imports: {
   *           "react": "./my/own/react.js",
   *       }
   *   },
   *   ignore: ["react"]
   * });
   *
   * // Even though `@react-three/fiber@7` depends upon `react`,
   * // `generator` will not try to trace and resolve `react`,
   * // so the mapping provided in `inputMap` will end up in the resulting import map.
   * await generator.install("@react-three/fiber@7")
   * ```
   *
   * Alternatively, a function may be provided which receives the specifier and
   * parent URL and returns `true` to ignore the resolution:
   * ```js
   * const generator = new Generator({
   *   ignore: (specifier, parentUrl) => specifier.startsWith("node:")
   * });
   * ```
   */
  ignore?: string[] | ((specifier: string, parentUrl: string) => boolean);

  /**
   * Lockfile data to use for resolutions
   */
  lock?: LockResolutions;

  /**
   * Support tracing CommonJS dependencies locally. This is necessary if you
   * are using the "nodemodules" provider and have CommonJS dependencies.
   * Disabled by default.
   */
  commonJS?: boolean;

  /**
   * Support tracing TypeScript dependencies when generating the import map.
   * Disabled by default.
   */
  typeScript?: boolean;

  /**
   * Support tracing SystemJS dependencies when generating the import map.
   * Disabled by default.
   */
  system?: boolean;

  /**
   * Whether to include "integrity" field in the import map
   */
  integrity?: boolean;

  /**
   * Whether to include "dependencyCache" field in the import map.
   * When enabled, the import map will include direct static and dynamic
   * dependencies for each module URL in the final pruned graph.
   */
  dependencyCache?: boolean;

  /**
   * The number of fetch retries to attempt for request failures.
   * Defaults to 3.
   */
  fetchRetries?: number;

  /**
   * The same as the Node.js `--preserve-symlinks` flag, except it will apply
   * to both the main and the dependencies.
   * See https://nodejs.org/api/cli.html#--preserve-symlinks.
   * This is only supported for file: URLs.
   * Defaults to false, like Node.js.
   */
  preserveSymlinks?: boolean;

  /**
   * Provider configuration options
   *
   * @example
   * ```js
   * const generator = new Generator({
   *   mapUrl: import.meta.url,
   *   defaultProvider: "jspm.io",
   *   providerConfig: {
   *     "jspm.io": {
   *       cdnUrl: `https://jspm-mirror.com/`
   *     }
   *   }
   */
  providerConfig?: {
    [providerName: string]: any;
  };

  /**
   * Custom async resolver function for intercepting resolution operations.
   *
   * When provided, this function will be called first for all resolution operations.
   * If it returns a string URL, that will be used as the resolved module and persisted
   * in the import map. If it returns undefined, normal resolution continues.
   *
   * @param specifier The module specifier being resolved
   * @param parentUrl The URL of the parent module
   * @param context Additional context including environment and other metadata
   * @returns A resolved URL string or undefined to continue with default resolution
   *
   * @example
   * ```js
   * const generator = new Generator({
   *   customResolver: async (specifier, parentUrl, context) => {
   *     if (specifier === 'my-custom-lib') {
   *       return 'https://cdn.example.com/my-custom-lib@1.0.0/index.js';
   *     }
   *     return undefined;
   *   }
   * });
   * ```
   */
  customResolver?: (
    specifier: string,
    parentUrl: string,
    context: {
      parentPkgUrl: string;
      env?: string[];
      installMode: any;
      toplevel: boolean;
      [key: string]: any;
    }
  ) => string | undefined | Promise<string | undefined>;

  /**
   * @default true
   *
   * Whether to flatten import map scopes into domain-groupings.
   * This is a lossy process, removing scoped dependencies.
   * By default this is done to create a smaller import map output
   * size. Set to false to retain dependency scoping information.
   *
   */
  flattenScopes?: boolean;

  /**
   * @default true
   *
   * Whether to combine subpaths in the final import map.
   * By default, when possible, the generator will at output time
   * combine similar subpaths in an imports map like:
   *
   * @example
   * ```json
   * {
   *   "imports": {
   *     "a/b.js": "./pkg/b.js",
   *     "a/c.js": "./pkg/c.js"
   *   }
   * }
   * ```
   *
   * Into a single folder mapping:
   *
   * ```json
   * {
   *   "imports": {
   *     "a/": "./pkg/"
   *   }
   * }
   * ```
   *
   * Resulting in a smaller import map size. This process is done
   * carefully to never break any existing mappings, but is a lossy
   * import map compression as well.
   *
   * Set this option to false to disable this default behaviour and
   * retain individual mappings.
   *
   * When set to true or 'scopes' (default), only scoped mappings are combined.
   * When set to 'both', both top-level imports and scoped mappings are combined.
   * When set to false or 'none', combining is disabled entirely.
   */
  combineSubpaths?: boolean | 'scopes' | 'both' | 'none';

  /**
   * Whether to expand wildcard exports into individual import map entries.
   *
   * @default false
   *
   * When false (default), wildcard exports like `"./modules/*": "./modules/*"`
   * are represented as a single trailing-slash entry (`pkg/modules/` → base/)
   * instead of being expanded into individual entries per file. This is
   * lossless and preserves the package's encapsulation boundaries.
   *
   * Set to true to expand wildcard exports into individual entries (previous
   * behavior).
   */
  expandWildcards?: boolean;

  /**
   * Enable trace caching to optimize uncached runs.
   *
   * When set to `true`, enables caching of package configs and analysis data
   * which can be retrieved via `getCache()`.
   *
   * When set to a `GeneratorCache` object, restores a previously saved cache
   * and enables caching for the session.
   *
   * @example
   * ```js
   * // First run - build cache
   * const gen1 = new Generator({ mapUrl: import.meta.url, traceCache: true });
   * await gen1.install('react');
   * const cache = gen1.getCache();
   * fs.writeFileSync('cache.json', JSON.stringify(cache));
   *
   * // Second run - use cache (fast)
   * const savedCache = JSON.parse(fs.readFileSync('cache.json'));
   * const gen2 = new Generator({ mapUrl: import.meta.url, traceCache: savedCache });
   * await gen2.install('react');  // uses cached data, fewer fetches
   * ```
   */
  traceCache?: GeneratorCache | true;

  /**
   * Controls how flattened scopes from the inputMap are used as fallback
   * resolutions during dependency installation.
   *
   * When the inputMap has a flattened scope (e.g. "https://ga.jspm.io/") with
   * a mapping for a package, child scopes may inherit that mapping via URL
   * prefix matching even when the version is incompatible with what they need.
   *
   * - `true` (default): All flattened scope resolutions are trusted as locks.
   * - `false`: Flattened scope resolutions from the inputMap are ignored entirely.
   *   Dependencies are resolved fresh from package.json ranges.
   * - `'semver-compatible'`: Flattened scope resolutions are only used when they
   *   satisfy the dependent package's declared semver range. To be made the
   *   default in the next major.
   */
  inputMapFallbacks?: boolean | 'semver-compatible';

  /**
   * Groups of scope URLs that share dependency resolution behavior.
   *
   * Each key is a primary scope URL whose package.json dependency ranges
   * and resolution locks are used for all scopes in its group. The value
   * is an array of secondary scope URLs that delegate to the primary.
   *
   * URLs can be absolute or relative to `baseUrl`.
   *
   * @example
   * ```js
   * linkedScopes: {
   *   'https://site.com/foo/': ['https://site.com/bar/']
   * }
   * ```
   *
   * Modules in `https://site.com/bar/` will use the dependency ranges
   * and resolution locks from `https://site.com/foo/`, while their
   * scope boundaries remain unchanged.
   */
  linkedScopes?: Record<string, string[]>;
}

/**
 * Options for publishing a package
 */
export interface Publish {
  /**
   * Publish package is a URL containing files to publish. The package.json file at the base of this path
   * will be respected for the fields "name", "version", "files", and "ignore", as with npm conventions.
   *
   * Virtual publishes may also be made by providing source data directly as a file path to source buffer record.
   */
  package: string | SourceData;
  /**
   * Optional import map to include for the publish, published as the importmap.json file in the package.
   *
   * @default true
   *
   * Publishes the current generator instance's import map, alongside a link operation of the package
   * (see the {@link Publish.install} option for more info). Any URLs in the import map pointing to the
   * package being published will automatically be updated to reflect the published URLs.
   *
   * The benefit of defining the import map separately is that this provides a strong definition of the publish
   * execution model.
   */
  importMap?: IImportMap | boolean;
  /**
   * Whether to first install the package before publishing, thereby populating the import map for the package.
   *
   * By default, when `importMap: true` is set, and an explicit import map is not otherwise passed, install will be applied.
   *
   * Setting this to false, with importMap set to true will use the generator import map without the additional package
   * link operation.
   */
  install?: boolean;
  /**
   * Provider to publish to
   */
  provider?: string;
  /**
   * Override the version from the package.json
   */
  version?: string;
  /**
   * Override the name from the package.json
   */
  name?: string;
}

export interface ModuleAnalysis {
  format: 'commonjs' | 'esm' | 'system' | 'json' | 'css' | 'typescript' | 'wasm';
  staticDeps: string[];
  dynamicDeps: string[];
  cjsLazyDeps: string[] | null;
}

type InstallSubpath = '.' | `./${string}`;

const rootInstallSubpath: InstallSubpath = '.';

export interface Install {
  target: string | InstallTarget;
  alias?: string;
  subpath?: InstallSubpath;
  subpaths?: InstallSubpath[] | true;
}

/**
 * Supports clearing the global fetch cache in Node.js.
 *
 * @example
 *
 * ```js
 * import { clearCache } from '@jspm/generator';
 * clearCache();
 * ```
 */
export async function clearCache() {
  return clearFetchCache();
}

function createFetchOptions(cache: 'offline' | boolean = true, fetchOptions = {}) {
  let fetchOpts: Record<string, any> = {
    retry: 1,
    timeout: 10000,
    ...fetchOptions,
    headers: { 'Accept-Encoding': 'gzip, br' }
  };
  if (cache === 'offline') fetchOpts.cache = 'force-cache';
  else if (!cache) fetchOpts.cache = 'no-store';
  return fetchOpts;
}

/**
 * Generator.
 */
export class Generator {
  traceMap: TraceMap;
  baseUrl: URL;
  mapUrl: URL;
  rootUrl: URL | null;
  map: ImportMap;
  logStream: LogStream;
  log: Log;
  integrity: boolean;
  flattenScopes: boolean;
  combineSubpaths: 'scopes' | 'both' | 'none';
  expandWildcards: boolean;
  scopedLink: boolean;
  cacheEnabled: boolean;

  /**
   * Constructs a new Generator instance.
   *
   * @example
   *
   * ```js
   * const generator = new Generator({
   *   mapUrl: import.meta.url,
   *   inputMap: {
   *     "imports": {
   *       "react": "https://cdn.skypack.dev/react"
   *     }
   *   },
   *   defaultProvider: 'jspm',
   *   defaultRegistry: 'npm',
   *   providers: {
   *     '@orgscope': 'nodemodules'
   *   },
   *   customProviders: {},
   *   env: ['production', 'browser'],
   *   cache: false,
   * });
   * ```
   * @param {GeneratorOptions} opts Configuration for the new generator instance.
   */
  constructor({
    baseUrl,
    mapUrl,
    rootUrl = undefined,
    inputMap = undefined,
    env = ['browser', 'development', 'module', 'import'],
    defaultProvider,
    defaultRegistry = 'npm',
    customProviders = undefined,
    providers,
    resolutions = {},
    cache = true,
    fetchOptions = {},
    packageConfigs = {},
    ignore = [],
    commonJS = false,
    typeScript = false,
    system = false,
    integrity = false,
    fetchRetries,
    providerConfig = {},
    preserveSymlinks,
    customResolver,
    flattenScopes = true,
    combineSubpaths = true,
    expandWildcards = false,
    scopedLink = false,
    traceCache = undefined,
    inputMapFallbacks = true,
    linkedScopes = undefined
  }: GeneratorOptions = {}) {
    this.cacheEnabled = !!traceCache;
    if (typeof preserveSymlinks !== 'boolean') preserveSymlinks = isNode;

    // Default logic for the mapUrl, baseUrl and rootUrl:
    if (mapUrl && !baseUrl) {
      mapUrl = typeof mapUrl === 'string' ? new URL(mapUrl, _baseUrl) : mapUrl;
      try {
        baseUrl = new URL('./', mapUrl);
      } catch {
        baseUrl = new URL(mapUrl + '/');
      }
    } else if (baseUrl && !mapUrl) {
      mapUrl = baseUrl;
    } else if (!mapUrl && !baseUrl) {
      baseUrl = mapUrl = _baseUrl;
    }
    this.baseUrl = typeof baseUrl === 'string' ? new URL(baseUrl, _baseUrl) : baseUrl!;
    if (!this.baseUrl.pathname.endsWith('/')) {
      this.baseUrl = new URL(this.baseUrl.href);
      this.baseUrl.pathname += '/';
    }
    this.mapUrl = typeof mapUrl === 'string' ? new URL(mapUrl, this.baseUrl) : mapUrl!;
    this.rootUrl = typeof rootUrl === 'string' ? new URL(rootUrl, this.baseUrl) : rootUrl || null;
    if (this.rootUrl && !this.rootUrl.pathname.endsWith('/')) this.rootUrl.pathname += '/';
    if (!this.mapUrl.pathname.endsWith('/')) {
      try {
        this.mapUrl = new URL('./', this.mapUrl);
      } catch {
        this.mapUrl = new URL(this.mapUrl.href + '/');
      }
    }

    this.scopedLink = scopedLink;
    this.integrity = integrity;

    const fetchOpts = createFetchOptions(cache, fetchOptions);
    const { log, logStream } = createLogger();
    this.logStream = logStream;
    this.log = log;
    const tracelog = globalThis.process?.env?.JSPM_GENERATOR_LOG ? log : undefined;

    // The node_modules provider is special, because it needs to be rooted to
    // perform resolutions against the local node_modules directory:
    const nmProvider = nodemodules.createProvider(
      this.baseUrl.href,
      defaultProvider === 'nodemodules'
    );
    const pm = new ProviderManager(log, fetchOpts, providerConfig, {
      ...customProviders,
      nodemodules: nmProvider
    });

    // We make an attempt to auto-detect the default provider from the input
    // map, by picking the provider with the most owned URLs:
    defaultProvider = detectDefaultProvider(defaultProvider ?? null, inputMap ?? null, pm);

    // Initialise the resolver:
    const resolver = new Resolver({
      env,
      providerManager: pm,
      fetchOpts,
      preserveSymlinks,
      traceCjs: commonJS,
      traceTs: typeScript,
      traceSystem: system,
      packageConfigs: Object.fromEntries(
        Object.entries(packageConfigs).map(([key, pcfg]) => {
          let resolved = new URL(key, baseUrl).href;
          if (!resolved.endsWith('/')) resolved += '/';
          if (resolved.endsWith('/package.json')) resolved = resolved.slice(0, -12);
          return [resolved, pcfg];
        })
      ) as any
    });

    // Normalize linkedScopes URLs against baseUrl
    let normalizedLinkedScopes: Record<string, string[]> | undefined;
    if (linkedScopes) {
      normalizedLinkedScopes = {};
      for (const [primary, secondaries] of Object.entries(linkedScopes)) {
        let resolvedPrimary = new URL(primary, this.baseUrl).href;
        if (!resolvedPrimary.endsWith('/')) resolvedPrimary += '/';
        normalizedLinkedScopes[resolvedPrimary] = secondaries.map(s => {
          let resolved = new URL(s, this.baseUrl).href;
          if (!resolved.endsWith('/')) resolved += '/';
          return resolved;
        });
      }
    }

    // Initialise the tracer:
    this.traceMap = new TraceMap(
      {
        mapUrl: this.mapUrl,
        rootUrl: this.rootUrl,
        baseUrl: this.baseUrl,
        defaultProvider,
        defaultRegistry,
        providers,
        ignore,
        resolutions,
        commonJS,
        customResolver,
        noPins: scopedLink,
        inputMapFallbacks,
        linkedScopes: normalizedLinkedScopes
      },
      tracelog,
      resolver
    );

    // Populate resolver caches from input cache if provided
    if (traceCache && traceCache !== true) {
      Object.assign(resolver.pcfgs, traceCache.packageConfigs);
      resolver.restoredAnalysis = traceCache.analysis || {};
      // packageBases restored to speed up getPackageBase lookups
      if ((traceCache as any).packageBases)
        Object.assign(resolver.packageBaseCache, (traceCache as any).packageBases);
      // resolveCache and resolveFailures are in-memory only — rebuilt each run
    }

    // Reconstruct constraints and locks from the input map:
    this.map = new ImportMap({ mapUrl: this.mapUrl, rootUrl: this.rootUrl });
    if (!integrity) this.map.integrity = {};
    if (inputMap) this.addMappings(inputMap);
    this.flattenScopes = flattenScopes;
    this.combineSubpaths =
      combineSubpaths === true ? 'scopes' : combineSubpaths === false ? 'none' : combineSubpaths;
    this.expandWildcards = expandWildcards;

    // Set the fetch retry count
    if (typeof fetchRetries === 'number') setRetryCount(fetchRetries);
  }

  /**
   * Add new custom mappings and lock resolutions to the input map
   * of the generator, which are then applied in subsequent installs.
   *
   * @param jsonOrHtml The mappings are parsed as a JSON data object or string, falling back to reading an inline import map from an HTML file.
   * @param mapUrl An optional URL for the map to handle relative resolutions, defaults to generator mapUrl.
   * @param rootUrl An optional root URL for the map to handle root resolutions, defaults to generator rootUrl.
   * @returns The list of modules pinned by this import map or HTML.
   */
  async addMappings(
    jsonOrHtml: string | IImportMap,
    mapUrl: string | URL = this.mapUrl,
    rootUrl: string | URL = this.rootUrl!,
    preloads?: string[]
  ): Promise<string[]> {
    if (typeof mapUrl === 'string') mapUrl = new URL(mapUrl, this.baseUrl);
    if (typeof rootUrl === 'string') rootUrl = new URL(rootUrl, this.baseUrl);
    let htmlModules: string[] | undefined;
    if (typeof jsonOrHtml === 'string') {
      try {
        jsonOrHtml = JSON.parse(jsonOrHtml) as IImportMap;
      } catch {
        const analysis = analyzeHtml(jsonOrHtml as string, mapUrl);
        jsonOrHtml = (analysis.map.json || {}) as IImportMap;
        preloads = (preloads || []).concat(
          analysis.preloads.map(preload => preload.attrs.href?.value).filter(x => x) as string[]
        );
        htmlModules = [...new Set([...analysis.staticImports, ...analysis.dynamicImports])];
      }
    }
    await this.traceMap.addInputMap(jsonOrHtml, mapUrl, rootUrl, preloads);
    return htmlModules || [...(this.traceMap.pins || Object.keys(this.traceMap.inputMap.imports))];
  }

  /**
   * Retrieve the lockfile data from the installer
   */
  getLock(): LockResolutions {
    return JSON.parse(JSON.stringify(this.traceMap.installer!.installs));
  }

  /**
   * Link a module, installing all dependencies necessary into the map
   * to support its execution including static and dynamic module imports.
   *
   * @param specifier Module or list of modules to link
   * @param parentUrl Optional parent URL
   *
   * Link specifiers are module specifiers - they can be bare specifiers resolved through
   * package resolution, relative URLs, or full URLs, for example:
   *
   * @example
   * ```js
   * await generator.link(['react', './local.js']);
   * ```
   *
   * In the above, an import map will be constructed based on the resolution of react,
   * and tracing all its dependencies in turn, as well as for the local module, and
   * any dependencies it has in turn as well, installing all dependencies into the import
   * map as needed.
   *
   * In general, using `generator.link(entryPoints)` is recommended over `generator.install()`,
   * since it represents a real module graph linkage as would be required in a browser.
   *
   * By using link, we guarantee that the import map constructed is only for what is truly
   * needed and loaded. Dynamic imports that are statically analyzable are traced by link.
   *
   * If a custom resolver is configured, it will be applied to the provided specifiers
   * and all their dependencies during the linking process.
   */
  async link(
    specifier: string | string[],
    parentUrl?: string
  ): Promise<{ staticDeps: string[]; dynamicDeps: string[] }> {
    if (typeof specifier === 'string') specifier = [specifier];
    let error = false;
    await this.traceMap.processInputMap;
    let pins;
    try {
      pins = await Promise.all(
        specifier.map(specifier =>
          this.traceMap.visit(
            specifier,
            {
              installMode: 'freeze',
              toplevel: !this.scopedLink
            },
            parentUrl || this.baseUrl.href
          )
        )
      );
      if (this.traceMap.pins) {
        for (const s of specifier) {
          if (!this.traceMap.pins.includes(s)) this.traceMap.pins.push(s);
        }
      }
    } catch (e) {
      error = true;
      throw e;
    } finally {
      const { map, staticDeps, dynamicDeps } = await this.traceMap.extractMap(
        this.traceMap.pins || (pins?.filter(Boolean) as string[]) || [],
        this.integrity,
        !this.scopedLink,
        parentUrl
      );
      this.map = map;
      if (!error) return { staticDeps, dynamicDeps };
    }
    return undefined as any;
  }

  /**
   * Links every imported module in the given HTML file, installing all
   * dependencies necessary to support its execution.
   *
   * @param html HTML to link
   * @param htmlUrl URL of the given HTML
   */
  async linkHtml(html: string | string[], htmlUrl?: string | URL): Promise<string[]> {
    if (Array.isArray(html)) {
      const impts = await Promise.all(html.map(h => this.linkHtml(h, htmlUrl)));
      return [...new Set(impts)].reduce((a, b) => a.concat(b), []);
    }

    let resolvedUrl: URL = undefined as any;
    if (htmlUrl) {
      if (typeof htmlUrl === 'string') {
        resolvedUrl = new URL(resolveUrl(htmlUrl, this.mapUrl, this.rootUrl));
      } else {
        resolvedUrl = htmlUrl;
      }
    }

    const analysis = analyzeHtml(html, resolvedUrl);
    const impts = [...new Set([...analysis.staticImports, ...analysis.dynamicImports])];
    await Promise.all(impts.map(impt => this.link(impt, resolvedUrl?.href)));
    return impts;
  }

  /**
   * Inject the import map into the provided HTML source
   *
   * @param html HTML source to inject into
   * @param opts Injection options
   * @returns HTML source with import map injection
   */
  async htmlInject(
    html: string,
    {
      trace = false,
      pins = !trace,
      htmlUrl = this.mapUrl,
      rootUrl = this.rootUrl,
      preload = false,
      integrity = false,
      whitespace = true,
      esModuleShims = true,
      comment = true
    }: {
      pins?: string[] | boolean;
      trace?: string[] | boolean;
      htmlUrl?: string | URL;
      rootUrl?: string | URL | null;
      preload?: boolean | 'all' | 'static';
      integrity?: boolean;
      whitespace?: boolean;
      esModuleShims?: string | boolean;
      comment?: boolean | string;
    } = {}
  ): Promise<string> {
    if (comment === true)
      comment = ' Generated by @jspm/generator - https://github.com/jspm/generator ';
    if (typeof htmlUrl === 'string') htmlUrl = new URL(htmlUrl);

    const analysis = analyzeHtml(html, htmlUrl);

    let modules =
      pins === true
        ? this.traceMap.pins || Object.keys(this.traceMap.inputMap.imports)
        : Array.isArray(pins)
        ? pins
        : [];
    if (trace) {
      const impts = await this.linkHtml(html, htmlUrl);
      modules = [...new Set([...modules, ...impts])];
    }

    var map: any, staticDeps: string[] = [], dynamicDeps: string[] = [];
    try {
      ({ map, staticDeps, dynamicDeps } = await this.extractMap(
        modules,
        htmlUrl,
        rootUrl,
        integrity
      ));
    } catch (err: any) {
      // Most likely cause of a generation failure:
      err.message +=
        '\n\nIf you are linking locally against your node_modules folder, make sure that you have all the necessary dependencies installed.';
    }

    const preloadDeps =
      preload === 'all' ? [...new Set([...staticDeps, ...dynamicDeps])] : staticDeps;

    const newlineTab = !whitespace
      ? analysis.newlineTab
      : analysis.newlineTab.includes('\n')
      ? analysis.newlineTab
      : '\n' + analysis.newlineTab;

    const replacer = new Replacer(html);

    let esms = '';
    if (esModuleShims) {
      let esmsPkg: ExactPackage;
      try {
        esmsPkg = await this.traceMap.resolver.pm.resolveLatestTarget(
          {
            name: 'es-module-shims',
            registry: 'npm',
            range: new SemverRange('*'),
            unstable: false
          },
          this.traceMap.installer!.defaultProvider,
          this.baseUrl.href,
          this.traceMap.resolver
        );
      } catch (err) {
        // This usually happens because the user is trying to use their
        // node_modules as the provider but has not installed the shim:
        let errMsg = `Unable to resolve "es-module-shims@*" under current provider "${this.traceMap.installer!.defaultProvider.provider}".`;
        if (this.traceMap.installer!.defaultProvider.provider === 'nodemodules') {
          errMsg += `\n\nJspm automatically injects a shim so that the import map in your HTML file will be usable by older browsers.\nYou may need to run "npm install es-module-shims" to install the shim if you want to link against your local node_modules folder.`;
        }
        errMsg += `\nTo disable the import maps polyfill injection, set esModuleShims: false.`;
        throw new JspmError(errMsg);
      }

      let esmsUrl =
        (await this.traceMap.resolver.pm.pkgToUrl(
          esmsPkg,
          this.traceMap.installer!.defaultProvider.provider,
          this.traceMap.installer!.defaultProvider.layer
        )) + 'dist/es-module-shims.js';

      // detect esmsUrl as a wrapper URL
      esmsUrl = await getMaybeWrapperUrl(esmsUrl, this.traceMap.resolver.fetchOpts);

      if (htmlUrl || rootUrl)
        esmsUrl = relativeUrl(new URL(esmsUrl), new URL(rootUrl ?? htmlUrl), !!rootUrl);

      esms = `<script async src="${esmsUrl}" crossorigin="anonymous"${
        integrity
          ? ` integrity="${await getIntegrity(
              new Uint8Array(
                await (await fetch(esmsUrl, this.traceMap.resolver.fetchOpts)).arrayBuffer()
              )
            )}"`
          : ''
      }></script>${newlineTab}`;

      if (analysis.esModuleShims)
        replacer.remove(analysis.esModuleShims.start, analysis.esModuleShims.end, true);
    }

    for (const preload of analysis.preloads) {
      replacer.remove(preload.start, preload.end, true);
    }

    let preloads = '';
    if (preload && preloadDeps.length) {
      let first = true;
      for (let dep of preloadDeps.sort()) {
        if (first || whitespace) preloads += newlineTab;
        if (first) first = false;
        const url =
          rootUrl || htmlUrl
            ? relativeUrl(new URL(dep), new URL(rootUrl || htmlUrl), !!rootUrl)
            : dep;
        preloads += `<link rel="modulepreload" href="${url}"${
          integrity
            ? ` integrity="${await getIntegrity(
                new Uint8Array(
                  await (
                    await fetch(new URL(dep, this.baseUrl).href, this.traceMap.resolver.fetchOpts)
                  ).arrayBuffer()
                )
              )}"`
            : ''
        } />`;
      }
    }

    if (comment) {
      const existingComment = analysis.comments.find(c =>
        replacer.source
          .slice(replacer.idx(c.start), replacer.idx(c.end))
          .includes(comment as string)
      );
      if (existingComment) {
        replacer.remove(existingComment.start, existingComment.end, true);
      }
    }

    replacer.replace(
      analysis.map.start,
      analysis.map.end,
      (comment ? '<!--' + comment + '-->' + newlineTab : '') +
        esms +
        '<script type="importmap">' +
        (whitespace ? newlineTab : '') +
        JSON.stringify(map, null, whitespace ? 2 : 0).replace(/\n/g, newlineTab) +
        (whitespace ? newlineTab : '') +
        '</script>' +
        preloads +
        (analysis.map.newScript ? newlineTab : '')
    );

    return replacer.source;
  }

  /**
   * Install a package target into the import map, including all its dependency resolutions via tracing.
   *
   * @param install Package or list of packages to install into the import map.
   * @param mode Install constraint mode.
   *
   * Passing no install list or an empty install list will reinsstall all top-level "imports" from the
   * provided input import map.
   *
   * @example
   * ```js
   * // Install a new package into the import map
   * await generator.install('react-dom');
   *
   * // Install a package version and subpath into the import map (installs lit/decorators.js)
   * await generator.install('lit@2/decorators.js');
   *
   * // Install a package version to a custom alias
   * await generator.install({ alias: 'react16', target: 'react@16' });
   *
   * // Install a specific subpath of a package
   * await generator.install({ target: 'lit@2', subpath: './html.js' });
   *
   * // Install an export from a locally located package folder into the map with multiple subpaths.
   * // The package.json is used to determine the exports and dependencies.
   * await generator.install({ alias: 'mypkg', target: './packages/local-pkg', subpaths: ['./feature1', './feature2'] });
   *
   * // Install all exports of the package, based on enumerating all the package export subpaths.
   * await generator.install({ alias: 'mypkg', target: './packages/local-pkg', subpaths: true });
   * ```
   *
   * Will respect {@link GeneratorOptions.customResolver} for dependency specifier resolution. If requiring
   * a {@link GeneratorOptions.customResolver} to apply at the top-level, use {@link Generator.link} instead.
   */
  async install(install: string | Install | (string | Install)[], mode?: InstallMode): Promise<{ staticDeps: string[]; dynamicDeps: string[] }>;
  async install(mode?: InstallMode): Promise<{ staticDeps: string[]; dynamicDeps: string[] }>;
  async install(
    install?: string | Install | (string | Install)[] | InstallMode,
    mode?: InstallMode
  ): Promise<{ staticDeps: string[]; dynamicDeps: string[] }> {
    if (
      install === 'default' ||
      install === 'latest-primaries' ||
      install === 'latest-all' ||
      install === 'freeze'
    ) {
      mode = install;
      install = [];
    }
    return this._install(install, mode);
  }

  private async _install(
    install?: string | Install | (string | Install)[],
    mode?: InstallMode
  ): Promise<{ staticDeps: string[]; dynamicDeps: string[] }> {
    // If there are no arguments, then we reinstall all the top-level locks:
    if (
      install === null ||
      install === undefined ||
      (Array.isArray(install) && install.length === 0)
    ) {
      await this.traceMap.processInputMap;

      // To match the behaviour of an argumentless `npm install`, we use
      // existing resolutions for everything unless it's out-of-range:
      mode ??= 'default';

      if (Object.keys(this.traceMap.installer!.installs.primary).length) {
        const pins = this.traceMap.pins || Object.keys(this.traceMap.inputMap.imports);
        return this._install(
          Object.entries(this.traceMap.installer!.installs.primary).map(([alias, target]) => {
            const pkgTarget = this.traceMap.installer!.constraints.primary[alias];

            // Try to reinstall lock against constraints if possible, otherwise
            // reinstall it as a URL directly (which has the downside that it
            // won't have NPM versioning semantics):
            let newTarget: string | InstallTarget = target.installUrl;
            if (pkgTarget) {
              if (pkgTarget instanceof URL) {
                newTarget = pkgTarget.href;
              } else {
                newTarget = `${pkgTarget.registry}:${pkgTarget.name}`;
              }
            }
            const subpaths = getInstallReplaySubpaths(alias, pins);

            return {
              alias,
              target: newTarget,
              subpaths
            } as Install;
          }),
          mode
        );
      }
    }

    if (!Array.isArray(install)) install = [install!];

    await this.traceMap.processInputMap; // don't race input processing

    const imports = (
      await Promise.all(
        install.map(async install => {
          // Resolve input information to a target package:
          let alias, target: InstallTarget, subpath, subpaths: string[] | true | undefined;
          if (typeof install === 'string' || typeof install.target === 'string') {
            ({ alias, target, subpath } = (await installToTarget.call(
              this,
              install,
              this.traceMap.installer!.defaultRegistry
            )) as any);
            if ((install as Install)?.subpaths) subpaths = (install as Install).subpaths;
          } else {
            ({ alias, target, subpath, subpaths } = install);
            validatePkgName(alias!);
          }

          this.log(
            'generator/install',
            `Adding primary constraint for ${alias}: ${JSON.stringify(target)}`
          );

          // By default, an install takes the latest compatible version for primary
          // dependencies, and existing in-range versions for secondaries:
          mode ??= 'latest-primaries';

          const installed = await this.traceMap.add(alias, target, mode);

          // expand all package subpaths
          if (subpaths === true) {
            const pcfg = (await this.traceMap.resolver.getPackageConfig(installed.installUrl))!;
            // no entry point case
            if (!pcfg.exports && !pcfg.main) {
              return [];
            }
            // main only
            if (!pcfg.exports || !Object.keys(pcfg.exports).every(expt => expt[0] === '.')) {
              return alias;
            }
            // If the provider supports it, get a file listing for the package to assist with glob expansions
            const fileList = await this.traceMap.resolver.getFileList(installed.installUrl);
            // Expand exports into entry point list
            const resolutionMap = new Map<string, string>();
            await expandExportsResolutions(
              pcfg.exports!,
              this.traceMap.resolver.env,
              fileList,
              resolutionMap
            );
            return [...resolutionMap].map(([subpath, _entry]) => alias + subpath.slice(1));
          } else if (subpaths) {
            subpaths.every(subpath => {
              if (typeof subpath !== 'string' || (subpath !== '.' && !subpath.startsWith('./')))
                throw new Error(
                  `Install subpath "${subpath}" must be equal to "." or start with "./".`
                );
            });
            return subpaths.map(subpath => alias + subpath.slice(1));
          } else {
            return alias + (subpath ? subpath.slice(1) : '');
          }
        })
      )
    ).flatMap((i: any) => i);

    const pins = this.traceMap.pins || Object.keys(this.traceMap.inputMap.imports);
    await Promise.all(
      imports.map(async (impt: any) => {
        await this.traceMap.visit(
          impt,
          {
            installMode: mode!,
            toplevel: true
          },
          this.mapUrl.href
        );

        // Add the target import as a top-level pin
        // we do this after the trace, so failed installs don't pollute the map
        if (!pins.includes(impt)) pins.push(impt);
      })
    );

    const { map, staticDeps, dynamicDeps } = await this.traceMap.extractMap(
      pins,
      this.integrity,
      true,
      this.mapUrl.href
    );
    this.map = map;
    return { staticDeps, dynamicDeps };
  }

  /**
   * Locking install, retraces all top-level pins but does not change the
   * versions of anything (similar to "npm ci").
   * @deprecated use generator.install('freeze') instead.
   */
  async reinstall() {
    return await this.install('freeze');
  }

  /**
   * Updates the versions of the given packages to the latest versions
   * compatible with their parent's package.json ranges. If no packages are
   * given then all the top-level packages in the "imports" field of the
   * initial import map are updated.
   *
   * @param {string | string[]} pkgNames Package name or list of package names to update.
   */
  async update(pkgNames?: string | string[]) {
    if (typeof pkgNames === 'string') pkgNames = [pkgNames];
    await this.traceMap.processInputMap;

    const primaryResolutions = this.traceMap.installer!.installs.primary;
    const primaryConstraints = this.traceMap.installer!.constraints.primary;

    // Matching the behaviour of "npm update":
    let mode: InstallMode = 'latest-primaries';
    if (!pkgNames) {
      pkgNames = Object.keys(primaryResolutions);
      mode = 'latest-all';
    }

    const installs: Install[] = [];
    for (const name of pkgNames) {
      const resolution = primaryResolutions[name];
      if (!resolution) {
        throw new JspmError(
          `No "imports" package entry for "${name}" to update. Note update takes package names not package specifiers.`
        );
      }
      const { installUrl } = resolution;
      const subpaths = (this.traceMap.pins || Object.keys(this.traceMap.inputMap.imports))
        .filter(pin => pin === name || (pin.startsWith(name) && pin[name.length] === '/'))
        .map(pin => `.${pin.slice(name.length)}` as '.' | `./${string}`);
      // use package.json range if present
      if (primaryConstraints[name]) {
        installs.push({
          alias: name,
          subpaths,
          target: { pkgTarget: primaryConstraints[name] }
        });
      }
      // otherwise synthetize a range from the current package version
      else {
        const pkg = await this.traceMap.resolver.pm.parseUrlPkg(installUrl);
        if (!pkg)
          throw new Error(
            `Unable to determine a package version lookup for ${name}. Make sure it is supported as a provider package.`
          );
        const target = {
          pkgTarget: {
            registry: pkg.pkg.registry,
            name: pkg.pkg.name,
            range: new SemverRange('^' + pkg.pkg.version),
            unstable: false
          }
        };
        installs.push({ alias: name, subpaths, target });
      }
    }

    await this._install(installs, mode);
    const { map, staticDeps, dynamicDeps } = await this.traceMap.extractMap(
      this.traceMap.pins || Object.keys(this.traceMap.inputMap.imports),
      this.integrity
    );
    this.map = map;
    return { staticDeps, dynamicDeps };
  }

  async uninstall(names: string | string[]) {
    if (typeof names === 'string') names = [names];
    await this.traceMap.processInputMap;
    let pins = this.traceMap.pins || Object.keys(this.traceMap.inputMap.imports);
    const unusedNames = new Set([...names]);
    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i];
      const pinNames = names.filter(
        name => name === pin || (name.endsWith('/') && pin.startsWith(name))
      );
      if (pinNames.length) {
        pins.splice(i--, 1);
        for (const name of pinNames) unusedNames.delete(name);
      }
    }
    if (unusedNames.size) {
      throw new JspmError(`No "imports" entry for "${[...unusedNames][0]}" to uninstall.`);
    }
    if (this.traceMap.pins) this.traceMap.pins = pins;
    const { staticDeps, dynamicDeps, map } = await this.traceMap.extractMap(
      this.traceMap.pins || Object.keys(this.traceMap.inputMap.imports),
      this.integrity
    );
    this.map = map;
    return { staticDeps, dynamicDeps };
  }

  /**
   * Populate virtual source files into the generator for further linking or install operations, effectively
   * intercepting network and file system requests to those URLs.
   *
   * @param baseUrl base URL under which all file data is located @example `"file:///path/to/package/"` or
   * `"https://site.com/pkg@1.2.3/)"`.
   * @param fileData Key value pairs of file data strings or buffers virtualized under the provided
   * URL base path,
   * @example
   * ```
   * {
   *   'package.json': '',
   *   'dir/file.bin': new Uint8Array([1,2,3])
   * }
   * ```
   */
  setVirtualSourceData(baseUrl: string, fileData: SourceData) {
    setVirtualSourceData(baseUrl, fileData);
  }

  /**
   * Publish a package to a JSPM provider
   *
   * This function creates a tarball from the provided files and uploads it.
   *
   * @param options Publish options
   * @returns Promise that resolves with the package URL, map URL, and
   *          an optional copy-paste code snippet demonstrating usage.
   *
   * @example
   * ```js
   * import { Generator } from '@jspm/generator';
   *
   * const generator = new Generator({
   *   inputMap: { ...custom import map... }
   * });
   * const result = await generator.publish({
   *   package: './pkg',
   *   provider: 'jspm.io',
   *   importMap: true,
   *   link: true,
   * });
   *
   * // URL to the published package and published import map
   * console.log(result.packageUrl, result.mapUrl);
   * // HTML code snippets demonstrating how to run the published code in a browser
   * console.log(result.codeSnippets);
   * ```
   * JSPM will fully link all dependencies when link: true is provided, and
   * populate them into the import map of the generator instance provided
   * to the publish.
   *
   * Alternatively, instead of a local package path, package can also be provided
   * as a record of virtual sources.
   *
   */
  async publish({
    package: pkg,
    importMap = true,
    install = importMap === true,
    version,
    name,
    provider = 'jspm.io'
  }: Publish): Promise<PublishOutput> {
    if (typeof pkg === 'object') {
      const virtualUrl = `https://virtual/${name ?? 'publish'}@${
        version ?? Math.round(Math.random() * 10_000)
      }`;
      this.setVirtualSourceData(virtualUrl, pkg);
      pkg = virtualUrl;
    }
    if (typeof pkg !== 'string' || !isURL(pkg) || pkg.match(/^\w\:/)) {
      throw new JspmError(`Package must be a URL string, received "${pkg}"`);
    }

    if (!pkg.endsWith('/')) pkg += '/';

    // Get the file list from the package and read all the file data
    const fileList = await this.traceMap.resolver.getFileList(pkg);
    if (!fileList) throw new JspmError(`Unable to get file listing for ${pkg}`);
    const fileData: SourceData = {};
    await Promise.all(
      [...fileList].map(async file => {
        const res = await fetch(pkg + file, this.traceMap.resolver.fetchOpts);
        if (!res.ok) {
          throw new JspmError(
            `Unable to read file ${file} in ${pkg} - got ${res.statusText || res.status}`
          );
        }
        fileData[file] = await res.arrayBuffer();
      })
    );

    // Ensure package.json exists and has correct name and version
    const pkgJson = fileData['package.json'] || '{}';
    // Parse package.json if it's a string
    let pjson;
    try {
      if (typeof pkgJson === 'string') {
        pjson = JSON.parse(pkgJson);
      } else {
        // Convert ArrayBuffer to string and parse
        const decoder = new TextDecoder();
        pjson = JSON.parse(decoder.decode(pkgJson));
      }
    } catch (err: any) {
      throw new JspmError('Invalid package.json: ' + err.message);
    }

    if (pjson.jspm) {
      const { jspm } = pjson;
      delete pjson.jspm;
      Object.assign(pjson, jspm);
    }

    const ignore: string[] = Array.isArray(pjson.ignore) ? pjson.ignore : [];
    const files: string[] = Array.isArray(pjson.files) ? pjson.files : [];

    const filteredFileList = [];
    for (const file of fileList) {
      for (const ignorePattern of ignore) {
        if (minimatch(file, ignorePattern)) {
          continue;
        }
      }
      const parts = file.split('/');
      if (
        parts.includes('node_modules') ||
        parts.some(part => part.startsWith('.')) ||
        parts.includes('package-lock.json')
      )
        continue;
      if (files.length) {
        for (const includePattern of files) {
          if (minimatch(file, includePattern)) {
            filteredFileList.push(file);
          }
        }
      } else {
        filteredFileList.push(file);
      }
    }

    for (const file of Object.keys(fileData)) {
      if (!filteredFileList.includes(file)) delete fileData[file];
    }

    if (filteredFileList.length === 0 && !importMap)
      throw new JspmError('At least one file or importMap is required for publishing');

    if (!name) {
      name = pjson.name;
      if (!name)
        throw new JspmError(
          `Package name is required for publishing, either in the package.json or as a publish option.`
        );
      if (!name.match(/^[a-zA-Z0-9_\-]+$/))
        throw new JspmError(`Invalid package name for publish.`);
    }
    if (!version) {
      version = pjson.version;
      if (!version)
        throw new JspmError(
          `Package version is required for publishing, either in the package.json or as a publish option.`
        );
    }

    const exactPkg = { name, version, registry: 'app' };
    const packageUrl = await this.traceMap.resolver.pm.pkgToUrl(
      { name, version, registry: 'app' },
      provider
    );

    if (install) {
      await this.install({ alias: name, target: pkg, subpaths: true }, 'freeze');
      // we then substitute the package URL with the final publish URL
      this.importMap.rebase('about:blank');
      this.importMap.replace(pkg, packageUrl);
    }

    const map =
      importMap === true
        ? this.map.clone()
        : importMap
        ? new ImportMap({ map: importMap })
        : undefined;
    if (map) {
      if (this.flattenScopes) map.flatten();
      map.sort();
      this.simplify(map);
    }

    // If importMap option is set to true, pass a clone of the generator's map
    return await (this.traceMap.resolver.pm.publish as any)(
      exactPkg,
      provider,
      (this.traceMap.pins || Object.keys(this.traceMap.inputMap.imports)).sort((a, b) => {
        const aIsPublishAlias = a === name || (a.startsWith(name) && a[name.length] === '/');
        const bIsPublishAlias = b === name || (b.startsWith(name) && b[name.length] === '/');
        if (aIsPublishAlias && !bIsPublishAlias) return -1;
        else if (bIsPublishAlias && !aIsPublishAlias) return 1;
        return a > b ? 1 : -1;
      }),
      fileData,
      map
    );
  }

  /**
   * Authenticate with a provider to obtain an authentication token.
   *
   * @param options Authentication options including provider, username, and verify callback
   * @returns Promise resolving to the authentication token
   */
  async auth(
    options: {
      provider?: string;
      username?: string;
      verify?: (url: string, instructions: string) => void;
    } = {}
  ): Promise<{ token: string }> {
    const providerName = options.provider || 'jspm.io';

    return this.traceMap.resolver.pm.auth(providerName, {
      username: options.username,
      verify: options.verify
    });
  }

  /**
   * Eject a published package by downloading it to the provided local folder,
   * and stitching its import map into the generator import map.
   */
  async eject(
    {
      name,
      version,
      registry = 'app',
      provider = 'jspm.io'
    }: { name: string; version: string; registry?: string; provider?: string },
    outDir: string
  ) {
    if (!isNode) {
      throw new JspmError(`Eject functionality is currently only available on a filesystem`);
    }
    const pkg = { name, version, registry };
    const packageUrl = await this.traceMap.resolver.pm.pkgToUrl(
      { name, version, registry: 'app' },
      provider
    );
    const mapUrl = packageUrl + 'importmap.json';

    let publishMap: null | IImportMap = null;
    try {
      const res = await fetch(mapUrl);
      if (res.status !== 404) {
        if (!res.ok && res.status !== 304) {
          throw res.statusText || res.status;
        }
        publishMap = await res.json();
      }
    } catch (e) {
      throw new JspmError(`Unable to load import map ${mapUrl}: ${e}`);
    }

    const packageFiles = await this.traceMap.resolver.pm.download(pkg, provider);

    const [{ writeFileSync, mkdirSync }, { resolve, dirname }, { fileURLToPath, pathToFileURL }] =
      await Promise.all([
        import(eval('"node:fs"')),
        import(eval('"node:path"')),
        import(eval('"node:url"'))
      ]);
    outDir = resolve(fileURLToPath(this.baseUrl), outDir);
    for (const [path, source] of Object.entries(packageFiles)) {
      const resolved = resolve(outDir, path);
      mkdirSync(dirname(resolved), { recursive: true });
      writeFileSync(resolved, source);
    }

    if (publishMap) {
      await this.mergeMap(publishMap, 'about:blank');
    }

    this.map.replace(packageUrl, pathToFileURL(outDir).href + '/');
    this.map.rebase(this.mapUrl, this.rootUrl);
  }

  /**
   * Merges an import map into this instance's import map.
   *
   * Performs a full retrace of the map to be merged, building out its version constraints separately,
   * and expanding scopes previously flattened by the scope-flattening "flattenScopes" option that occurs
   * by default for extracted import maps.
   */
  async mergeMap(map: IImportMap, mapUrl?: string) {
    const mergeGenerator = this.clone();
    mergeGenerator.flattenScopes = false;
    await mergeGenerator.addMappings(map, mapUrl);
    await mergeGenerator.install('freeze');
    await this.addMappings(mergeGenerator.getMap(mergeGenerator.mapUrl, mergeGenerator.rootUrl));
    await this.install('freeze');
  }

  /**
   * Create a clone of this generator instance with the same configuration.
   *
   * Does not clone the internal import map or install state.
   */
  clone(): Generator {
    const cloned = new Generator({
      baseUrl: this.baseUrl,
      mapUrl: this.mapUrl,
      rootUrl: this.rootUrl,
      env: this.traceMap.resolver.env,
      defaultProvider:
        this.traceMap.installer!.defaultProvider.provider +
        '#' +
        this.traceMap.installer!.defaultProvider.layer,
      defaultRegistry: this.traceMap.installer!.defaultRegistry,
      resolutions: this.traceMap.installer!.resolutions,
      fetchOptions: this.traceMap.resolver.fetchOpts,
      commonJS: this.traceMap.resolver.traceCjs,
      typeScript: this.traceMap.resolver.traceTs,
      system: this.traceMap.resolver.traceSystem,
      integrity: this.integrity,
      preserveSymlinks: this.traceMap.resolver.preserveSymlinks,
      flattenScopes: this.flattenScopes,
      combineSubpaths: this.combineSubpaths,
      expandWildcards: this.expandWildcards,
      scopedLink: this.scopedLink
    });
    cloned.traceMap.resolver.pm.providers = {
      ...this.traceMap.resolver.pm.providers
    };
    return cloned;
  }

  /**
   * Extracts a smaller import map from a larger import map
   *
   * This is for the use case where one large import map is being used to manage
   * dependencies across multiple entry points in say a multi-page application,
   * and one pruned import map is desired just for a set of top-level imports which
   * is smaller than the full set of top-level imports
   *
   * These top-level imports can be provided as a list of "pins" to extract, and a
   * fully pruned map with only the necessary scoped mappings will be traced out
   * of the larger map while respecting its resolutions.
   */
  async extractMap(
    pins: string | string[],
    mapUrl?: URL | string,
    rootUrl?: URL | string | null,
    integrity?: boolean
  ) {
    if (typeof mapUrl === 'string') mapUrl = new URL(mapUrl, this.baseUrl);
    if (typeof rootUrl === 'string') rootUrl = new URL(rootUrl, this.baseUrl);
    if (!Array.isArray(pins)) pins = [pins];
    if (typeof integrity !== 'boolean') integrity = this.integrity;
    await this.traceMap.processInputMap;
    const { map, staticDeps, dynamicDeps } = await this.traceMap.extractMap(pins, integrity);
    map.rebase(mapUrl, rootUrl);
    if (this.flattenScopes) map.flatten();
    map.sort();
    this.simplify(map);
    return { map: map.toJSON(), staticDeps, dynamicDeps };
  }

  /**
   * Resolve a specifier using the import map.
   *
   * @param specifier Module to resolve
   * @param parentUrl ParentURL of module to resolve
   * @returns Resolved URL string
   */
  resolve(specifier: string, parentUrl: URL | string = this.baseUrl) {
    if (typeof parentUrl === 'string') parentUrl = new URL(parentUrl, this.baseUrl);
    const resolved = this.map.resolve(specifier, parentUrl);
    if (resolved === null)
      throw new JspmError(
        `Unable to resolve "${specifier}" from ${parentUrl.href}`,
        'MODULE_NOT_FOUND'
      );
    return resolved;
  }

  get importMap() {
    return this.map;
  }

  getAnalysis(url: string | URL): ModuleAnalysis {
    if (typeof url !== 'string') url = url.href;
    const trace = this.traceMap.resolver.getAnalysis(url);
    if (!trace) throw new Error(`The URL ${url} has not been traced by this generator instance.`);
    return {
      format: trace.format!,
      staticDeps: trace.deps!,
      dynamicDeps: trace.dynamicDeps!,
      cjsLazyDeps: trace.cjsLazyDeps || []
    };
  }

  /**
   * Get the serializable cache for this generator session.
   *
   * Returns a pruned cache containing only the package configs and analysis
   * entries that were actually used in the final module graph. This cache
   * can be saved to disk and passed to a future Generator via the `traceCache`
   * option to speed up subsequent runs.
   *
   * Only includes cacheable formats (json, esm, css, wasm) and entries without
   * parse errors. CJS/TypeScript/System formats are excluded as they require
   * dynamic transpilation.
   *
   * `packageConfigSkips` omits cached package configs and package bases for
   * URLs starting with any listed base, while still caching their module
   * analysis (deps). Use this for providers whose `getPackageConfig` is dynamic
   * - caching a snapshot of such configs would pin stale package boundaries on
   * subsequent runs. `moduleSkips` omits cached module analysis for URLs
   * starting with any listed base.
   *
   * @example
   * ```js
   * const generator = new Generator({ traceCache: true });
   * await generator.install('react');
   * const cache = generator.getCache();
   * fs.writeFileSync('cache.json', JSON.stringify(cache));
   * ```
   */
  getCache({
    moduleSkips = [],
    packageConfigSkips = []
  }: { moduleSkips?: string[]; packageConfigSkips?: string[] } = {}): GeneratorCache {
    const resolver = this.traceMap.resolver;
    const traceMap = this.traceMap;
    const skipModule = (url: string) => moduleSkips.some(base => url.startsWith(base));
    const skipPackageConfig = (url: string) =>
      packageConfigSkips.some(base => url.startsWith(base));
    const packageConfigUrls = new Set([
      ...resolver.visitedUrls,
      ...resolver.touchedPackageConfigUrls
    ]);
    const analysisUrls = new Set([...resolver.visitedUrls, ...resolver.touchedAnalysisUrls]);

    const cache: GeneratorCache = {
      packageConfigs: {},
      analysis: {},
      packageBases: {}
    };

    for (const url of packageConfigUrls) {
      if (skipPackageConfig(url)) continue;
      const pcfg = resolver.pcfgs[url];
      if (pcfg !== undefined) {
        cache.packageConfigs[url] = pcfg;
      }
    }

    for (const url of analysisUrls) {
      const entry = resolver.traceEntries[url];
      const packageBase = resolver.packageBaseCache[url];
      if (typeof packageBase === 'string' && !skipPackageConfig(url)) {
        cache.packageBases![url] = packageBase;
      }

      if (skipModule(url)) continue;

      if (!entry) continue;
      if (entry.parseError) {
        if (resolver.immutableUrls.has(url)) {
          cache.analysis[url] = {
            deps: [],
            dynamicDeps: [],
            size: 0,
            integrity: '',
            format: 'esm',
            wasCjs: false
          };
        }
        continue;
      }
      if (['json', 'esm', 'css', 'wasm'].includes(entry.format!)) {
        cache.analysis[url] = {
          deps: entry.deps!,
          dynamicDeps: entry.dynamicDeps!,
          size: entry.size,
          integrity: entry.integrity,
          format: entry.format as 'json' | 'esm' | 'css' | 'wasm',
          wasCjs: entry.wasCjs
        };
      }
    }

    // Clean up empty sections
    if (!Object.keys(cache.packageBases!).length) delete cache.packageBases;

    return cache;
  }

  /**
   * Simplify the import map by collapsing wildcard-expanded prefixes into
   * trailing-slash entries, and optionally combining scope subpaths.
   * Wildcard condensing is always applied when expandWildcards is false (lossless).
   * combineSubpaths() additionally combines scopes (or both) when enabled.
   */
  private simplify(map: ImportMap) {
    if (!this.expandWildcards) {
      const resolver = this.traceMap.resolver;
      const condensePrefixes: { imports?: Set<string>; scopes?: Record<string, Set<string>> } = {};

      const resolveTarget = (target: string): string => {
        if (isURL(target)) return target;
        if (map.rootUrl && target.startsWith('/')) return new URL(target, map.rootUrl).href;
        return new URL(target, map.mapUrl!).href;
      };

      const packageBaseCache = new Map<string, string | null>();
      const getPackageBase = (target: string): string | null => {
        let cached = packageBaseCache.get(target);
        if (cached !== undefined) return cached;
        const pkgUrl = resolver.getPackageBaseCached(resolveTarget(target));
        cached = pkgUrl || null;
        packageBaseCache.set(target, cached);
        return cached;
      };

      const wildcardPrefixCache = new Map<string, string[]>();

      const collectPrefixes = (entries: Record<string, string>) => {
        const prefixes = new Set<string>();
        const seen = new Set<string>();
        for (const [key, target] of Object.entries(entries)) {
          const pkgUrl = getPackageBase(target);
          if (!pkgUrl || seen.has(pkgUrl)) continue;
          seen.add(pkgUrl);

          let wildcardPrefixes = wildcardPrefixCache.get(pkgUrl);
          if (!wildcardPrefixes) {
            wildcardPrefixes = [...resolver.getWildcardPrefixes(pkgUrl)];
            wildcardPrefixCache.set(pkgUrl, wildcardPrefixes);
          }
          if (!wildcardPrefixes.length) continue;

          const firstSlash = key.indexOf('/');
          const pkgName =
            firstSlash === -1
              ? key
              : key[0] === '@'
              ? key.slice(0, key.indexOf('/', firstSlash + 1))
              : key.slice(0, firstSlash);
          for (const prefix of wildcardPrefixes) prefixes.add(pkgName + prefix.slice(1));
        }
        return prefixes.size ? prefixes : undefined;
      };

      const importPrefixes = collectPrefixes(map.imports);
      if (importPrefixes) condensePrefixes.imports = importPrefixes;

      for (const scopeUrl of Object.keys(map.scopes)) {
        const scopePrefixes = collectPrefixes(map.scopes[scopeUrl]);
        if (scopePrefixes) {
          condensePrefixes.scopes = condensePrefixes.scopes || {};
          condensePrefixes.scopes[scopeUrl] = scopePrefixes;
        }
      }

      if (condensePrefixes.imports || condensePrefixes.scopes)
        map.condenseImports(condensePrefixes);
    }
    if (this.combineSubpaths !== 'none') map.combineSubpaths(this.combineSubpaths);
  }

  /**
   * Obtain the final generated import map, with flattening and subpaths combined
   * (unless otherwise disabled via the Generator flattenScopes and combineSubpaths options).
   *
   * A mapUrl can be provided typically as a file URL corresponding to the location of the import map on the file
   * system. Relative paths to other files on the filesystem will then be tracked as map-relative and
   * output as relative paths, assuming the map retains its relative relation to local modules regardless
   * of the publish URLs.
   *
   * When a root URL is provided pointing to a local file URL, `/` prefixed URLs will be used for all
   * modules contained within this file URL base as root URL relative instead of map relative URLs like the above.
   */
  getMap(mapUrl?: string | URL, rootUrl?: string | URL | null) {
    const map = this.map.clone();
    if (mapUrl) map.rebase(mapUrl, rootUrl);
    if (this.flattenScopes) map.flatten();
    map.sort();
    this.simplify(map);
    return map.toJSON();
  }
}

export interface LookupOptions {
  provider?: string;
  cache?: 'offline' | boolean;
}

/**
 * _Use the internal fetch implementation, useful for hooking into the same shared local fetch cache._
 *
 * ```js
 * import { fetch } from '@jspm/generator';
 *
 * const res = await fetch(url);
 * console.log(await res.text());
 * ```
 *
 * Use the `{ cache: 'no-store' }` option to disable the cache, and the `{ cache: 'force-cache' }` option to enforce the offline cache.
 */
export async function fetch(url: string, opts: any = {}) {
  // @ts-ignore
  return _fetch(url, opts);
}

/**
 * Get the lookup resolution information for a specific install.
 *
 * @param install The install object
 * @param lookupOptions Provider and cache defaults for lookup
 * @returns The resolved install and exact package \{ install, resolved \}
 */
export async function lookup(install: string | Install, { provider, cache }: LookupOptions = {}) {
  const generator = new Generator({ cache: !cache, defaultProvider: provider });
  const { target, subpath, alias } = await installToTarget.call(
    generator,
    install,
    generator.traceMap.installer!.defaultRegistry
  );
  if (typeof target === 'string')
    throw new Error(
      `Resolved install "${install}" to package specifier ${target}, but expected a fully qualified install target.`
    );

  const { pkgTarget } = target;
  if (pkgTarget instanceof URL) throw new Error('URL lookups not supported');
  const resolved = await generator.traceMap.resolver.pm.resolveLatestTarget(
    pkgTarget,
    generator.traceMap.installer!.getProvider(pkgTarget),
    generator.baseUrl.href,
    generator.traceMap.resolver
  );
  return {
    install: {
      target: {
        registry: pkgTarget.registry,
        name: pkgTarget.name,
        range: pkgTarget.range.toString()
      },
      subpath,
      alias
    },
    resolved: resolved
  };
}

/**
 * Get the package.json configuration for a specific URL or package.
 *
 * @param pkg Package to lookup configuration for
 * @param lookupOptions Optional provider and cache defaults for lookup
 * @returns Package JSON configuration
 *
 * @example
 * ```js
 * import { getPackageConfig } from '@jspm/generator';
 *
 * // Supports a resolved package
 * {
 *   const packageJson = await getPackageConfig({ registry: 'npm', name: 'lit-element', version: '2.5.1' });
 * }
 *
 * // Or alternatively provide any URL
 * {
 *   const packageJson = await getPackageConfig('https://ga.jspm.io/npm:lit-element@2.5.1/lit-element.js');
 * }
 * ```
 */
export async function getPackageConfig(
  pkg: string | URL | ExactPackage,
  { provider, cache }: LookupOptions = {}
): Promise<PackageConfig | null> {
  const generator = new Generator({ cache: !cache, defaultProvider: provider });
  if (typeof pkg === 'object' && 'name' in pkg)
    pkg = await generator.traceMap.resolver.pm.pkgToUrl(
      pkg,
      generator.traceMap.installer!.defaultProvider.provider,
      generator.traceMap.installer!.defaultProvider.layer
    );
  else if (typeof pkg === 'string') pkg = new URL(pkg).href;
  else pkg = pkg.href;
  return generator.traceMap.resolver.getPackageConfig(pkg);
}

/**
 * Get the package base URL for the given module URL.
 *
 * @param url module URL
 * @param lookupOptions Optional provider and cache defaults for lookup
 * @returns Base package URL
 *
 * Modules can be remote CDN URLs or local file:/// URLs.
 *
 * All modules in JSPM are resolved as within a package boundary, which is the
 * parent path of the package containing a package.json file.
 *
 * For JSPM CDN this will always be the base of the package as defined by the
 * JSPM CDN provider. For non-provider-defined origins it is always determined
 * by trying to fetch the package.json in each parent path until the root is reached
 * or one is found. On file:/// URLs this exactly matches the Node.js resolution
 * algorithm boundary lookup.
 *
 * This package.json file controls the package name, imports resolution, dependency
 * resolutions and other package information.
 *
 * getPackageBase will return the folder containing the package.json,
 * with a trailing '/'.
 *
 * This URL will either be the root URL of the origin, or it will be a
 * path "pkgBase" such that fetch(`${pkgBase}package.json`) is an existing
 * package.json file.
 *
 * @example
 * ```js
 *   import { getPackageBase } from '@jspm/generator';
 *   const pkgUrl = await getPackageBase('https://ga.jspm.io/npm:lit-element@2.5.1/lit-element.js');
 *   // Returns: https://ga.jspm.io/npm:lit-element@2.5.1/
 * ```
 */
export async function getPackageBase(
  url: string | URL,
  { provider, cache }: LookupOptions = {}
): Promise<string> {
  const generator = new Generator({ cache: !cache, defaultProvider: provider });
  return generator.traceMap.resolver.getPackageBase(typeof url === 'string' ? url : url.href);
}

/**
 * Get the package metadata for the given module or package URL.
 *
 * @param url URL of a module or package for a configured provider.
 * @param lookupOptions Optional provider and cache defaults for lookup.
 * @returns Package metadata for the given URL if one of the configured
 *          providers owns it, else null.
 *
 * The returned metadata will always contain the package name, version and
 * registry, along with the provider name and layer that handles resolution
 * for the given URL.
 */
export async function parseUrlPkg(
  url: string | URL,
  { provider, cache }: LookupOptions = {}
): Promise<ExactModule | null> {
  const generator = new Generator({ cache: !cache, defaultProvider: provider });
  return generator.traceMap.resolver.pm.parseUrlPkg(typeof url === 'string' ? url : url.href);
}

/**
 * Returns a list of providers that are supported by default.
 *
 * @returns List of valid provider strings supported by default.
 *
 * To use one of these providers, pass the string to either the "defaultProvider"
 * option or the "providers" mapping when constructing a Generator.
 */
export function getDefaultProviders(): string[] {
  return getDefaultProviderStrings();
}

async function installToTarget(
  this: Generator,
  install: Install | string,
  defaultRegistry: string
): Promise<Install> {
  if (typeof install === 'string') install = { target: install };
  if (typeof install.target !== 'string')
    throw new Error('All installs require a "target" string.');
  if (
    install.subpath !== undefined &&
    (typeof install.subpath !== 'string' ||
      (install.subpath !== '.' && !install.subpath.startsWith('./')))
  )
    throw new Error(
      `Install subpath "${install.subpath}" must be a string equal to "." or starting with "./".${
        typeof install.subpath === 'string'
          ? `\nTry setting the subpath to "./${install.subpath}"`
          : ''
      }`
    );

  const { alias, target, subpath } = await parseTarget(
    this.traceMap.resolver,
    install.target as string,
    this.baseUrl,
    defaultRegistry
  );

  return {
    target,
    alias: install.alias || alias,
    subpath: install.subpath || subpath
  };
}

function getInstallReplaySubpaths(alias: string, pins: string[]): InstallSubpath[] {
  const subpaths = pins
    .filter(pin => {
      const isExactPin = pin === alias;
      const isSubpathPin = pin.startsWith(alias) && pin[alias.length] === '/';
      return isExactPin || isSubpathPin;
    })
    .map(pin => {
      const pinSubpath = pin.slice(alias.length);
      return toInstallSubpath(pinSubpath);
    });

  if (subpaths.length) return subpaths;
  return [rootInstallSubpath];
}

function toInstallSubpath(pinSubpath: string): InstallSubpath {
  if (!pinSubpath) return rootInstallSubpath;
  return `.${pinSubpath}` as InstallSubpath;
}

function detectDefaultProvider(
  defaultProvider: string | null,
  inputMap: IImportMap | null,
  pm: ProviderManager
) {
  // We only use top-level install information to detect the provider:
  const counts: Record<string, number> = {};
  for (const url of Object.values(inputMap?.imports || {})) {
    const name = pm.providerNameForUrl(url);
    if (name) {
      counts[name] = (counts[name] || 0) + 1;
    }
  }

  let winner: string | null = null;
  let winnerCount = 0;
  for (const [name, count] of Object.entries(counts)) {
    if (count > winnerCount) {
      winner = name;
      winnerCount = count;
    }
  }

  // TODO: this should be the behaviour once we support full 'providers' opt
  // The leading provider in the input map takes precedence as the provider of
  // the root package. Failing that, the user-provided default is used. The
  // 'providers' field can be used for hard-overriding this:
  // return winner || defaultProvider || "jspm.io";

  return defaultProvider || winner || 'jspm.io';
}

export {
  // utility export
  analyzeHtml,
  // hook export
  setFetch
};

export type {
  PublishOutput as DeployOutput,
  ExactModule,
  ExactPackage,
  ExportsTarget,
  HtmlAnalysis,
  HtmlTag,
  HtmlAttr,
  PackageTarget,
  InstallMode,
  InstallTarget,
  LatestPackageTarget,
  Log,
  LogStream,
  PackageConfig,
  PackageProvider,
  ParsedMap,
  Provider,
  SourceData
};
