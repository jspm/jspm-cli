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

// collection of package handling helpers

import { encodeInvalidFileChars, hasProperties, bold, JspmUserError, highlight, readJSON } from '../utils/common';
import { Semver, SemverRange } from 'sver';
import convertRange = require('sver/convert-range');
import crypto = require('crypto');
import { sourceProtocols } from './source';
import path = require('path');

/*
 * Package name handling
 */
export interface PackageName {
  registry: string;
  name: string;
  version: string;
};

const packageRegEx = /^([a-z]+):([@\-_\.a-zA-Z\d][-_\.a-zA-Z\d]*(?:\/[-_\.a-zA-Z\d]+)*)(?:@([^@]+))?$/;

// this function should also handle the encoding part
export function parsePackageName (name: string): PackageName {
  let packageMatch = name.match(packageRegEx);
  if (!packageMatch)
    throw new Error(`\`${name}\` is not a valid package name.`);

  return {
    registry: packageMatch[1],
    name: packageMatch[2],
    version: packageMatch[3]
  };
}

export function parseExactPackageName (name: string): ExactPackage {
  let packageMatch = name.match(packageRegEx);
  if (!packageMatch)
    throw new Error(`\`${name}\` is not a valid package name.`);

  const version = packageMatch[3] ? encodeInvalidFileChars(packageMatch[3]) : '*';

  return {
    registry: packageMatch[1],
    name: packageMatch[2],
    version,
    semver: new Semver(version)
  };
}

export function serializePackageName (pkg: PackageName | string) {
  if (typeof pkg === 'string')
    return pkg;
  return `${pkg.registry}:${pkg.name}${(pkg.version ? '@' : '') + pkg.version}`;
}

export function packageNameEq (pkgA: PackageName | string, pkgB: PackageName | string) {
  if (typeof pkgA === 'string' || typeof pkgB === 'string')
    return pkgA === pkgB;
  return pkgA.registry === pkgB.registry && pkgA.name === pkgB.name && pkgA.version === pkgB.version;
}

export interface ExactPackage extends PackageName {
  semver: Semver
}

export class PackageTarget {
  registry: string;
  name: string;
  version: string;
  range: SemverRange;

  constructor (registry: string, name: string, version: string) {
    this.registry = registry;
    this.name = name;
    this.range = new SemverRange(version);
    // ^ -> ~ conversion save
    if (version[0] === '^' && this.range.isStable)
      this.version = this.range.toString();
    else
      this.version = version;
  }

  fromRegistry (registry: string) {
    return new PackageTarget(registry, this.name, this.version);
  }

  fromVersion (version: string) {
    return new PackageTarget(this.registry, this.name, version);
  }

  eq (target: PackageTarget) {
    return target instanceof PackageTarget && 
        this.version === target.version && this.name === target.name && this.registry === target.registry;
  }

  has (pkg: ExactPackage) {
    return this.registry === pkg.registry && this.name === pkg.name && this.range.has(pkg.semver);
  }

  contains (target: PackageTarget) {
    return this.registry === target.registry && this.name === target.name && this.range.contains(target.range);
  }

  intersect (target: PackageTarget) {
    return this.registry === target.registry && this.name === target.name && this.range.intersect(target.range);
  }

  toString () {
    return `${this.registry}:${this.name}${this.version ? `@${this.version}` : ''}`;
  }
}

/*
 * Resolution maps
 */
export interface ResolveRecord {
  source: string,
  resolve: {
    [name: string]: ExactPackage
  }
}

const baseConfig = emptyPackageConfig();

export class ResolveTree {
  resolve: {
    [name: string]: ExactPackage
  }
  dependencies: {
    [packageName: string]: ResolveRecord
  }

  constructor (resolve = {}, dependencies = {}) {
    Object.keys(resolve).forEach(name => {
      resolve[name] = parseExactPackageName(resolve[name]);
    });
    Object.keys(dependencies).forEach(parent => {
      const resolveMap = dependencies[parent];
      if (resolveMap.resolve)
        Object.keys(resolveMap.resolve).forEach(name => {
          resolveMap.resolve[name] = parseExactPackageName(resolveMap.resolve[name]);
        });
      else
        resolveMap.resolve = {};
      if (resolveMap.override)
        resolveMap.override = overridePackageConfig(baseConfig, <PackageConfig>(resolveMap.override)).override;
    });

    this.resolve = resolve;
    this.dependencies = dependencies;
  }

  serialize () {
    const resolve = {};
    const dependencies = {};
    Object.keys(this.resolve).sort().forEach(name => {
      resolve[name] = serializePackageName(this.resolve[name]);
    });
    Object.keys(this.dependencies).sort().forEach(parent => {
      const depObj: any = dependencies[parent] = {};
      const originalDepObj = this.dependencies[parent];
      if (originalDepObj.source)
        depObj.source = originalDepObj.source;
      if (originalDepObj.resolve && hasProperties(originalDepObj.resolve)) {
        depObj.resolve = {};
        Object.keys(originalDepObj.resolve).forEach(name => {
          depObj.resolve[name] = serializePackageName(originalDepObj.resolve[name]);
        });
      }
    });
    return { resolve, dependencies };
  }

  createResolveRecord (resolution: string): ResolveRecord {
    return this.dependencies[resolution] = { source: undefined, resolve: {} };
  }

  getResolution ({ name, parent }: { name: string, parent: string | void }): ExactPackage {
    if (!parent)
      return this.resolve[name];
    const depObj = this.dependencies[parent];
    if (depObj)
      return depObj.resolve[name];
  }

  getBestMatch (target: PackageTarget, edge: boolean = false): ExactPackage {
    let bestMatch;
    this.visit((pkg, _name, _parent) => {
      if (pkg.registry !== target.registry || pkg.name !== target.name || !target.range.has(pkg.version, edge))
        return;
      if (!bestMatch)
        bestMatch = pkg;
      else if (pkg.semver.gt(bestMatch.version))
        bestMatch = pkg;
    });
    return bestMatch;
  }

  // package selector
  select (selector: string): { name: string, parent: string | void }[] {
    const registryIndex = selector.indexOf(':');
    let registry, name, range;
    if (registryIndex !== -1) {
      registry = name.substr(0, registryIndex);
      name = name.substr(registryIndex + 1);
    }
    else {
      name = selector;
    }
    const versionIndex = name.indexOf('@');
    if (versionIndex > 0) {
      range = new SemverRange(name.substr(versionIndex + 1));
      name = name.substr(0, versionIndex);
    }
    else {
      range = new SemverRange('*');
    }

    const matches = [];
    this.visit((pkg, pkgName, pkgParent) => {
      if (range && !range.has(pkg.semver, true) ||
          pkg.name !== name && pkg.name.split('/').pop() !== name ||
          registry && pkg.registry !== registry)
        return;
      matches.push({ name: pkgName, parent: pkgParent });
    });
    return matches;
  }

  visit (visitor: (pkg: ExactPackage, name: string, parent?: string) => void | boolean): boolean {
    for (const name of Object.keys(this.resolve)) {
      if (visitor(this.resolve[name], name, undefined))
        return true;
    }
    for (const parent of Object.keys(this.dependencies)) {
      const depMap = this.dependencies[parent];
      if (!depMap.resolve)
        continue;
      for (const name of Object.keys(depMap.resolve)) {
        if (visitor(depMap.resolve[name], name, parent))
          return true;
      }
    }
    return false;
  }

  async visitAsync (visitor: (pkg: ExactPackage, name: string, parent?: string) => Promise<void | boolean>): Promise<boolean> {
    for (const name of Object.keys(this.resolve)) {
      if (await visitor(this.resolve[name], name, undefined))
        return true;
    }
    for (const parent of Object.keys(this.dependencies)) {
      const depMap = this.dependencies[parent];
      if (!depMap.resolve)
        continue;
      for (const name of Object.keys(depMap.resolve)) {
        if (await visitor(depMap.resolve[name], name, parent))
          return true;
      }
    }
    return false;
  }
}

/*
 * Package Configuration
 */
export async function readPackageConfig (pkgPath: string) {
  const json = await readJSON(path.join(pkgPath, 'package.json'));
  if (!json)
    return;
  return processPackageConfig(json);
}

export interface ExportsTargetCondition {
  [condition: string]: string | null | any | ExportsTargetCondition;
};

export type ExportsTarget = string | null | any | ExportsTargetCondition | (string | null | any | ExportsTargetCondition)[];

export interface PackageConfig {
  registry?: string;
  name?: string;
  version?: string;
  type?: string;
  'react-native'?: string;
  electron?: string;
  browser?: any;
  main?: string;
  exports?: ExportsTarget | {
    [path: string]: ExportsTarget
  };
  map?: {
    [name: string]: ExportsTarget
  };
  namedExports?: Record<string, string[]>;
  bin?: {
    [name: string]: string;
  };
  dependencies?: {
    [name: string]: string;
  };
  devDependencies?: {
    [name: string]: string;
  };
  peerDependencies?: {
    [name: string]: string;
  };
  optionalDependencies?: {
    [name: string]: string;
  };
  scripts: Record<string, string>;
}

export function serializePackageTargetCanonical (name: string, target: PackageTarget | string, defaultRegistry = '') {
  if (typeof target === 'string')
    return target;
  const registry = target.registry !== defaultRegistry ? target.registry + ':' : '';
  const pkgName = target.name[0] === '@' && target.registry !== defaultRegistry ? target.name.substr(1) : target.name;
  if (registry || target.name !== name)
    return registry + pkgName + (target.range.isWildcard ? '' : '@' + target.version);
  else
    return target.version || '*';
}

/*
 * Processed package configuration has dependencies in precanonical form
 *   precanonical means canonical down to unknown parent registry
 *
 * {
 *   a: 'b@2_*',
 *   b: 'github:x/y',
 *   c: 'https://github.com/x/y#asdf',
 *   d: '>2.0.0'
 * }
 * 
 * ->
 * 
 * {
 *   a: ':b@2_%2A',
 *   b: 'github:x/y',
 *   c: 'https://github.com/x/y#asdf',
 *   d: ':d@^2.0.0'
 * }
 * 
 * We do not convert github resource sources into registry sources, as
 * resource handling should be consistent
 * 
 * partial is for npm partial package meta where we mustn't fill out things that will come in full package.json parse
 */
const validKeys = ['peerDependencies', 'type', 'map', 'bin', 'namedExports', 'noModuleConversion', 'registry', 'dependencies', 'peerDependencies', 'optionalDependencies', 'map', 'main'];
export function validateOverride (pcfg: PackageConfig, name: string) {
  for (let p in pcfg) {
    if (validKeys.indexOf(p) === -1)
      throw new JspmUserError(`${bold(`"${p}"`)} is not a valid property to override for ${highlight(name)}.`);
  }
  return true;
}

function emptyPackageConfig (): PackageConfig {
  return Object.create(null);
}

export function processPackageConfig (pcfg: any) {
  if (typeof pcfg.jspm !== 'object')
    return <PackageConfig>pcfg;
  const processed: PackageConfig = Object.assign({}, pcfg);
  if (pcfg.jspm.dependencies || pcfg.jspm.devDependencies || pcfg.jspm.peerDependencies || pcfg.jspm.optionalDependencies) {
    delete processed.dependencies;
    delete processed.devDependencies;
    delete processed.peerDependencies;
    delete processed.optionalDependencies;
  }
  return Object.assign(processed, pcfg.jspm);
}

/*
 * We support everything npm does and more (registries), except for
 * two node conventions (rarely used) not supported here:
 *   1. "x": "a/b" (github shorthand)
 *   2. "x": "a/b/c" (file system shorthand)
 * Support for these could be provided by a custom npm conversion if necessary
 * but let's see how far we get avoiding this
 */
const fileInstallRegEx = /^(\.[\/\\]|\.\.[\/\\]|\/|\\|~[\/\\])/;
export function processPackageTarget (depName: string | null, depTarget: string, defaultRegistry = '', rangeConversion = false): string | PackageTarget {
  const registryIndex = depTarget.indexOf(':');
  /*
   * File install sugar cases:
   *   ./local -> file:./local
   *   /local -> file:/local
   *   ~/file -> file:~/file
   * (Should ideally support a/b/c -> file:a/b/c resource sugar, but for now omitted)
   */
  if (depTarget.match(fileInstallRegEx))
    return 'file:' + depTarget;

  let registry, name, version;
  if (registryIndex < 1) {
    registry = defaultRegistry;
  }
  else {
    registry = depTarget.substr(0, registryIndex);
    // resource install opt-out
    if (registry in sourceProtocols)
      return depTarget;
  }
  const versionIndex = depTarget.lastIndexOf('@');
  if (versionIndex > registryIndex + 1) {
    name = depTarget.substring(registryIndex + 1, versionIndex);
    version = depTarget.substr(versionIndex + 1);
  }
  else if (registryIndex === -1) {
    if (depName) {
      name = depName;
      version = depTarget.substr(registryIndex + 1);
    }
    else {
      name = depTarget.split('/').pop();
      version = '*';
    }
  }
  else {
    name = depTarget.substr(registryIndex + 1);
    version = '*';
  }
  if (rangeConversion) {
    if (!SemverRange.isValid(version)) {
      let converted = convertRange(version);
      if (converted.isExact)
        version = encodeInvalidFileChars(converted.toString());
      else
        version = converted.toString();
    }
  }
  else if (!(version[0] === '^' && SemverRange.isValid(version)) && version !== '*') {
    version = encodeInvalidFileChars(version);
  }


  /*
   * GitHub installs target install sugars:
   * a/b -> git+https://github.com/a/b
   * github:a/b -> git+https://github.com/a/b
   */
  if (registryIndex === -1 && name.indexOf('/') !== -1 && name[0] !== '@')
    return (process.env.JSPM_CI ? 'git+https:' : 'git+ssh:') + '//github.com/' + name + (version === '*' ? '' : '#' + version);
  else if (registry === 'github')
    return (process.env.JSPM_CI ? 'git+https:' : 'git+ssh:') + '//github.com/' + name.slice(Number(name[0] === '@')) + (version === '*' ? '' : '#' + version);

  const targetNameLen = name.split('/').length;
  if (targetNameLen > 2)
    throw new JspmUserError(`Invalid package target ${bold(depTarget)}`);
  if (targetNameLen === 2 && name[0] !== '@')
    name = '@' + name;
  if (targetNameLen === 1 && name[0] === '@')
    throw new JspmUserError(`Invalid package target ${bold(depTarget)}`);
  return new PackageTarget(registry, name, version);
}

// only override properties we care about
const overrideProperties = new Set([
  'registry',
  'name',
  'version',
  'type',
  'react-native',
  'electron',
  'browser',
  'main',
  'exports',
  'map',
  'namedExports',
  'bin',
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies'
]);

export function overridePackageConfig (pcfg: PackageConfig, overridePcfg: PackageConfig): {
  config: PackageConfig,
  override: PackageConfig | void
} {
  let override: PackageConfig;
  for (let p in overridePcfg) {
    if (!overrideProperties.has(p))
      continue;
    const val = overridePcfg[p];
    if (typeof val === 'object') {
      let baseVal = pcfg[p];
      if (val === null) {
        if (pcfg[p] != null) {
          pcfg[p] = val;
          if (!override)
            override = emptyPackageConfig();
          override[p] = null;
        }
      }
      else {
        if (baseVal === undefined)
          baseVal = {};
        if (typeof baseVal !== 'object') {
          if (p === 'bin') {
            baseVal = { [pcfg.name]: baseVal };
          }
          else {
            throw new Error(`Unable to override "${p}" primitive "${baseVal.toString()}" with object "${JSON.stringify(val)}".`);
          }
        }
        for (let q in val) {
          if (JSON.stringify(baseVal[q]) !== JSON.stringify(val[q])) {
            override = override || emptyPackageConfig();
            override[p] = override[p] || {};
            baseVal[q] = override[p][q] = val[q];
            pcfg[p] = baseVal;
          }
        }
      }
    }
    // undefined is not an override (use null)
    else if (pcfg[p] !== val && val !== undefined) {
      if (!override)
        override = emptyPackageConfig();
      pcfg[p] = override[p] = val;
    }
  }

  return {
    config: pcfg,
    override
  };
}

export function sha256 (input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
};

/*
 * Dependency Interfaces
 */

export enum DepType {
  // primary refers to the main install target (which may or may not have a parent)
  primary,
  // dev is top-level dev install
  dev,
  // peer is from subdependency or top-level
  peer,
  // optional is top-level optional install
  optional,
  // secondary is any non-peer install generated for dependencies of install
  secondary
};

export interface DepMap {
  [name: string]: string
}

export interface Dependencies {
  dependencies?: DepMap,
  devDependencies?: DepMap,
  peerDependencies?: DepMap,
  optionalDependencies?: DepMap
}