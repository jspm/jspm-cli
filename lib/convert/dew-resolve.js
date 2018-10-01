"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const common_1 = require("../utils/common");
const jspm_resolve_1 = require("jspm-resolve");
function relativeResolve(require, filePath, pkgBasePath, files, folderMains, deps) {
    const fileDir = path.resolve(filePath, '..');
    if (require === '.')
        require += '/';
    const internalResolution = require.startsWith('./') || require.startsWith('../');
    if (!internalResolution)
        return toDewPlain(require.endsWith('/') ? require.substr(0, require.length - 1) : require, deps);
    // jspm-resolve internal resolution handling
    const resolved = path.resolve(fileDir, require);
    if (!resolved.startsWith(pkgBasePath) || resolved.length !== pkgBasePath.length && resolved[pkgBasePath.length] !== path.sep)
        return toDew(require);
    // attempt to file resolve resolved
    let pkgPath = resolved.substr(pkgBasePath.length + 1).replace(/\\/g, '/');
    const resolvedPkgPath = resolveFile(pkgPath, files) || resolveDir(pkgPath, files, folderMains);
    if (!resolvedPkgPath)
        return toDew(require);
    let relPath = path.relative(fileDir, path.resolve(pkgBasePath, resolvedPkgPath)).replace(/\\/g, '/');
    if (relPath === '')
        relPath = './' + resolvedPkgPath.substr(resolvedPkgPath.lastIndexOf('/') + 1);
    else if (!relPath.startsWith('../'))
        relPath = './' + relPath;
    return toDew(relPath);
}
exports.relativeResolve = relativeResolve;
function resolveFile(name, files) {
    if (name in files)
        return name;
    if (name + '.js' in files)
        return name + '.js';
    if (name + '.json' in files)
        return name + '.json';
    if (name + '.node' in files)
        return name + '.node';
}
exports.resolveFile = resolveFile;
function resolveDir(name, files, folderMains) {
    if (name in folderMains)
        return resolveFile(name + '/' + folderMains[name], files);
}
exports.resolveDir = resolveDir;
function toDewPlain(path, deps) {
    // do not convert node builtins to dew
    if (path === '@empty')
        return '@empty.dew';
    const pkgNameMatch = path.match(common_1.validPkgNameRegEx);
    // if it is a package path, add dew
    if (!pkgNameMatch)
        return toDew(path);
    // if its an exact valid package name then it is a main
    // unless it is a builtin
    if (jspm_resolve_1.builtins[path])
        return path;
    return path + '/index.dew.js';
}
exports.toDewPlain = toDewPlain;
function toDew(path) {
    if (path.endsWith('.js'))
        return path.substr(0, path.length - 3) + '.dew.js';
    if (path.endsWith('.node'))
        return path;
    return path + '.dew.js';
}
exports.toDew = toDew;
function pcfgToDeps(pcfg) {
    const deps = {};
    if (pcfg.dependencies)
        Object.keys(pcfg.dependencies).forEach(key => deps[key] = true);
    if (pcfg.peerDependencies)
        Object.keys(pcfg.peerDependencies).forEach(key => deps[key] = true);
    if (pcfg.map)
        Object.keys(pcfg.map).forEach(key => {
            if (!key.startsWith('./'))
                deps[key] = true;
        });
    return deps;
}
exports.pcfgToDeps = pcfgToDeps;
function isESM(resolved) {
    return resolved.endsWith('.node') || jspm_resolve_1.builtins[resolved];
}
exports.isESM = isESM;
//# sourceMappingURL=dew-resolve.js.map