/*
 *   Copyright 2014-2019 Guy Bedford (http://guybedford.com)
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
const { builtins, applyMap } = require('@jspm/resolve');
import { URL } from 'url';
import { resolveIfNotPlainOrUrl } from "./common";
import fs = require('graceful-fs');
import { analyzeModuleSyntax } from "./esm-lexer";

const jspmBuiltins = Object.assign({ '@empty.dew': true }, builtins);

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
  packages?: Packages;
  scopes?: Scopes;
}

class Mapper {
  project: Project;
  env: any;
  cachedPackagePaths: Record<string, Promise<PackageConfig>>;
  dependencies: Record<string, string>;
  _nodeBuiltinsPkg: string;

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

    this._nodeBuiltinsPkg = 'jspm_packages/' + this.dependencies['@jspm/node-builtins'].replace(':', '/');

    this.env = env;
    this.cachedPackagePaths = {};
  }

  get nodeBuiltinsPkg () {
    if (this._nodeBuiltinsPkg)
      return this._nodeBuiltinsPkg;
    throw new Error('Unable to locate @jspm/node-builtins dependency. Make sure this is properly installed.');
  }

  async createMapAll () {
    const packages: Packages = {};
    const scopes: Scopes = {};
    const packageMap: PackageMap = {
      packages,
      scopes
    };

    const populationPromises: Promise<void>[] = [];
    for (const depName of Object.keys(this.dependencies)) {
      if (depName === '@jspm/node-builtins')
        continue;
      populationPromises.push(this.populatePackage(depName, this.dependencies[depName], undefined, packageMap));
    }

    // when peerDependencies are fixed as primaries
    // then the version below here must be from project.config.jspm.installed.resolve['@jspm/node-builtins']
    for (const name of Object.keys(jspmBuiltins)) {
      if (name in packages)
        continue;
      packages[name] = path.relative(name, `${this.nodeBuiltinsPkg}/${nodeCoreBrowserUnimplemented[name] ? '@empty' : name}.js`).replace(/\\/g, '/');
    }

    await Promise.all(populationPromises);

    clean(packageMap);
    
    return packageMap;
  }

  async populatePackage (depName: string, pkgName: string, scopeParent: string, packageMap: PackageMap, seen: Record<string, boolean> = {}) {
    // no need to duplicate base-level dependencies
    if (scopeParent && this.dependencies[depName] === pkgName)
      return;

    const pkgPath = `jspm_packages/${pkgName.replace(':', '/')}`;
    const packages = scopeParent ? (packageMap.scopes[scopeParent] = (packageMap.scopes[scopeParent] || { packages: {} })).packages : packageMap.packages;
    const curPkg = packages[depName] = {
      path: scopeParent ? path.relative(scopeParent, pkgPath).replace(/\\/g, '/') : pkgPath,
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
      for (const subpath of Object.keys(paths)) {
        scopedPackages[name + '/' + subpath] = path.relative(name + '/' + subpath, paths[subpath]).replace(/\\/g, '/');
      }

      for (const target of Object.keys(map)) {
        let mapped = map[target];

        let mainEntry = true;
        let onlyMain = false;

        if (mapped.startsWith('./')) {
          mapped = pkgPath + mapped.substr(1);
        }
        else {
          const depMapped = applyMap(mapped, pkg.resolve) || applyMap(mapped, this.dependencies);
          if (depMapped) {
            mapped = 'jspm_packages/' + depMapped.replace(':', '/');
          }
          else if (jspmBuiltins[mapped]) {
            mapped = `${this.nodeBuiltinsPkg}/${mapped}.js`;
            onlyMain = true;
          }
        }

        if (mapped.endsWith('/')) {
          mapped = mapped.substr(0, mapped.length - 1);
          mainEntry = false;
        }
        
        const relPath = path.relative(onlyMain ? pkgPath + '/' + target : pkgPath, mapped).replace(/\\/g, '/');

        if (onlyMain)
          scopedPackages[target] = relPath;
        else if (mainEntry)
          scopedPackages[target] = { main: '../' + relPath.substr(relPath.lastIndexOf('/') + 1), path: relPath };
        else
          scopedPackages[target] = { path: relPath };
      }
    })();

    if (seen[pkgName])
      return;
    seen[pkgName] = true;
  
    const populationPromises: Promise<void>[] = [pathsPromise];
    for (const depName of Object.keys(pkg.resolve)) {
      if (depName === '@jspm/node-builtins')
        continue;
      populationPromises.push(this.populatePackage(depName, serializePackageName(pkg.resolve[depName]), pkgPath, packageMap, seen));
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
            main = mapped === '@empty' ? `${this.nodeBuiltinsPkg}/@empty.js` : mapped;
        }

        for (const target of Object.keys(pjson.map)) {
          if (target.startsWith('./')) {
            const mapped = applyMap(target, pjson.map, this.env);
            if (mapped)
              paths[target.substr(2)] = mapped === '@empty' ? `${this.nodeBuiltinsPkg}/@empty.js` : mapped;
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

// jspmPackagesUrl must be an absolute URL
function cdnReplace (path) {
  return path.replace(/jspm_packages\/(\w+)\//, 'jspm_packages/$1:');
}

export function renormalizeMap (map: PackageMap, jspmPackagesURL: string, cdn: boolean) {
  if (jspmPackagesURL.endsWith('/'))
    jspmPackagesURL = jspmPackagesURL.substr(0, jspmPackagesURL.length - 1);
  const newMap: PackageMap = {};
  if (map.packages) {
    const packages = Object.create(null);
    newMap.packages = packages;
    for (const pkgName of Object.keys(map.packages)) {
      const pkg = map.packages[pkgName];
      if (typeof pkg === 'string')
        newMap.packages[pkgName] = (cdn ? cdnReplace(pkg) : pkg).replace(/^(\.\.\/)+jspm_packages/, jspmPackagesURL);
      else
        newMap.packages[pkgName] = {
          path: jspmPackagesURL + (cdn ? cdnReplace(pkg.path) : pkg).substr(13),
          main: pkg.main
        };
    }
  }
  if (map.scopes) {
    const scopes = Object.create(null);
    newMap.scopes = scopes;
    for (const scopeName of Object.keys(map.scopes)) {
      const scope = map.scopes[scopeName];
      const newScope = { packages: Object.create(null) };
      let scopeRegistry = scopeName.substr(14);
      scopeRegistry = scopeRegistry.substr(0, scopeRegistry.indexOf('/'));

      const isScopedPackage = scopeName.indexOf('/', scopeName.indexOf('/', 14) + 1) !== -1;

      for (const pkgName of Object.keys(scope.packages)) {
        let pkg = scope.packages[pkgName];
        if (typeof pkg === 'string') {
          if (cdn && pkg.startsWith('../')) {
            // exception is within-scope backtracking
            if (!(isScopedPackage && pkg.startsWith('../') && !pkg.startsWith('../../')))
              pkg = pkg.replace(/^((\.\.\/)+)(.+)$/, `$1${scopeRegistry}:$3`);
          }
          newScope.packages[pkgName] = (cdn ? cdnReplace(pkg) : pkg).replace(/^(\.\.\/)+jspm_packages/, jspmPackagesURL);
        }
        else {
          pkg = Object.assign({}, pkg);
          if (cdn && pkg.path.startsWith('../')) {
            if (!(isScopedPackage && pkg.path.startsWith('../') && !pkg.path.startsWith('../../')))
              pkg.path = pkg.path.replace(/^((\.\.\/)+)(.+)$/, `$1${scopeRegistry}:$3`);
          }
          newScope.packages[pkgName] = pkg;
        }
      }
      newMap.scopes[jspmPackagesURL + (cdn ? cdnReplace(scopeName) : scopeName).substr(13)] = newScope;
    }
  }
  return newMap;
}

export async function map (project: Project, env: any) {
  const mapper = new Mapper(project, env);
  return await mapper.createMapAll();
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

  constructor (project: Project, map: PackageMap) {
    let baseDir = project.projectPath;
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
      return resolved;
    seen[resolved] = true;

    let deps;
    try {
      deps = await this.resolveDeps(resolved);
    }
    catch (err) {
      throw new JspmUserError(`Loading ${highlight(id)} from ${bold(decodeURI(parentUrl.substr(7 + +isWindows).replace(/\//g, path.sep)))}`, err.code, err);
    }
    
    const resolvedDeps = await Promise.all(deps.map(dep => this.resolveAll(dep, resolved, seen)));

    if (deps.length) {
      const trace = this.trace[resolved] = Object.create(null);
      for (let i = 0; i < deps.length; i++)
        trace[deps[i]] = resolvedDeps[i];
    }

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
    const dynamicImportRegEx = /('[^'\\]+'|"[^"\\]+")\)/g;
    for (const { s, e, d } of imports) {
      if (d === -2)
        continue;
      // dynamic import
      if (d !== -1) {
        const match = source.substr(d).match(dynamicImportRegEx);
        // we don't yet support partial dynamic import traces
        if (match) {
          deps.push(match[0].slice(1, match[0].length - 2));
        }
      }
      else {
        deps.push(source.slice(s, e));
      }
    }
    return deps;
  }
}

export async function filterMap (project: Project, map: PackageMap, modules: string[]): Promise<PackageMap> {
  const mapResolve = new MapResolver(project, map);
  let baseURL = new URL('file:' + project.projectPath).href;
  if (baseURL[baseURL.length - 1] !== '/')
    baseURL += '/';

  for (const module of modules)
    await mapResolve.resolveAll(module, baseURL);

  clean(mapResolve.usedMap);
  return mapResolve.usedMap;
}

export async function trace (project: Project, map: PackageMap, baseDir: string, modules: string[]): Promise<Record<string, Record<string, string>>> {
  const mapResolve = new MapResolver(project, map);
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