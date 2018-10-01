"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const common_1 = require("../utils/common");
const resolve_1 = require("@jspm/resolve");
function relativeResolve(require, filePath, pkgBasePath, files, main, folderMains, localMaps, deps, name) {
    const fileDir = path.resolve(filePath, '..');
    if (require === '.')
        require += '/';
    const internalResolution = require.startsWith('./') || require.startsWith('../');
    if (!internalResolution) {
        if (require.startsWith('/') || !getMatch(require, deps) && !resolve_1.builtins[require])
            return null;
        return toDewPlain(require.endsWith('/') ? require.substr(0, require.length - 1) : require);
    }
    // jspm-resolve internal resolution handling
    const resolved = path.resolve(fileDir, require);
    if (!resolved.startsWith(pkgBasePath) || resolved.length !== pkgBasePath.length && resolved[pkgBasePath.length] !== path.sep)
        return toDew(require);
    // attempt to file resolve resolved
    let pkgPath = resolved.substr(pkgBasePath.length + 1).replace(/\\/g, '/');
    if (pkgPath === '')
        pkgPath = main || pkgPath;
    const resolvedPkgPath = resolveFile(pkgPath, files) || resolveDir(pkgPath, files, folderMains);
    // local maps need to be "plain" to support package maps
    if (localMaps[resolvedPkgPath || pkgPath])
        return toDew(name + '/' + (resolvedPkgPath || pkgPath));
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
    if (Object.hasOwnProperty.call(files, name))
        return name;
    if (Object.hasOwnProperty.call(files, name + '.js'))
        return name + '.js';
    if (Object.hasOwnProperty.call(files, name + '.json'))
        return name + '.json';
    if (Object.hasOwnProperty.call(files, name + '.node'))
        return name + '.node';
}
exports.resolveFile = resolveFile;
function resolveDir(name, files, folderMains) {
    if (Object.hasOwnProperty.call(folderMains, name))
        return resolveFile(name + '/' + folderMains[name], files);
}
exports.resolveDir = resolveDir;
function toDewPlain(path) {
    // do not convert node builtins to dew
    if (path === '@empty')
        return '@empty.dew';
    const pkgNameMatch = path.match(common_1.validPkgNameRegEx);
    // if it is a package path, add dew
    if (!pkgNameMatch)
        return toDew(path);
    // if its an exact valid package name then it is a main
    // unless it is a builtin
    if (resolve_1.builtins[path])
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
function pcfgToDeps(pcfg, optional = false) {
    const deps = {};
    if (pcfg.dependencies)
        Object.keys(pcfg.dependencies).forEach(key => deps[key] = true);
    if (pcfg.peerDependencies)
        Object.keys(pcfg.peerDependencies).forEach(key => deps[key] = true);
    if (optional && pcfg.optionalDependencies)
        Object.keys(pcfg.optionalDependencies).forEach(key => deps[key] = true);
    return deps;
}
exports.pcfgToDeps = pcfgToDeps;
function isESM(resolved, deps) {
    return resolved.endsWith('.node') || resolve_1.builtins[resolved] && !(deps && deps[resolved]);
}
exports.isESM = isESM;
function getMatch(path, matchObj) {
    let sepIndex = path.length;
    do {
        const segment = path.slice(0, sepIndex);
        if (segment in matchObj)
            return segment;
    } while ((sepIndex = path.lastIndexOf('/', sepIndex - 1)) !== -1);
}
exports.getMatch = getMatch;
//# sourceMappingURL=dew-resolve.js.map