/*
 *   Copyright 2020 Guy Bedford (http://guybedford.com)
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */

import { baseUrl as envBaseUrl, deepClone, alphabetize, isPlain, sort, defaultStyle, jsonParseStyled, jsonStringifyStyled, JspmError } from './utils.ts';
import { InstallOptions, Installer } from './installer.ts';
import { getScopeMatches, getMapMatch, analyze } from './installtree.ts';

export interface TraceOptions {
  depcache?: boolean;
  system?: boolean;
  static?: boolean;
}

export interface ImportMap {
  imports: Record<string, string | null>;
  scopes: {
    [scope: string]: Record<string, string | null>;
  };
  integrity: {
    [url: string]: string;
  };
  depcache: {
    [url: string]: string[];
  };
}

const Pool = (n = 1) => class PoolClass {
  c = 0;
  q: (() => void)[] = [];
  async job () { ++this.c > n && await new Promise(r => this.q.push(r)); }
  next () { this.c--; this.q.pop() || (() => {}) }
};

interface TraceEntry {
  deps: Record<string, URL | null>;
  dynamicDeps: Record<string, URL | null>;
  dynamicOnly: boolean;
  size: number;
  order: number;
  integrity: string;
  system: boolean;
}
export interface Trace {
  [url: string]: TraceEntry;
}

export class TraceMap {
  private _baseUrl = envBaseUrl;
  private _map: ImportMap = {
    imports: Object.create(null),
    scopes: Object.create(null),
    integrity: Object.create(null),
    depcache: Object.create(null),
  };
  conditions = ['browser', 'development'];
  private _p = new (Pool(1));
  private mapStyle = defaultStyle;

  constructor (baseUrl: string | URL, map?: ImportMap | string, conditions?: string[]) {
    if (typeof map === 'string')
      ({ json: map , style: this.mapStyle } = jsonParseStyled(map));
    if (typeof map === 'object')
      this.extend(map, true);
    if (baseUrl) {
      if (!(baseUrl instanceof URL))
        this._baseUrl = new URL(baseUrl + (baseUrl.endsWith('/') ? '' : '/'), envBaseUrl);
    }
    if (conditions)
      this.conditions = conditions;
  }

  set (map: ImportMap) {
    this._map.imports = map.imports || Object.create(null);
    this._map.scopes = map.scopes || Object.create(null);
    this._map.integrity = map.integrity || Object.create(null);
    this._map.depcache = map.depcache || Object.create(null);
    return this;
  }

  remove (pkg: string): boolean {
    if (!this._map.imports[pkg])
      return false;
    delete this._map.imports[pkg];
    return true;
  }

  extend (map: ImportMap, overrideScopes = false) {
    if (map.imports) Object.assign(this._map.imports, map.imports);
    if (map.scopes) {
      if (overrideScopes) {
        Object.assign(this._map.scopes, map.scopes);
      }
      else {
        for (const scope of Object.keys(map.scopes))
          Object.assign(this._map.scopes[scope] = this._map.scopes[scope] || Object.create(null), map.scopes[scope]);
      }
    }
    if (map.integrity) Object.assign(this._map.integrity, map.integrity);
    if (map.depcache) Object.assign(this._map.depcache, map.depcache);
    return this;
  }

  baseUrlRelative (url: URL) {
    const href = url.href;
    const baseUrlHref = this._baseUrl.href;
    if (href.startsWith(baseUrlHref))
      return './' + href.slice(baseUrlHref.length);
    if (url.protocol !== this._baseUrl.protocol || url.host !== this._baseUrl.host || url.port !== this._baseUrl.port || url.username !== this._baseUrl.username || url.password !== this._baseUrl.password)
      return url.href;
    const baseUrlPath = this._baseUrl.pathname;
    const urlPath = url.pathname;
    const minLen = Math.min(baseUrlPath.length, urlPath.length);
    let sharedBaseIndex = -1;
    for (let i = 0; i < minLen; i++) {
      if (baseUrlPath[i] !== urlPath[i]) break;
      if (urlPath[i] === '/') sharedBaseIndex = i;
    }
    return '../'.repeat(baseUrlPath.slice(sharedBaseIndex + 1).split('/').length - 1) + urlPath.slice(sharedBaseIndex + 1) + url.search + url.hash;
  }

  get baseUrl () {
    return this._baseUrl;
  }

  get map () {
    return deepClone(this._map);
  }

  copy (minify: boolean) {
    if (typeof document === 'undefined')
      throw new Error('Node.js clipboard support pending.');
    const text = this.toString(minify);
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    return this;
  }

  toString (minify?: boolean) {
    const obj: any = {};
    if (Object.keys(this._map.imports).length) obj.imports = this._map.imports;
    if (Object.keys(this._map.scopes).length) obj.scopes = this._map.scopes;
    if (Object.keys(this._map.integrity).length) obj.integrity = this._map.integrity;
    if (Object.keys(this._map.depcache).length) obj.depcache = this._map.depcache;
    return jsonStringifyStyled(obj, minify ? Object.assign(this.mapStyle, { indent: '', tab: '', newline: '' }) : this.mapStyle);
  }

  rebase (newBaseUrl: string = this._baseUrl.href) {
    const oldBaseUrl = this._baseUrl;
    this._baseUrl = new URL(newBaseUrl, envBaseUrl);
    if (!this._baseUrl.pathname.endsWith('/')) this._baseUrl.pathname += '/';
    for (const impt of Object.keys(this._map.imports)) {
      const target = this._map.imports[impt];
      if (target !== null)
        this._map.imports[impt] = this.baseUrlRelative(new URL(target, oldBaseUrl));
    }
    for (const scope of Object.keys(this._map.scopes)) {
      const newScope = this.baseUrlRelative(new URL(scope, oldBaseUrl));
      const scopeImports = this._map.scopes[scope];
      if (scope !== newScope) {
        delete this._map.scopes[scope];
        this._map.scopes[newScope] = scopeImports;
      }
      for (const name of Object.keys(scopeImports)) {
        const target = scopeImports[name];
        if (target !== null)
          scopeImports[name] = this.baseUrlRelative(new URL(target, oldBaseUrl));
      }
    }
    const newDepcache = Object.create(null);
    for (const dep of Object.keys(this._map.depcache)) {
      const importsRebased = this._map.depcache[dep].map(specifier => {
        if (isPlain(specifier)) return specifier;
        return this.baseUrlRelative(new URL(specifier, oldBaseUrl));
      });
      const depRebased = this.baseUrlRelative(new URL(dep, oldBaseUrl));
      newDepcache[depRebased] = importsRebased;
    }
    this._map.depcache = newDepcache;
    const newIntegrity = Object.create(null);
    for (const dep of Object.keys(this._map.integrity)) {
      const integrityVal = this._map.integrity[dep];
      const depRebased = this.baseUrlRelative(new URL(dep, oldBaseUrl));
      newIntegrity[depRebased] = integrityVal;
    }
    this._map.integrity = newIntegrity;
    return this;
  }

  flatten () {
    for (const scope of Object.keys(this._map.scopes)) {
      const scopeUrl = new URL(scope, this._baseUrl);
      let scopeBase: Record<string, string | null> | undefined, scopeBaseUrl: string | undefined;
      if (scopeUrl.protocol !== 'file:') {
        if (scopeUrl.origin === this._baseUrl.origin && scopeUrl.href.startsWith(this._baseUrl.origin))
          scopeBaseUrl = '/';
        else if (scopeUrl.href.startsWith(scopeUrl.origin))
          scopeBaseUrl = scopeUrl.origin + '/';
        if (scopeBaseUrl) scopeBase = this._map.scopes[scopeBaseUrl] || {};
      }
      if (!scopeBase) continue;
      const scopeImports = this._map.scopes[scope];
      let flattenedAll = true;
      for (const name of Object.keys(scopeImports)) {
        const existing = scopeBase[name];
        const target = scopeImports[name];
        if (target === null) continue;
        const targetUrl = new URL(target, this._baseUrl);
        if (!existing || new URL(existing, this._baseUrl).href === targetUrl.href) {
          scopeBase[name] = this.baseUrlRelative(targetUrl);
          delete scopeImports[name];
          this._map.scopes[<string>scopeBaseUrl] = alphabetize(scopeBase);
        }
        else {
          flattenedAll = false;
        }
      }
      if (flattenedAll)
        delete this._map.scopes[scope];
    }
    for (const dep of Object.keys(this._map.depcache)) {
      if (this._map.depcache[dep].length === 0)
        delete this._map.depcache[dep];
    }
    return this;
  }

  sort () {
    this._map = sort(this._map);
    return this;
  }

  clearIntegrity () {
    this._map.integrity = Object.create(null);
  }

  clearDepcache () {
    this._map.depcache = Object.create(null);
  }

  setIntegrity (url: string, integrity: string) {
    this._map.integrity[url] = integrity;
  }

  sortIntegrity () {
    this._map.integrity = alphabetize(this._map.integrity);
  }

  async trace (specifiers: string[], { static: isStatic = false, depcache: doDepcache = false, system = false } = {} as TraceOptions): Promise<{ map: Record<string, URL | null>, trace: Trace }> {
    let postOrder = 0;
    let dynamicTracing = false;
    const dynamics: Set<{ dep: string, parentUrl: URL }> = new Set();
    const doTrace = async (specifier: string, parentUrl: URL, curTrace: Trace, curMap: Record<string, URL | null>, isEntry: boolean): Promise<void> => {
      const resolved = this.resolve(specifier, parentUrl);
      curMap[specifier] = resolved;
      if (resolved === null) return;
      const href = resolved.href;
      if (curTrace[href]) return;
      if (staticTrace[href]) return;

      // careful optimal depcache "backbone" only
      if (doDepcache && dynamicTracing && !isEntry) {
        const parent = this.baseUrlRelative(parentUrl);
        const existingDepcache = this._map.depcache[parent];
        if (existingDepcache) {
          if (!existingDepcache.includes(specifier))
            existingDepcache.push(specifier);
        }
        else {
          this._map.depcache[parent] = [specifier];
        }
      }
      const curEntry: TraceEntry = curTrace[href] = {
        deps: Object.create(null),
        dynamicDeps: Object.create(null),
        dynamicOnly: dynamicTracing,
        size: NaN,
        order: NaN,
        integrity: '',
        system: false,
      };
      const { deps, dynamicDeps, size, integrity, system: isSystem } = await analyze(href, parentUrl, system);
      curEntry.integrity = integrity;
      curEntry.size = size;
      curEntry.system = isSystem;

      for (const dep of deps)
        await doTrace(dep, resolved, curTrace, curEntry.deps, false);

      for (const dep of dynamicDeps) {
        if (dynamicTracing)
          await doTrace(dep, resolved, curTrace, curEntry.dynamicDeps, true);
        else if (!isStatic)
          dynamics.add({ dep, parentUrl: resolved });
      }
      curEntry.order = postOrder++;
    };

    const map = Object.create(null);
    const staticTrace = Object.create(null);
    // trace twice -> once for the static graph, then again to determine the dynamic graph
    for (const specifier of specifiers) {
      await doTrace(specifier, this._baseUrl, staticTrace, map, false);
    }

    dynamicTracing = true;
    for (const { dep, parentUrl } of dynamics) {
      const dynTrace = Object.create(null);
      await doTrace(dep, parentUrl, dynTrace, map, true);
      for (const m of Object.keys(dynTrace)) {
        if (!staticTrace[m])
          staticTrace[m] = dynTrace[m];
      }
    }

    return { map, trace: staticTrace };
  }

  // modules are resolvable module specifiers
  // exception is package-like, which we should probably not allow for this top-level version
  async traceInstall (modules?: string | string[] | InstallOptions, opts: InstallOptions = {}): Promise<boolean> {
    if (typeof modules === 'string') modules = [modules];
    if (!Array.isArray(modules) || modules.length === 0) {
      opts = { lock: true, ...opts || modules || {} };
      modules = Object.keys(this._map.imports);
    }
    if (opts.clean !== false)
      opts.clean = true;
    await this._p.job();
    let installed = false;
    try {
      const installer = new Installer(this, opts);
      await Promise.all(modules.map(async module => {
        if (isPlain(module)) {
          try {
            const mapResolved = this.resolve(module, this._baseUrl);
            installer.tracedMappings.add(module);
            if (mapResolved)
              return installer.traceInstall(mapResolved.href, this._baseUrl, false);
          }
          finally {}
        }
        await installer.traceInstall(module, this._baseUrl, false);
      }));
      await installer.initPromise;
      installer.complete();
      installed = installer.changed;
    }
    finally {
      this._p.next();
    }
    return installed;
  }

  async add (packages: string | (string | { name: string, target: string })[], opts: InstallOptions = {}) {
    if (typeof packages === 'string') packages = [packages];
    await this._p.job();
    let changed = false;
    try {
      const installer = new Installer(this, opts);
      await Promise.all(packages.map(pkg => {
        if (typeof pkg === 'string')
          return installer.add(pkg);
        else
          return installer.add(pkg.target, pkg.name);
      }));
      installer.complete();
      changed = installer.changed;
    }
    finally {
      this._p.next();
    }
    return changed;
  }

  // these are all "package selector based":

  /*async update (packages?: string | string[] | InstallOptions, opts?: InstallOptions) {
    if (typeof packages === 'string') packages = [packages];
    if (!Array.isArray(packages)) {
      if (packages) opts = packages;
      packages = Object.keys(this._map.imports);
    }
    if (packages.length === 0) throw new Error('No packages to update.');
    await this._p.job();
    try {
      const installer = new Installer(this, opts);
      for (const pkg of pkgs) {
        const matches = installer.select(pkg);
        if (!matches.length)
          throw new Error(`Package ${pkg} is not an installed package.`);
        // TODO
      }
    }
    finally {
      this._p.next();
    }
  }*/

  async upgrade (packages?: string | string[] | InstallOptions, opts: InstallOptions = {}) {
    if (typeof packages === 'string') packages = [packages];
    if (!Array.isArray(packages)) {
      if (packages) opts = packages;
      packages = Object.keys(this._map.imports);
    }
    if (packages.length === 0) throw new Error('No packages to upgrade.');
    for (const pkg of packages) {
      if (!this._map.imports[pkg])
        throw new Error(`Cannot upgrade package ${pkg} as it is not a top-level "imports" entry.`);
      delete this._map.imports[pkg];
    }
    this.add(packages, opts);
  }

  uninstall (packages: string | string[], force = false) {
    if (typeof packages === 'string') packages = [packages];
    if (packages.length === 0) throw new Error('No packages provided to uninstall.');
    for (const pkg of packages) {
      if (!this._map.imports[pkg])
        throw new Error(`Cannot uninstall package ${pkg} as it is not a top-level "imports" entry.`);
      delete this._map.imports[pkg];
    }
    this.traceInstall({ clean: true, force });
  }

  async installToConditions (conditions: string[]) {
    this.conditions = conditions;
    await this.traceInstall({ clean: true });
  }

  resolve (specifier: string, parentUrl: URL): URL | null {
    return resolve(specifier, parentUrl, this._map, this._baseUrl);
  }
}

export function resolve (specifier: string, parentUrl: URL, map: ImportMap, baseUrl: URL): URL | null {
  if (!isPlain(specifier)) return new URL(specifier, parentUrl);
  const scopeMatches = getScopeMatches(parentUrl, map.scopes, baseUrl);
  for (const [scope] of scopeMatches) {
    const mapMatch = getMapMatch(specifier, map.scopes[scope]);
    if (mapMatch) {
      const target = map.scopes[scope][mapMatch];
      if (target === null) return null;
      return new URL(target + specifier.slice(mapMatch.length), baseUrl);
    }
  }
  const mapMatch = getMapMatch(specifier, map.imports);
  if (mapMatch) {
    const target = map.imports[mapMatch];
    if (target === null) return null;
    return new URL(target + specifier.slice(mapMatch.length), baseUrl);
  }
  throw new JspmError(new Error(`Unable to resolve "${specifier}" from ${parentUrl.href}`), 'MODULE_NOT_FOUND');
}
