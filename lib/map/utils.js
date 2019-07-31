"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const common_1 = require("../utils/common");
var common_2 = require("./common");
exports.parseImportMap = common_2.parseImportMap;
exports.resolveImportMap = common_2.resolveImportMap;
exports.resolveIfNotPlainOrUrl = common_2.resolveIfNotPlainOrUrl;
function getPackageBase(url, jspmProjectPath) {
    const resolvedPath = url.substr(common_1.isWindows ? 8 : 7).replace(/\//g, path.sep);
    if (!resolvedPath.startsWith(jspmProjectPath + path.sep))
        return;
    if (!resolvedPath.slice(jspmProjectPath.length).startsWith(path.sep + 'jspm_packages' + path.sep))
        return jspmProjectPath;
    const pkg = resolvedPath.slice(resolvedPath.indexOf(path.sep, jspmProjectPath.length + 16) + 1);
    if (pkg[0] === '@')
        return pkg.substr(0, pkg.indexOf(path.sep, pkg.indexOf(path.sep) + 1));
    else
        return pkg.substr(0, pkg.indexOf(path.sep));
}
exports.getPackageBase = getPackageBase;
function extend(importMap, extendMap) {
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
exports.extend = extend;
function getScopeMatch(path, matchObj) {
    let sepIndex = path.length;
    do {
        const segment = path.slice(0, sepIndex + 1);
        if (segment in matchObj) {
            return segment;
        }
    } while ((sepIndex = path.lastIndexOf('/', sepIndex - 1)) !== -1);
}
exports.getScopeMatch = getScopeMatch;
function getImportMatch(path, matchObj) {
    if (path in matchObj)
        return path;
    let sepIndex = path.length;
    do {
        const segment = path.slice(0, sepIndex + 1);
        if (segment in matchObj)
            return segment;
    } while ((sepIndex = path.lastIndexOf('/', sepIndex - 1)) !== -1);
}
exports.getImportMatch = getImportMatch;
function rebaseMap(map, fromPath, toPath, absolute = false) {
    const prefix = absolute ? '/' : './';
    fromPath = fromPath.replace(/\\/g, '/');
    toPath = toPath.replace(/\\/g, '/');
    const newMap = {};
    if (map.imports) {
        const imports = Object.create(null);
        newMap.imports = imports;
        for (const pkgName of Object.keys(map.imports)) {
            const pkg = map.imports[pkgName];
            let rebased = common_1.isURL(pkg, true) ? pkg : path.relative(toPath, path.resolve(fromPath, pkg)).replace(/\\/g, '/');
            if (pkg.endsWith('/'))
                rebased += '/';
            if (!rebased.startsWith('../'))
                rebased = prefix + rebased;
            else if (absolute)
                throw new common_1.JspmUserError(`Unable to reference mapping ${pkgName} at ${rebased}. The base for the import map must a higher path than its mappings.`);
            imports[pkgName] = rebased;
        }
    }
    if (map.scopes) {
        const scopes = Object.create(null);
        newMap.scopes = scopes;
        for (const scopeName of Object.keys(map.scopes)) {
            const scope = map.scopes[scopeName];
            const newScope = Object.create(null);
            let rebasedScope = scopeName;
            if (!common_1.isURL(scopeName, true)) {
                const resolvedScope = path.resolve(fromPath, scopeName);
                rebasedScope = path.relative(toPath, resolvedScope).replace(/\\/g, '/') + '/';
                if (absolute) {
                    if (rebasedScope.startsWith('../'))
                        throw new common_1.JspmUserError(`Unable to reference scope ${scopeName} at ${resolvedScope}. The base for the import map must a higher path than its mappings.`);
                    rebasedScope = prefix + rebasedScope;
                }
            }
            for (const pkgName of Object.keys(scope)) {
                const pkg = scope[pkgName];
                let rebased = common_1.isURL(pkg, true) ? pkg : path.relative(toPath, path.resolve(fromPath, pkg)).replace(/\\/g, '/');
                if (pkg.endsWith('/'))
                    rebased += '/';
                if (!rebased.startsWith('../'))
                    rebased = prefix + rebased;
                else if (absolute)
                    throw new common_1.JspmUserError(`Unable to reference mapping ${pkgName} at ${rebased} in scope ${scopeName}. The base for the import map must a higher path than its mappings.`);
                newScope[pkgName] = rebased;
            }
            newMap.scopes[rebasedScope] = newScope;
        }
    }
    return newMap;
}
exports.rebaseMap = rebaseMap;
function flattenScopes(importMap) {
    if (!importMap.scopes)
        return;
    for (const scope of Object.keys(importMap.scopes)) {
        const imports = importMap.scopes[scope];
        for (const pkgName of Object.keys(imports)) {
            const existing = importMap.imports[pkgName];
            const newTarget = imports[pkgName];
            if (existing && existing !== newTarget)
                throw new common_1.JspmUserError(`Cannot flatten scopes due to conflict for ${common_1.bold(pkgName)} between ${existing} and ${newTarget}.`);
            importMap.imports[pkgName] = newTarget;
        }
    }
    delete importMap.scopes;
}
exports.flattenScopes = flattenScopes;
// any plain maps in scopes which match base maps can be removed
// then removes empty properties and alphabetizes
function clean(importMap) {
    if (importMap.scopes) {
        for (const scope of Object.keys(importMap.scopes)) {
            const imports = importMap.scopes[scope];
            for (const pkgName of Object.keys(imports)) {
                // renormalization in check?
                if (importMap.imports[pkgName] === imports[pkgName])
                    delete imports[pkgName];
            }
        }
        importMap.scopes = common_1.alphabetize(importMap.scopes);
        outer: for (const scope of Object.keys(importMap.scopes)) {
            for (let _p in importMap.scopes[scope]) {
                importMap.scopes[scope] = common_1.alphabetize(importMap.scopes[scope]);
                continue outer;
            }
            delete importMap.scopes[scope];
        }
    }
    if (importMap.imports) {
        importMap.imports = common_1.alphabetize(importMap.imports);
    }
    if (!common_1.hasProperties(importMap.imports))
        delete importMap.imports;
    if (!common_1.hasProperties(importMap.scopes))
        delete importMap.scopes;
}
exports.clean = clean;
function validateImportMap(fileName, json) {
    for (const key of Object.keys(json)) {
        if (key !== 'scopes' && key !== 'imports')
            throw new common_1.JspmUserError(`${fileName} is not a valid import map as it contains the invalid key ${common_1.bold('"' + key + '"')}.`);
    }
}
exports.validateImportMap = validateImportMap;
//# sourceMappingURL=utils.js.map