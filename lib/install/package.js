"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
// collection of package handling helpers
const common_1 = require("../utils/common");
const sver_1 = require("sver");
const convertRange = require("sver/convert-range");
const { processPjsonConfig } = require('@jspm/resolve');
exports.processPjsonConfig = processPjsonConfig;
const crypto = require("crypto");
const source_1 = require("./source");
;
exports.resourceInstallRegEx = /^(?:file|https?|git|git\+(?:file|ssh|https)?):/;
const packageRegEx = /^([a-z]+):([@\-_\.a-zA-Z\d][-_\.a-zA-Z\d]*(?:\/[-_\.a-zA-Z\d]+)*)(?:@([^@]+))?$/;
// this function should also handle the encoding part
function parsePackageName(name) {
    let packageMatch = name.match(packageRegEx);
    if (!packageMatch)
        throw new Error(`\`${name}\` is not a valid package name.`);
    return {
        registry: packageMatch[1],
        name: packageMatch[2],
        version: packageMatch[3]
    };
}
exports.parsePackageName = parsePackageName;
function parseExactPackageName(name) {
    let packageMatch = name.match(packageRegEx);
    if (!packageMatch)
        throw new Error(`\`${name}\` is not a valid package name.`);
    const version = packageMatch[3] ? common_1.encodeInvalidFileChars(packageMatch[3]) : '*';
    return {
        registry: packageMatch[1],
        name: packageMatch[2],
        version,
        semver: new sver_1.Semver(version)
    };
}
exports.parseExactPackageName = parseExactPackageName;
function serializePackageName(pkg) {
    if (typeof pkg === 'string')
        return pkg;
    return `${pkg.registry}:${pkg.name}${(pkg.version ? '@' : '') + pkg.version}`;
}
exports.serializePackageName = serializePackageName;
function packageNameEq(pkgA, pkgB) {
    if (typeof pkgA === 'string' || typeof pkgB === 'string')
        return pkgA === pkgB;
    return pkgA.registry === pkgB.registry && pkgA.name === pkgB.name && pkgA.version === pkgB.version;
}
exports.packageNameEq = packageNameEq;
class PackageTarget {
    constructor(registry, name, version) {
        this.registry = registry;
        this.name = name;
        this.range = new sver_1.SemverRange(version);
        // ^ -> ~ conversion save
        if (version[0] === '^' && this.range.isStable)
            this.version = this.range.toString();
        else
            this.version = version;
    }
    fromRegistry(registry) {
        return new PackageTarget(registry, this.name, this.version);
    }
    fromVersion(version) {
        return new PackageTarget(this.registry, this.name, version);
    }
    eq(target) {
        return target instanceof PackageTarget &&
            this.version === target.version && this.name === target.name && this.registry === target.registry;
    }
    has(pkg) {
        return this.registry === pkg.registry && this.name === pkg.name && this.range.has(pkg.semver);
    }
    contains(target) {
        return this.registry === target.registry && this.name === target.name && this.range.contains(target.range);
    }
    intersect(target) {
        return this.registry === target.registry && this.name === target.name && this.range.intersect(target.range);
    }
    toString() {
        return `${this.registry}:${this.name}${this.version ? `@${this.version}` : ''}`;
    }
}
exports.PackageTarget = PackageTarget;
const baseConfig = processPackageConfig({});
class ResolveTree {
    constructor(resolve = {}, dependencies = {}) {
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
                resolveMap.override = overridePackageConfig(baseConfig, processPackageConfig(resolveMap.override)).override;
        });
        this.resolve = resolve;
        this.dependencies = dependencies;
    }
    serialize() {
        const resolve = {};
        const dependencies = {};
        Object.keys(this.resolve).sort().forEach(name => {
            resolve[name] = serializePackageName(this.resolve[name]);
        });
        Object.keys(this.dependencies).sort().forEach(parent => {
            const depObj = dependencies[parent] = {};
            const originalDepObj = this.dependencies[parent];
            if (originalDepObj.source)
                depObj.source = originalDepObj.source;
            if (originalDepObj.resolve && common_1.hasProperties(originalDepObj.resolve)) {
                depObj.resolve = {};
                Object.keys(originalDepObj.resolve).forEach(name => {
                    depObj.resolve[name] = serializePackageName(originalDepObj.resolve[name]);
                });
            }
        });
        return { resolve, dependencies };
    }
    createResolveRecord(resolution) {
        return this.dependencies[resolution] = { source: undefined, resolve: {} };
    }
    getResolution({ name, parent }) {
        if (!parent)
            return this.resolve[name];
        const depObj = this.dependencies[parent];
        if (depObj)
            return depObj.resolve[name];
    }
    getBestMatch(target, edge = false) {
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
    select(selector) {
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
            range = new sver_1.SemverRange(name.substr(versionIndex + 1));
            name = name.substr(0, versionIndex);
        }
        else {
            range = new sver_1.SemverRange('*');
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
    visit(visitor) {
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
    async visitAsync(visitor) {
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
exports.ResolveTree = ResolveTree;
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
function serializePackageTargetCanonical(name, target, defaultRegistry = '') {
    if (typeof target === 'string')
        return target;
    const registry = target.registry !== defaultRegistry ? target.registry + ':' : '';
    if (registry || target.name !== name)
        return registry + target.name + (target.range.isWildcard ? '' : '@' + target.version);
    else
        return target.version || '*';
}
exports.serializePackageTargetCanonical = serializePackageTargetCanonical;
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
function processPackageConfig(pcfg, partial = false) {
    const processed = processPjsonConfig(pcfg);
    if (typeof pcfg.name === 'string')
        processed.name = pcfg.name;
    if (typeof pcfg.version === 'string')
        processed.version = pcfg.version;
    if (partial) {
        delete processed.main;
        delete processed.map;
    }
    else {
        if (typeof pcfg.mode === 'string')
            processed.mode = pcfg.mode;
        else
            processed.mode = 'cjs';
        if (typeof pcfg.namedExports === 'object' && Object.keys(pcfg.namedExports).every(key => pcfg.namedExports[key] instanceof Array && pcfg.namedExports[key].every(value => typeof value === 'string')))
            processed.namedExports = pcfg.namedExports;
        if (pcfg.skipESMConversion === true || pcfg.skipESMConversion instanceof Array && pcfg.skipESMConversion.every(x => typeof x === 'string'))
            processed.skipESMConversion = pcfg.skipESMConversion;
        if (processed.mode === 'cjs' && !processed.skipESMConversion)
            delete processed.mode;
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
                //if (!binPath.endsWith('.js'))
                //  binPath += '.js';
                processed.bin[p] = binPath;
            }
        }
    }
    if (pcfg.dependencies) {
        const dependencies = processed.dependencies = {};
        for (const name in pcfg.dependencies)
            dependencies[name] = processPackageTarget(name, pcfg.dependencies[name], '', true);
    }
    if (pcfg.peerDependencies) {
        const peerDependencies = processed.peerDependencies = {};
        for (const name in pcfg.peerDependencies)
            peerDependencies[name] = processPackageTarget(name, pcfg.peerDependencies[name], '', true);
    }
    if (pcfg.optionalDependencies) {
        const optionalDependencies = processed.optionalDependencies = {};
        for (const name in pcfg.optionalDependencies)
            optionalDependencies[name] = processPackageTarget(name, pcfg.optionalDependencies[name], '', true);
    }
    return processed;
}
exports.processPackageConfig = processPackageConfig;
/*
 * We support everything npm does and more (registries), except for
 * two node conventions (rarely used) not supported here:
 *   1. "x": "a/b" (github shorthand)
 *   2. "x": "a/b/c" (file system shorthand)
 * Support for these could be provided by a custom npm conversion if necessary
 * but let's see how far we get avoiding this
 */
function processPackageTarget(depName, depTarget, defaultRegistry = '', rangeConversion = false) {
    let registry, name, version;
    const registryIndex = depTarget.indexOf(':');
    if (registryIndex < 1) {
        registry = defaultRegistry;
    }
    else {
        registry = depTarget.substr(0, registryIndex);
        if (registry in source_1.sourceProtocols)
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
        if (!sver_1.SemverRange.isValid(version)) {
            let converted = convertRange(version);
            if (converted.isExact)
                version = common_1.encodeInvalidFileChars(converted.toString());
            else
                version = converted.toString();
        }
    }
    else if (!(version[0] === '^' && sver_1.SemverRange.isValid(version)) && version !== '*') {
        version = common_1.encodeInvalidFileChars(version);
    }
    return new PackageTarget(registry, name, version);
}
exports.processPackageTarget = processPackageTarget;
function overrideConditional(conditional, overrideConditional) {
    let override;
    // new map properties take priority first
    const newConditional = {};
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
function overrideMapConfig(map, overrideMap) {
    let override;
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
function serializePackageConfig(pcfg, defaultRegistry) {
    const spcfg = {};
    if (pcfg.registry)
        spcfg.registry = pcfg.registry;
    if (pcfg.name)
        spcfg.name = pcfg.name;
    if (pcfg.version)
        spcfg.version = pcfg.version;
    if (pcfg.bin)
        spcfg.bin = pcfg.bin;
    if (pcfg.skipESMConversion)
        spcfg.skipESMConversion = pcfg.skipESMConversion;
    else if (pcfg.mode === 'cjs')
        spcfg.mode = 'cjs';
    if (pcfg.namedExports)
        spcfg.namedExports = pcfg.namedExports;
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
    spcfg.mode = pcfg.mode;
    if (pcfg.main)
        spcfg.main = pcfg.main;
    if (pcfg.map)
        spcfg.map = pcfg.map;
    return spcfg;
}
exports.serializePackageConfig = serializePackageConfig;
function overridePackageConfig(pcfg, overridePcfg) {
    let override;
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
                if (p === 'map') {
                    const { map, override: mapOverride } = overrideMapConfig(baseVal, val);
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
                        pcfg.bin = baseVal;
                    }
                }
                else if (p === 'namedExports') {
                    for (let q in overridePcfg.namedExports) {
                        if (JSON.stringify(baseVal[q]) === JSON.stringify(overridePcfg.namedExports[q]))
                            continue;
                        override = override || {};
                        override.namedExports = override.namedExports || {};
                        baseVal[q] = override.namedExports[q] = overridePcfg.namedExports[q];
                        pcfg.namedExports = baseVal;
                    }
                }
                else if (p === 'skipESMConversion') {
                    if (JSON.stringify(baseVal) === JSON.stringify(overridePcfg.skipESMConversion))
                        continue;
                    override = override || {};
                    pcfg.skipESMConversion = override.skipESMConversion = overridePcfg.skipESMConversion;
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
    if (pcfg.skipESMConversion && pcfg.mode === 'cjs')
        delete override.mode;
    return {
        config: pcfg,
        override
    };
}
exports.overridePackageConfig = overridePackageConfig;
function sha256(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}
exports.sha256 = sha256;
;
/*
 * Dependency Interfaces
 */
var DepType;
(function (DepType) {
    // primary refers to the main install target (which may or may not have a parent)
    DepType[DepType["primary"] = 0] = "primary";
    // dev is top-level dev install
    DepType[DepType["dev"] = 1] = "dev";
    // peer is from subdependency or top-level
    DepType[DepType["peer"] = 2] = "peer";
    // optional is top-level optional install
    DepType[DepType["optional"] = 3] = "optional";
    // secondary is any non-peer install generated for dependencies of install
    DepType[DepType["secondary"] = 4] = "secondary";
})(DepType = exports.DepType || (exports.DepType = {}));
;
//# sourceMappingURL=package.js.map