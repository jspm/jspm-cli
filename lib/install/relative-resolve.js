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
//# sourceMappingURL=relative-resolve.js.map