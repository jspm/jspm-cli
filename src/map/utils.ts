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
import { PackageMap } from ".";
import path = require('path');
import { alphabetize } from "../utils/common";
export { createPackageMap, resolveIfNotPlainOrUrl } from './common';

export function extend (packageMap: PackageMap, extendMap: PackageMap) {
  if (extendMap.packages) {
    packageMap.packages = packageMap.packages || {};
    Object.assign(packageMap.packages, extendMap.packages);
  }
  if (extendMap.scopes) {
    packageMap.scopes = packageMap.scopes || {};
    for (const scope of Object.keys(extendMap.scopes)) {
      packageMap.scopes[scope] = packageMap.scopes[scope] || { packages: {} };
      const packages = extendMap.scopes[scope].packages;
      if (!packages)
        continue;
      for (const pkg of Object.keys(packages))
        packageMap.scopes[scope].packages[pkg] = packages[pkg];
    }
  }
  clean(packageMap);
}

export function getMatch (path, matchObj) {
  let sepIndex = path.length;
  do {
    const segment = path.slice(0, sepIndex);
    if (segment in matchObj)
      return segment;
  } while ((sepIndex = path.lastIndexOf('/', sepIndex - 1)) !== -1)
}

// any plain maps in scopes which match base maps can be removed
// then removes empty properties and alphabetizes
export function clean (packageMap: PackageMap) {
  for (const scope of Object.keys(packageMap.scopes)) {
    const packages = packageMap.scopes[scope].packages;
    for (const pkgName of Object.keys(packages)) {
      if (pkgName.startsWith('./') || pkgName.startsWith('../'))
        continue;
      let baseMap = packageMap.packages[pkgName];
      if (!baseMap)
        continue;
      let map = packages[pkgName];
      if (typeof baseMap === 'string') {
        if (typeof map !== 'string')
          continue;
        // TODO: handle URL-like
        if (path.join(pkgName, baseMap) === path.join(scope, pkgName, map))
          delete packages[pkgName];
      }
      else {
        if (typeof map === 'string')
          continue;
        if (baseMap.main !== map.main)
          continue;
        if (baseMap.path === path.join(scope, map.path).replace(/\\/g, '/'))
          delete packages[pkgName];
      }
    }
  }
  
  packageMap.packages = alphabetize(packageMap.packages);

  packageMap.scopes = alphabetize(packageMap.scopes);
  outer: for (const scope of Object.keys(packageMap.scopes)) {
    for (let _p in packageMap.scopes[scope].packages) {
      packageMap.scopes[scope].packages = alphabetize(packageMap.scopes[scope].packages);
      continue outer;
    }
    delete packageMap.scopes[scope];
  }
}