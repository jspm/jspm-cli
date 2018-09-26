/*
 *   Copyright 2014-2018 Guy Bedford (http://guybedford.com)
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
import { Project } from "../project";
import path = require('path');
import { DepType, serializePackageName } from "../install/package";
import { readJSON, highlight, JspmUserError, isWindows, bold } from "../utils/common";
import { clean, createPackageMap, getMatch } from "./utils";
const { builtins, applyMap } = require('jspm-resolve');
import { URL } from 'url';
import { resolveIfNotPlainOrUrl } from "./common";
import fs = require('graceful-fs');
import { analyzeModuleSyntax } from "./esm-lexer";

const jspmBuiltins = Object.assign({ '@empty.dew': true }, builtins);

const nodeBuiltinsPkg = 'jspm_packages/npm/@jspm/node-builtins@0.1.2';

const nodeCoreBrowserUnimplemented = {
  child_process: true, cluster: true, dgram: true, dns: true, fs: true, module: true, net: true, readline: true, repl: true, tls: true
};

export interface Packages {
  [name: string]: string | { path?: string, main?: string };
};
export interface Scopes {
  [path: string]: {
    packages: Packages;
  };
};
export interface PackageMap {
  packages: Packages;
  scopes: Scopes;
}

class Mapper {
  project: Project;
  env: any;
  cachedPackagePaths: Record<string, Promise<PackageConfig>>;
  dependencies: Record<string, string>;

  constructor (project: Project, env: any = { browser: true }) {
    if (!env.node && env.browser !== false)
      env.browser = true;
    this.project = project;

    this.dependencies = {};
    for (const dep of Object.keys(project.config.jspm.installed.resolve)) {
      const entry = project.config.pjson.dependencies[dep];
      if (entry && entry.type === DepType.dev && (env.production || env.dev === false))
        continue;
      this.dependencies[dep] = serializePackageName(project.config.jspm.installed.resolve[dep]);
    }

    this.env = env;
    this.cachedPackagePaths = {};
  }

  async createMapAll (mapBase = this.project.projectPath) {
    const relBase = path.relative(mapBase, this.project.projectPath).replace(/\\/g, '/');
  
    const packages: Packages = {};
    const scopes: Scopes = {};
    const packageMap: PackageMap = {
      packages,
      scopes
    };

    const populationPromises: Promise<void>[] = [];
    for (const depName of Object.keys(this.dependencies)) {
      if (depName === 'jspm-node-builtins')
        continue;
      populationPromises.push(this.populatePackage(depName, this.dependencies[depName], undefined, packageMap, relBase));
    }

    // when peerDependencies are fixed as primaries
    // then the version below here must be from project.config.jspm.installed.resolve['jspm-node-builtins']
    for (const name of Object.keys(jspmBuiltins)) {
      if (name in packages)
        continue;
      packages[name] = path.relative(name, `${nodeBuiltinsPkg}/${nodeCoreBrowserUnimplemented[name] ? '@empty' : name}.js`).replace(/\\/g, '/');
    }

    await Promise.all(populationPromises);

    clean(packageMap);
    
    return packageMap;
  }

  async populatePackage (depName: string, pkgName: string, scopeParent: string, packageMap: PackageMap, relBase: string, seen: Record<string, boolean> = {}) {
    // no need to duplicate base-level dependencies
    if (scopeParent && this.dependencies[depName] === pkgName)
      return;

    const pkgPath = `jspm_packages/${pkgName.replace(':', '/')}`;
    const packages = scopeParent ? (packageMap.scopes[scopeParent] = (packageMap.scopes[scopeParent] || { packages: {} })).packages : packageMap.packages;
    const curPkg = packages[depName] = {
      path: scopeParent  ? path.relative(scopeParent, pkgPath).replace(/\\/g, '/') : (relBase.length ? relBase + '/' : '') + pkgPath,
      main: undefined
    };
    const pkg = this.project.config.jspm.installed.dependencies[pkgName];
  
    const pathsPromise = (async () => {
      const { name, main, paths, map } = await this.getPackageConfig(pkgName);

      if (main)
        curPkg.main = main;
      for (const subpath of Object.keys(paths)) {
        const relPath = path.relative((scopeParent ? scopeParent + '/' : '') + depName + '/' + subpath, pkgPath).replace(/\\/g, '/');
        packages[depName + '/' + subpath] = relPath + '/' + paths[subpath];
      }

      if (seen[pkgName + '|map'])
        return;
      seen[pkgName + '|map'] = true;

      const scopedPackages = (packageMap.scopes[pkgPath] = (packageMap.scopes[pkgPath] || { packages: {} })).packages;

      scopedPackages[name] = { path: '.', main };
      for (const subpath of Object.keys(paths))
        scopedPackages[name + '/' + subpath] = path.relative(name + '/' + subpath, paths[subpath]).replace(/\\/g, '/');

      for (const target of Object.keys(map)) {
        let mapped = map[target];

        let mainEntry = true;
        let onlyMain = false;

        const depMapped = applyMap(mapped, pkg.resolve) || applyMap(mapped, this.dependencies);
        if (depMapped) {
          mapped = 'jspm_packages/' + depMapped.replace(':', '/');
          if (mapped.endsWith('/')) {
            mapped = mapped.substr(0, mapped.length - 1);
            mainEntry = false;
          }
        }
        else if (jspmBuiltins[mapped]) {
          mapped = `${nodeBuiltinsPkg}/${mapped}.js`;
          onlyMain = true;
        }
        
        const relPath = path.relative(pkgPath + '/' + depName + '/', mapped).replace(/\\/g, '/');

        if (onlyMain)
          scopedPackages[target] = relPath;
        else if (mainEntry)
          scopedPackages[target] = { main: '.', path: relPath };
        else
          scopedPackages[target] = { path: relPath };
      }
    })();

    if (seen[pkgName])
      return;
    seen[pkgName] = true;
  
    const populationPromises: Promise<void>[] = [pathsPromise];
    for (const depName of Object.keys(pkg.resolve)) {
      if (depName === 'jspm-node-builtins')
        continue;
      populationPromises.push(this.populatePackage(depName, serializePackageName(pkg.resolve[depName]), pkgPath, packageMap, relBase, seen));
    }
    await Promise.all(populationPromises);
  }

  async getPackageConfig (pkgName: string): Promise<PackageConfig> {
    const cached = this.cachedPackagePaths[pkgName];
    if (cached)
      return await cached;
    
    return await (this.cachedPackagePaths[pkgName] = (async () => {
      const pjson = await readJSON(`${this.project.projectPath}/jspm_packages/${pkgName.replace(':', '/')}/package.json`);

      if (!pjson)
        throw new JspmUserError(`Package ${highlight(pkgName)} is not installed correctly. Run jspm install.`);

      const name = typeof pjson.name === 'string' ? pjson.name : undefined;

      let main = typeof pjson.main === 'string' ? pjson.main : undefined;
      const paths = {};
      const map = {};
      // const deps = {};
      if (pjson.map) {
        if (main) {
          const mapped = applyMap('./' + main, pjson.map, this.env);
          if (mapped)
            main = mapped === '@empty' ? `${nodeBuiltinsPkg}/@empty.js` : mapped;
        }

        for (const target of Object.keys(pjson.map)) {
          if (target.startsWith('./')) {
            const mapped = applyMap(target, pjson.map, this.env);
            if (mapped)
              paths[target.substr(2)] = mapped === '@empty' ? `${nodeBuiltinsPkg}/@empty.js` : mapped;
          }
          else {
            const mapped = applyMap(target, pjson.map, this.env);
            if (mapped)
              map[target] = mapped;
          }
        }
      }

      return { name, main, paths, map };
    })());
  }
}

export async function map (project: Project, baseDir: string, env: any) {
  const mapper = new Mapper(project, env);
  return await mapper.createMapAll(baseDir);
}

class MapResolver {
  project: Project;
  packages: Packages;
  scopes: Record<string, {
    originalName: string;
    packages: Packages;
  }>;
  usedMap: PackageMap;
  trace: Record<string, Record<string, string>>
  mapResolve: (id: string, parentUrl: string) => string;

  constructor (project: Project, map: PackageMap, baseDir = project.projectPath) {
    this.project = project;
    this.packages = map.packages;

    this.scopes = Object.create(null);
    if (baseDir[baseDir.length - 1] !== '/')
      baseDir += '/';
    const baseURL = new URL('file:' + baseDir).href;

    for (const scopeName of Object.keys(map.scopes)) {
      let resolvedScopeName = resolveIfNotPlainOrUrl(scopeName, baseURL) || scopeName.indexOf(':') !== -1 && scopeName || resolveIfNotPlainOrUrl('./' + scopeName, baseURL);
      if (resolvedScopeName[resolvedScopeName.length - 1] === '/')
        resolvedScopeName = resolvedScopeName.substr(0, resolvedScopeName.length - 1);
      this.scopes[resolvedScopeName] = {
        originalName: scopeName,
        packages: map.scopes[scopeName].packages || {}
      };
    }
    this.trace = Object.create(null);
    this.usedMap = { packages: {}, scopes: {} };
    this.mapResolve = createPackageMap(map, baseURL);
  }

  async resolveAll (id: string, parentUrl: string, seen?: Record<string, boolean>) {
    let toplevel = false;
    if (seen === undefined) {
      toplevel = true;
      seen = Object.create(null);
    }

    const resolved = this.resolve(id, parentUrl, toplevel);

    if (seen[resolved])
      return;
    seen[resolved] = true;

    let deps;
    try {
      deps = await this.resolveDeps(resolved);
    }
    catch (err) {
      throw new JspmUserError(`Loading ${highlight(id)} from ${bold(decodeURI(parentUrl.substr(7 + +isWindows).replace(/\//g, path.sep)))}`, err.code, err);
    }
    const resolvedDeps = await Promise.all(deps.map(dep => this.resolveAll(dep, resolved, seen)));

    const trace = this.trace[resolved] = Object.create(null);
    for (let i = 0; i < deps.length; i++)
      trace[deps[i]] = resolvedDeps[i];

    return resolved;
  }

  resolve (id: string, parentUrl: string, toplevel = false) {
    let resolved = resolveIfNotPlainOrUrl(id, parentUrl);
    if (resolved)
      return resolved;

    resolved = this.mapResolve(id, parentUrl);
    if (resolved) {
      const scopeMatch = getMatch(parentUrl, this.scopes);
      if (scopeMatch) {
        const match = getMatch(id, this.scopes[scopeMatch].packages);
        if (match) {
          const scopeName = this.scopes[scopeMatch].originalName;
          (this.usedMap.scopes[scopeName] = this.usedMap.scopes[scopeName] || { packages: {} }).packages[match] = this.scopes[scopeMatch].packages[match];
          return resolved;
        }
      }
      const match = getMatch(id, this.packages);
      if (match) {
        this.usedMap.packages[match] = this.packages[match];
        return resolved;
      }
      throw new Error('Internal error');
    }

    if (toplevel)
      return resolveIfNotPlainOrUrl('./' + id, parentUrl);

    throw new Error(`No resolution for ${id} in ${parentUrl}`);
  }

  async resolveDeps (url: string) {
    if (!url.startsWith('file:'))
      return [];
    const filePath = decodeURI(url.substr(7 + +isWindows)).replace(/\//g, path.sep);
    let imports, err, source;
    source = await new Promise<string>((resolve, reject) => fs.readFile(filePath, (err, source) => err ? reject(err) : resolve(source.toString())));
    [imports,, err] = analyzeModuleSyntax(source);
    if (err)
      throw new JspmUserError(`Syntax error analyzing ${bold(filePath)}`, 'ANALYSIS_ERROR');
    const deps = [];
    for (const { s, e, d } of imports) {
      if (d === -2)
        continue;
      // TODO: Dynamic import partial resolution
      if (d !== -1)
        continue;
      deps.push(source.slice(s, e));
    }
    return deps;
  }
}

export async function filterMap (project: Project, map: PackageMap, baseDir: string, modules: string[]): Promise<PackageMap> {
  const mapResolve = new MapResolver(project, map, baseDir);
  let baseURL = new URL('file:' + baseDir).href;
  if (baseURL[baseURL.length - 1] !== '/')
    baseURL += '/';

  for (const module of modules)
    await mapResolve.resolveAll(module, baseURL);

  clean(mapResolve.usedMap);
  return mapResolve.usedMap;
}

export async function trace (project: Project, map: PackageMap, baseDir: string, modules: string[]): Promise<Record<string, Record<string, string>>> {
  const mapResolve = new MapResolver(project, map, baseDir);
  let baseURL = new URL('file:' + baseDir).href;
  if (baseURL[baseURL.length - 1] !== '/')
    baseURL += '/';

  for (const module of modules)
    await mapResolve.resolveAll(module, baseURL);

  return mapResolve.trace;
}

interface PackageConfig {
  name: string,
  main: string,
  paths: {
    [path: string]: string
  },
  map: {
    [target: string]: string
  }
};