"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const common_1 = require("../utils/common");
var common_2 = require("./common");
exports.createPackageMap = common_2.createPackageMap;
exports.resolveIfNotPlainOrUrl = common_2.resolveIfNotPlainOrUrl;
function extend(packageMap, extendMap) {
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
exports.extend = extend;
function getMatch(path, matchObj) {
    let sepIndex = path.length;
    do {
        const segment = path.slice(0, sepIndex);
        if (segment in matchObj)
            return segment;
    } while ((sepIndex = path.lastIndexOf('/', sepIndex - 1)) !== -1);
}
exports.getMatch = getMatch;
// any plain maps in scopes which match base maps can be removed
// then removes empty properties and alphabetizes
function clean(packageMap) {
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
    packageMap.packages = common_1.alphabetize(packageMap.packages);
    packageMap.scopes = common_1.alphabetize(packageMap.scopes);
    outer: for (const scope of Object.keys(packageMap.scopes)) {
        for (let _p in packageMap.scopes[scope].packages) {
            packageMap.scopes[scope].packages = common_1.alphabetize(packageMap.scopes[scope].packages);
            continue outer;
        }
        delete packageMap.scopes[scope];
    }
}
exports.clean = clean;
//# sourceMappingURL=utils.js.map