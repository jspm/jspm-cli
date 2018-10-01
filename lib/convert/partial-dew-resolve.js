"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
function relativeResolve(require, filePath, pkgBasePath, files, folderMains) {
    const fileDir = path.resolve(filePath, '..');
    if (require === '.')
        require += '/';
    const internalResolution = require.startsWith('./') || require.startsWith('../');
    if (!internalResolution)
        return require.endsWith('/') ? require.substr(0, require.length - 1) : require;
    // jspm-resolve internal resolution handling
    const resolved = path.resolve(fileDir, require);
    if (!resolved.startsWith(pkgBasePath) || resolved.length !== pkgBasePath.length && resolved[pkgBasePath.length] !== path.sep)
        return require;
    // attempt to file resolve resolved
    let pkgPath = resolved.substr(pkgBasePath.length + 1).replace(/\\/g, '/');
    const resolvedPkgPath = resolveFile(pkgPath, files) || resolveDir(pkgPath, files, folderMains);
    if (!resolvedPkgPath)
        return require;
    let relPath = path.relative(fileDir, path.resolve(pkgBasePath, resolvedPkgPath)).replace(/\\/g, '/');
    if (relPath === '')
        relPath = './' + resolvedPkgPath.substr(resolvedPkgPath.lastIndexOf('/') + 1);
    else if (!relPath.startsWith('../'))
        relPath = './' + relPath;
    return relPath;
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
function toDew(path, checkMain = false) {
    // do not convert node builtins to dew
    if (builtins[path])
        return path;
    if (path === '@empty')
        return '@empty.dew';
    // if its an exact valid package name then it is a main
    if (checkMain) {
        const pkgNameMatch = path.match(validPkgNameRegEx);
        if (pkgNameMatch && pkgNameMatch[0].length === path.length)
            return path + '/index.dew.js';
    }
    if (path.endsWith('.js'))
        return path.substr(0, path.length - 3) + '.dew.js';
    if (path.endsWith('.node'))
        return path;
    return path + '.dew.js';
}
exports.toDew = toDew;
//# sourceMappingURL=partial-dew-resolve.js.map