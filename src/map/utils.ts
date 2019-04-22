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
import { ImportMap } from ".";
import path = require('path');
import { alphabetize, JspmUserError, bold, hasProperties, isURL, isWindows } from "../utils/common";
export { parseImportMap, resolveImportMap, resolveIfNotPlainOrUrl } from './common';

export function getPackageBase (url: string, jspmProjectPath: string) {
  const resolvedPath = url.substr(isWindows ? 8 : 7).replace(/\//g, path.sep);
  if (!resolvedPath.startsWith(jspmProjectPath + path.sep))
    return;
  if (!resolvedPath.slice(jspmProjectPath.length).startsWith('/jspm_packages/'))
    return jspmProjectPath;
  const pkg = resolvedPath.slice(resolvedPath.indexOf(path.sep, jspmProjectPath.length + 16) + 1);
  if (pkg[0] === '@')
    return pkg.substr(0, pkg.indexOf('/', pkg.indexOf('/') + 1));
  else
    return pkg.substr(0, pkg.indexOf('/'));
}

export function extend (importMap: ImportMap, extendMap: ImportMap) {
  if (extendMap.imports) {
    importMap.imports = importMap.imports || {};
    Object.assign(importMap.imports, extendMap.imports);
  }
  if (extendMap.scopes) {
    importMap.scopes = importMap.scopes || {};
    for (const scope of Object.keys(extendMap.scopes)) {
      importMap.scopes[scope] = importMap.scopes[scope] || {};
      const imports = extendMap.scopes[scope];
      if (!imports)
        continue;
      for (const pkg of Object.keys(imports))
        importMap.scopes[scope][pkg] = imports[pkg];
    }
  }
  clean(importMap);
  return importMap;
}

export function getScopeMatch (path, matchObj) {
  let sepIndex = path.length;
  do {
    const segment = path.slice(0, sepIndex + 1);
    if (segment in matchObj) {
      return segment;
    }
  } while ((sepIndex = path.lastIndexOf('/', sepIndex - 1)) !== -1)
}

export function getImportMatch (path, matchObj) {
  if (path in matchObj)
    return path;
  let sepIndex = path.length;
  do {
    const segment = path.slice(0, sepIndex + 1);
    if (segment in matchObj)
      return segment;
  } while ((sepIndex = path.lastIndexOf('/', sepIndex - 1)) !== -1)
}

export function rebaseMap (map: ImportMap, fromPath: string, toPath: string, absolute = false) {
  const prefix = absolute ? '/' : './';

  fromPath = fromPath.replace(/\\/g, '/');
  toPath = toPath.replace(/\\/g, '/');
  const newMap: ImportMap = {};
  if (map.imports) {
    const imports = Object.create(null);
    newMap.imports = imports;
    for (const pkgName of Object.keys(map.imports)) {
      const pkg = map.imports[pkgName];
      let rebased = isURL(pkg, true) ? pkg : path.relative(toPath, path.resolve(fromPath, pkg)).replace(/\\/g, '/');
      if (!rebased.startsWith('../'))
        rebased = prefix + rebased;
      else if (absolute)
        throw new JspmUserError(`Unable to reference mapping ${pkgName} at ${rebased}. The base for the import map must a higher path than its mappings.`);
      imports[pkgName] = rebased;
    }
  }
  if (map.scopes) {
    const scopes = Object.create(null);
    newMap.scopes = scopes;
    for (const scopeName of Object.keys(map.scopes)) {
      const scope = map.scopes[scopeName];
      const newScope = Object.create(null);
      if (isURL(scopeName, true)) {
        newMap.scopes[scopeName] = Object.assign(newScope, scope);
      }
      else {
        const resolvedScope = path.resolve(fromPath, scopeName);
        let rebasedScope = path.relative(toPath, resolvedScope).replace(/\\/g, '/') + '/';
        for (const pkgName of Object.keys(scope)) {
          const pkg = scope[pkgName];
          let rebased = isURL(pkg, true) ? pkg : path.relative(resolvedScope, path.resolve(resolvedScope, pkg)).replace(/\\/g, '/');
          if (!rebased.startsWith('../'))
            rebased = './' + rebased;
          newScope[pkgName] = rebased;
        }
        if (absolute) {
          if (rebasedScope.startsWith('../'))
            throw new JspmUserError(`Unable to reference scope ${scopeName} at ${newScope}. The base for the import map must a higher path than its mappings.`);
          rebasedScope = prefix + rebasedScope;
        }
        newMap.scopes[rebasedScope] = newScope;
      }
    }
  }
  return newMap;
}

export function flattenScopes (importMap: ImportMap) {
  for (const scope of Object.keys(importMap.scopes)) {
    const imports = importMap.scopes[scope];
    for (const pkgName of Object.keys(imports)) {
      const existing = importMap.imports[pkgName];
      const newTarget = imports[pkgName];
      const trailingSlash = newTarget.endsWith('/');
      let newTargetResolved = path.relative('.', path.resolve(scope, newTarget)).replace(/\\/g, '/');
      if (!newTargetResolved.startsWith('../'))
        newTargetResolved = './' + newTargetResolved;
      if (trailingSlash)
        newTargetResolved += '/';
      if (existing && existing !== newTargetResolved)
        throw new JspmUserError(`Cannot flatten scopes due to conflict for ${bold(pkgName)} between ${existing} and ${newTargetResolved}.`);
      importMap.imports[pkgName] = newTargetResolved;
    }
  }
  delete importMap.scopes;
}

// any plain maps in scopes which match base maps can be removed
// then removes empty properties and alphabetizes
export function clean (importMap: ImportMap) {
  if (importMap.scopes) {
    for (const scope of Object.keys(importMap.scopes)) {
      const imports = importMap.scopes[scope];
      for (const pkgName of Object.keys(imports)) {
        if (pkgName.startsWith('./') || pkgName.startsWith('../'))
          continue;
        let baseMap = importMap.imports[pkgName];
        if (!baseMap)
          continue;
        let map = imports[pkgName];
        // TODO: handle URL-like
        if (path.join(pkgName, baseMap) === path.join(scope, pkgName, map))
          delete imports[pkgName];
      }
    }
    importMap.scopes = alphabetize(importMap.scopes);

    outer: for (const scope of Object.keys(importMap.scopes)) {
      for (let _p in importMap.scopes[scope]) {
        importMap.scopes[scope] = alphabetize(importMap.scopes[scope]);
        continue outer;
      }
      delete importMap.scopes[scope];
    }  
  }
  
  if (importMap.imports) {
    importMap.imports = alphabetize(importMap.imports);
  }
  
  if (!hasProperties(importMap.imports))
    delete importMap.imports;
  if (!hasProperties(importMap.scopes))
    delete importMap.scopes;
}

export function validateImportMap (fileName, json) {
  for (const key of Object.keys(json)) {
    if (key !== 'scopes' && key !== 'imports')
      throw new JspmUserError(`${fileName} is not a valid import map as it contains the invalid key ${bold('"' + key + '"')}.`);
  }
}