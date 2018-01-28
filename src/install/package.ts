/*
 *   Copyright 2014-2017 Guy Bedford (http://guybedford.com)
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

import { encodeInvalidFileChars, hasProperties } from '../utils/common';
import { Semver, SemverRange } from 'sver';
import convertRange = require('sver/convert-range');
const { processPjsonConfig } = require('jspm-resolve');
import crypto = require('crypto');
export { processPjsonConfig }
import { sourceProtocols } from './source';

/*
 * Package name handling
 */
export interface PackageName {
  registry: string;
  name: string;
  version: string;
};

export const resourceInstallRegEx = /^(?:file|https?|git|git\+(?:file|ssh|https)?):/;

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

const baseConfig = processPackageConfig({});

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
        resolveMap.override = overridePackageConfig(baseConfig, processPackageConfig(resolveMap.override, true)).override;
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

export interface Conditional {
  [condition: string]: string | Conditional
}

export interface MapConfig {
  [name: string]: string | Conditional
}

export interface ProcessedPackageConfig {
  registry?: string,
  name?: string,
  version?: string,
  esm?: boolean,
  mains?: Conditional,
  map?: MapConfig,
  bin?: {
    [name: string]: string
  },
  dependencies?: {
    [name: string]: PackageTarget | string
  },
  peerDependencies?: {
    [name: string]: PackageTarget | string
  },
  optionalDependencies?: {
    [name: string]: PackageTarget | string
  }
}

// package configuration + sugars
export interface PackageConfig {
  registry?: string,
  name?: string,
  version?: string,
  esm?: boolean,
  mains?: Conditional,
  map?: MapConfig,
  bin?: string | {
    [name: string]: string
  },
  dependencies?: {
    [name: string]: string
  },
  peerDependencies?: {
    [name: string]: string
  },
  optionalDependencies?: {
    [name: string]: string
  },

  main?: string,
  module?: boolean | string,
  'react-native'?: string,
  electron?: string,
  browser?: string | {
    [name: string]: string | boolean
  }
}

// Target is assumed pre-canonicalized
// Note target validation should be performed separately
/* export function parseTarget (depTarget: string, defaultRegistry: string): PackageName | string {
  let registry, name, version;
  const registryIndex = depTarget.indexOf(':');
  if (registryIndex === -1) {
    registry = defaultRegistry;
  }
  // we allow :x to mean registry relative (dependencies: { a: ":b" })
  else if (registryIndex === 0) {
    registry = defaultRegistry;
  }
  else {
    registry = depTarget.substr(0, registryIndex);
    if (registry in sourceProtocols)
      return depTarget;
  }
  const versionIndex = depTarget.lastIndexOf('@');
  if (versionIndex > registryIndex + 1) {
    name = depTarget.substring(registryIndex + 1, versionIndex);
    version = depTarget.substr(versionIndex + 1);
  }
  else {
    name = depTarget.substr(registryIndex + 1);
    version = '*';
  }
  return { registry, name, version };
} */

export function serializePackageTargetCanonical (name: string, target: PackageTarget | string, defaultRegistry = '') {
  if (typeof target === 'string')
    return target;
  const registry = target.registry !== defaultRegistry ? target.registry + ':' : '';
  if (registry || target.name !== name)
    return registry + target.name + (target.range.isWildcard ? '' : '@' + target.version);
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
 */
export function processPackageConfig (pcfg: PackageConfig, rangeConversion = false): ProcessedPackageConfig {
  const processed: ProcessedPackageConfig = processPjsonConfig(pcfg);
  if (typeof pcfg.registry === 'string')
    processed.registry = pcfg.registry;
  if (typeof pcfg.name === 'string')
    processed.name = pcfg.name;
  if (typeof pcfg.version === 'string')
    processed.version = pcfg.version;
  if (typeof pcfg.bin === 'string') {
    let binPath = pcfg.bin.startsWith('./') ? pcfg.bin.substr(2) : pcfg.bin;
    if (!binPath.endsWith('.js'))
      binPath += '.js';
    processed.bin = { [pcfg.name]: binPath };
  }
  else if (typeof pcfg.bin === 'object') {
    processed.bin = {};
    for (let p in pcfg.bin) {
      const mapped = pcfg.bin[p];
      let binPath = mapped.startsWith('./') ? mapped.substr(2) : mapped;
      if (!binPath.endsWith('.js'))
        binPath += '.js';
      processed.bin[p] = binPath;
    }
  }
  if (pcfg.dependencies) {
    const dependencies = processed.dependencies = {};
    for (const name in pcfg.dependencies)
      dependencies[name] = processPackageTarget(name, pcfg.dependencies[name], '', rangeConversion);
  }
  if (pcfg.peerDependencies) {
    const peerDependencies = processed.peerDependencies = {};
    for (const name in pcfg.peerDependencies)
      peerDependencies[name] = processPackageTarget(name, pcfg.peerDependencies[name], '', rangeConversion);
  }
  if (pcfg.optionalDependencies) {
    const optionalDependencies = processed.optionalDependencies = {};
    for (const name in pcfg.optionalDependencies)
      optionalDependencies[name] = processPackageTarget(name, pcfg.optionalDependencies[name], '', rangeConversion);
  }
  return processed;
}

/*
 * We support everything npm does and more (registries), except for
 * two node conventions (rarely used) not supported here:
 *   1. "x": "a/b" (github shorthand)
 *   2. "x": "a/b/c" (file system shorthand)
 * Support for these could be provided by a custom npm conversion if necessary
 * but let's see how far we get avoiding this
 */
export function processPackageTarget (depName: string, depTarget: string, defaultRegistry = '', rangeConversion = false): string | PackageTarget {
  let registry, name, version;
  const registryIndex = depTarget.indexOf(':');
  if (registryIndex < 1) {
    registry = defaultRegistry;
  }
  else {
    registry = depTarget.substr(0, registryIndex);
    if (registry in sourceProtocols)
      return depTarget;
  }
  const versionIndex = depTarget.lastIndexOf('@');
  if (versionIndex > registryIndex + 1) {
    name = depTarget.substring(registryIndex + 1, versionIndex);
    version = depTarget.substr(versionIndex + 1);
  }
  else if (registryIndex === -1) {
    name = depName;
    version = depTarget.substr(registryIndex + 1);
  }
  else {
    name = depTarget.substr(registryIndex + 1);
    // support github:asdf/asdf#version version method as well
    // for npm compatibility
    const hashIndex = name.indexOf('#');
    if (hashIndex === -1) {
      version = '*';
    }
    else {
      name = name.substr(0, hashIndex);
      version = name.substr(hashIndex + 1);
    }
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
  return new PackageTarget(registry, name, version);
}

function overrideConditional (conditional: Conditional, overrideConditional: Conditional) {
  let override: Conditional;
  // new map properties take priority first
  const newConditional: Conditional = {};
  for (let c in overrideConditional) {
    const existingCondition = conditional[c];
    const extendCondition = overrideConditional[c];
    if (!existingCondition || (typeof existingCondition === 'string'
        ? existingCondition !== extendCondition
        : typeof extendCondition === 'object' && JSON.stringify(existingCondition) !== JSON.stringify(extendCondition)))
      newConditional[c] = (override = override || {})[c] = extendCondition;
  }
  if (!newConditional.default) {
    for (let c in conditional) {
      if (c in newConditional)
        continue;
      newConditional[c] = conditional[c];
    }
  }
  return {
    conditional: newConditional,
    override
  };
}

function overrideMapConfig (map: MapConfig, overrideMap: MapConfig) {
  let override: MapConfig;
  for (let m in overrideMap) {
    const existingVal = map[m];
    let extendVal = overrideMap[m];
    if (existingVal == undefined || typeof extendVal === 'string') {
      if (map[m] !== extendVal)
        map[m] = (override = override || {})[m] = extendVal;
    }
    else if (extendVal == undefined) {
      if (existingVal != undefined) {
        (override = {})[m] = extendVal;
        delete map[m];
      }
    }
    else if (extendVal.default && Object.keys(extendVal).length === 1) {
      if (existingVal !== extendVal.default)
        map[m] = (override = override || {})[m] = extendVal.default;
    }
    else {
      // new map properties take priority first
      let newMapOverride;
      ({ conditional: map[m], override: newMapOverride } = overrideConditional(typeof existingVal === 'string' ? { default: existingVal } : existingVal, extendVal));
      if (newMapOverride)
        (override = override || {})[m] = newMapOverride;
    }
  }
  return {
    map,
    override
  };
}

// recanonicalize the output of a processed package config
const mainTypes = ['browser', 'electron', 'react-native', 'module', 'default'];
export function serializePackageConfig (pcfg: ProcessedPackageConfig, defaultRegistry?: string): PackageConfig {
  const spcfg: PackageConfig = {};
  if (pcfg.registry)
    spcfg.registry = pcfg.registry;
  if (pcfg.name)
    spcfg.name = pcfg.name;
  if (pcfg.version)
    spcfg.version = pcfg.version;
  if (pcfg.bin)
    spcfg.bin = pcfg.bin;
  if (pcfg.dependencies) {
    const dependencies = spcfg.dependencies = {};
    for (let p in pcfg.dependencies)
      dependencies[p] = serializePackageTargetCanonical(p, pcfg.dependencies[p], defaultRegistry);
  }
  if (pcfg.peerDependencies) {
    const peerDependencies = spcfg.peerDependencies = {};
    for (let p in pcfg.peerDependencies)
      peerDependencies[p] = serializePackageTargetCanonical(p, pcfg.peerDependencies[p], defaultRegistry);
  }
  if (pcfg.optionalDependencies) {
    const optionalDependencies = spcfg.optionalDependencies = {};
    for (let p in pcfg.optionalDependencies)
      optionalDependencies[p] = serializePackageTargetCanonical(p, pcfg.optionalDependencies[p], defaultRegistry);
  }
  if (pcfg.esm === true) {
    spcfg.esm = true;
  }
  if (pcfg.mains) {
    let mainSugar = true;
    for (let c in pcfg.mains) {
      const target = pcfg.mains[c];
      let defaultString;
      if (typeof target === 'string') {
        defaultString = target;
      }
      else if (typeof target === 'object') {
        for (let p in target) {
          if (p === 'default' && typeof target.default === 'string') {
            defaultString = target[p];
          }
          else {
            defaultString = undefined;
            break;
          }
        }
      }
      if (!defaultString || !mainTypes.includes(defaultString)) {
        mainSugar = false;
        spcfg.mains = pcfg.mains;
        break;
      }
    }
    if (mainSugar) {
      for (let c in pcfg.mains) {
        const target = pcfg.mains[c];
        const main = typeof target === 'string' ? target : <string>target.default;
        if (c === 'default')
          spcfg.main = main;
        else
          spcfg[c] = main;
      }
    }
  }
  if (pcfg.map) {
    spcfg.map = pcfg.map;
  }
  return spcfg;
}

export function overridePackageConfig (pcfg: ProcessedPackageConfig, overridePcfg: ProcessedPackageConfig): {
  config: ProcessedPackageConfig,
  override: ProcessedPackageConfig | void
} {
  let override: ProcessedPackageConfig;
  for (let p in overridePcfg) {
    const val = overridePcfg[p];
    if (typeof val === 'object') {
      let baseVal = pcfg[p];
      if (val === null) {
        if (pcfg[p] != null) {
          pcfg[p] = val;
          if (!override)
            override = {};
          override[p] = null;
        }
      }
      else {
        if (baseVal === undefined)
          baseVal = {};
        if (p === 'mains') {
          const { conditional, override: conditionalOverride } = overrideConditional(baseVal, val);
          if (conditional)
            pcfg.mains = conditional;
          if (conditionalOverride) {
            if (!override)
              override = {};
            override.mains =  conditionalOverride;
          }
        }
        else if (p === 'map') {
          const { map, override: mapOverride } = overrideMapConfig(baseVal,  val);
          if (map)
            pcfg.map = map;
          if (mapOverride) {
            if (!override)
              override = {};
            override.map = mapOverride;
          }
        }
        else if (p === 'bin') {
          for (let q in overridePcfg.bin) {
            if (baseVal[q] === overridePcfg.bin[q])
              continue;
            override = override || {};
            override.bin = override.bin || {};
            baseVal[q] = override.bin[q] = overridePcfg.bin[q];
          }
        }
        // dependencies
        else {
          let depsOverride;
          for (let q in val) {
            const newVal = val[q];
            if (typeof newVal === 'string' && baseVal[q] !== newVal || !newVal.eq(baseVal[q])) {
              if (depsOverride === undefined) {
                if (!override)
                  override = {};
                override[p] = depsOverride = {};
              }
              baseVal[q] = depsOverride[q] = newVal;
            }
          }
        }
      }
    }
    // undefined is not an override (use null)
    else if (pcfg[p] !== val && val !== undefined) {
      if (!override)
        override = {};
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
  [name: string]: string | PackageTarget
}

export interface Dependencies {
  dependencies?: DepMap,
  devDependencies?: DepMap,
  peerDependencies?: DepMap,
  optionalDependencies?: DepMap
}