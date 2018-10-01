"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const workerFarm = require("worker-farm");
const package_1 = require("../install/package");
const common_1 = require("../utils/common");
const fs = require("graceful-fs");
const path = require("path");
const config_file_1 = require("../config/config-file");
const relative_resolve_1 = require("./relative-resolve");
const nodeBuiltinsTarget = new package_1.PackageTarget('npm', '@jspm/node-builtins', '^0.1.0');
const convertWorker = workerFarm({
    maxConcurrentWorkers: require('os').cpus().length / 2,
    maxConcurrentCallsPerWorker: 2,
    autoStart: true
}, require.resolve('./convertCJSWorker'));
/*
 * Internal map dew handling
 *
 * - We add custom condition mains as "map": { "./index.dew.js" condition maps }.
 *   That is, we effectively copy the "main" map entry (copy map[main]) to map[./index.dew.js] with targets rewritten for dew)
 * - Internal maps do the same thing - "map": { "./x": "./y" } -> "map": { "./x.dew.js" -> "./y.dew.js" }
 * - We still keep the original map, so the folder form still applies
 * - External maps also dew - "map": { "x": "y/z" } -> "map": { "x": "y/z", "x/index.dew.js": "y/z.dew.js" }
 *   plus handling for subpath - "map": { "x/y": "z" } -> "map": { "x/y": "./z", "x/y.dew.js": "./z.dew.js" }
 */
function convertCJSConfig(pcfg) {
    let newMap;
    if (pcfg.mode === 'esm')
        return;
    if (!pcfg.peerDependencies)
        pcfg.peerDependencies = {};
    pcfg.peerDependencies['jspm-node-builtins'] = nodeBuiltinsTarget;
    if (pcfg.main) {
        if (pcfg.map && pcfg.map['./' + pcfg.main]) {
            if (!newMap)
                newMap = {};
            newMap['./' + pcfg.main] = pcfg.map['./' + pcfg.main];
            newMap['./' + relative_resolve_1.toDew(pcfg.main, false)] = newMap['./index.dew.js'] = convertMappingToDew(pcfg.map['./' + pcfg.main], false);
        }
    }
    else {
        pcfg.main = 'index.js';
    }
    if (pcfg.map) {
        for (const match of Object.keys(pcfg.map)) {
            if (!newMap)
                newMap = {};
            const mapping = pcfg.map[match];
            newMap[match] = mapping;
            const isRel = match.startsWith('./');
            newMap[relative_resolve_1.toDew(match, !isRel)] = convertMappingToDew(mapping, !isRel);
        }
    }
    if (pcfg.bin) {
        let newBin;
        for (const bin of Object.keys(pcfg.bin)) {
            if (!newBin)
                newBin = {};
            const target = pcfg.bin[bin];
            newBin[bin] = relative_resolve_1.toDew(target, false);
        }
        if (newBin)
            pcfg.bin = newBin;
    }
    if (newMap)
        pcfg.map = newMap;
}
exports.convertCJSConfig = convertCJSConfig;
function convertMappingToDew(mapping, checkMain) {
    if (typeof mapping === 'string')
        return relative_resolve_1.toDew(mapping, checkMain);
    const newMap = {};
    for (const condition of Object.keys(mapping))
        newMap[condition] = convertMappingToDew(mapping[condition], checkMain);
    return newMap;
}
/*
 * Conversion process:
 * -  Internal resolutions are resolved, with toDew applied.
 *
 *    External resolutions get toDew applied, with main adding for package matches
 *    require('x') -> require('x/index.dew.js');
 *    require('x/y') -> require('x/y.dew.js')
 *
 *    (except for builtins which are ESM)
 *
 * -  All .js files get a .dew and the .js version becomes the ESM wrapper
 *
 * -  All .json files get a ".dew.json", and a ".dew.js" if there is no other resolution at the extensionless
 *    No entry is created for ".json" files though because ESM cannot import JSON, and the JSON must remain transparent.
 *
 * -  The main entry point of the package is reflected through pkg/index.dew.js
 *    This handles all forms of main entry point from directory index to JSON files. It is always this file.
 *
 * -  All extension and index files get a corresponding dew made
 *    x.json -> x.dew.json + x.dew.js
 *    x/index.js -> x.dew.js + x/index.dew.js
 *    x.json + x.js -> x.js wins the x.dew.js, x.dew.json still exists, similarly for index lookups winning
 *    dew aliases are simply: export { dew } from './actual.dew.js';
 *
 * -  We skip files that are in subfolders of "mode": "esm" (up to next cancelling subfolder), or files that are in the skipESMConversion array
 *    Such files will simply break if loaded as entries or dew requires. There might possibly be a way to skip the ".js" entry, but keep the ".dew". Perhaps this goes with entry point lock downs -> "sealed": true kind of thing.
 */
async function convertCJSPackage(log, dir, pkgName, pcfg) {
    log.debug(`Converting CJS package ${pkgName}`);
    if (pcfg.skipESMConversion === true)
        return;
    let filePool = await listAllFiles(dir);
    const convertFiles = {};
    for (const file of filePool)
        convertFiles[file] = false;
    // determine which files match the cjs conversion boundary
    // since we are loading package.json files, at the same time record folder mains
    const folderMains = {};
    for (const pjsonFile of filePool.filter(file => file.endsWith('/package.json')).sort((a, b) => a.split('/').length < b.split('/').length ? 1 : -1)) {
        const boundary = pjsonFile.substr(0, pjsonFile.lastIndexOf('/'));
        const pjson = await new Promise((resolve, reject) => fs.readFile(path.resolve(dir, pjsonFile), (err, source) => err ? reject(err) : resolve(source.toString())));
        try {
            const parsed = JSON.parse(pjson);
            if (typeof parsed.main === 'string')
                folderMains[boundary] = parsed.main.startsWith('./') ? parsed.main.substr(2) : parsed.main;
            var mode = parsed.mode;
        }
        catch (e) {
            continue;
        }
        // esm mode boundary -> filter out from the file pool
        if (mode === 'esm')
            filePool = filePool.filter(file => !file.startsWith(boundary) || file[boundary.length] !== '/');
        else
            filePool = filePool.filter(file => {
                const filtered = file.startsWith(boundary) && file[boundary.length] === '/';
                if (filtered)
                    convertFiles[file] = true;
                return !filtered;
            });
    }
    if (pcfg.mode !== 'esm')
        for (const file of filePool)
            convertFiles[file] = true;
    // populate index.js, index.json as folder mains
    for (const file of Object.keys(convertFiles)) {
        if (file.endsWith('/index.js') || file.endsWith('/index.json') || file.endsWith('/index.node')) {
            const folderName = file.substr(0, file.lastIndexOf('/'));
            if (!folderMains[folderName])
                folderMains[folderName] = file.substr(folderName.length + 1);
        }
    }
    // dont convert the skipESMConversion files
    const skipFiles = pcfg.skipESMConversion;
    if (skipFiles)
        Object.keys(convertFiles).forEach(file => {
            if (skipFiles.some(skipFile => file.startsWith(skipFile) && (file.length === skipFile.length || file[skipFile.length] === '/' || file[skipFile.length - 1] === '/')))
                convertFiles[file] = false;
        });
    // we are now left with just those files that need .dew.js conversion
    // the worker will also write over the original file with the ESM wrapper
    log.debug(`Sending conversion manifest to process worker for ${pkgName}...`);
    await new Promise((resolve, reject) => {
        convertWorker(dir, convertFiles, folderMains, pcfg.namedExports, (err, convertedFiles) => {
            if (err)
                reject(new common_1.JspmUserError(`Error converting ${pkgName}${err.filename ? ` file ${err.filename}` : ''}. This package may not load correctly in jspm. Please post a bug!\n${err.stack || err.toString()}`, 'ESM_CONVERSION_ERROR'));
            else
                resolve(convertedFiles);
        });
    });
    /*
     * Dew Aliasing cases:
     * These are for require('x/y') cases that are resolved to x/y.dew.js that in turn needs to alias the exact resolution
     *
     * - x.dew.js -> x.json.dew.js if x.js or x doesn't already have a dew
     * - for each folder with a package.json, where the folder.js does not exists, we determine if that folder has a main
     *   and if so, we create the folder.dew.js file
     * - index.dew.js is created pointing to the file corresponding to the actual main
     *
     * All aliases are simply of the form:
     *   export { dew } from './alias.of.dew.js'
     * since they are aliases of existing dew files only
     *
     * Note that we don't need to create a x.js.dew.js file for each extension and non-extension variation
     * because of the fact that we automatically assume the js extension for requires from other packages
     * this has the potential to conflict x and x.js, but the cases is deemed rare enough to be worth the simplification
     *
     * We don't worry about aliases of ESM imports, because:
     * - JSON imports are not supported from ESM
     * - the file.js file is the ESM wrapper
     * - other default behaviours are not provided by ESM
     * - map is supported fine with just the above
     */
    const aliasPromises = [];
    function writeDewAlias(filePath, dewName) {
        aliasPromises.push(new Promise((resolve, reject) => fs.writeFile(path.resolve(dir, filePath), `export { dew } from './${dewName}';\n`, err => err ? reject(err) : resolve())).catch(() => { }));
    }
    function writeNodeAlias(filePath, nodeName) {
        aliasPromises.push(new Promise((resolve, reject) => fs.writeFile(path.resolve(dir, filePath), `import m from './${nodeName}';\nexport function dew () { return m; }`, err => err ? reject(err) : resolve())).catch(() => { }));
    }
    // json dew aliases (.dew.js -> .json.dew.js)
    for (const file of Object.keys(convertFiles).filter(file => file.endsWith('.json') && convertFiles[file] === true)) {
        if (!(file.substr(0, file.length - 5) in convertFiles) && !(file.substr(0, file.length - 5) + '.js' in convertFiles))
            writeDewAlias(file.substr(0, file.length - 5) + '.dew.js', file.slice(file.lastIndexOf('/') + 1) + '.dew.js');
    }
    // folder mains (.dew.js -> folder/index.dew.js)
    for (const folderPath of Object.keys(folderMains)) {
        const resolved = relative_resolve_1.resolveFile(folderPath, convertFiles) || relative_resolve_1.resolveDir(folderPath, convertFiles, folderMains);
        // folder mains can be overridden by files of the same name
        if (!resolved || resolved[folderPath.length] !== '/')
            continue;
        if (resolved.endsWith('.node'))
            writeNodeAlias(folderPath + '.dew.js', resolved.substr(folderPath.lastIndexOf('/') + 1));
        else if (convertFiles[resolved])
            writeDewAlias(folderPath + '.dew.js', relative_resolve_1.toDew(resolved.substr(folderPath.lastIndexOf('/') + 1), false));
    }
    // main main
    if (pcfg.main && pcfg.main !== 'index' && pcfg.main !== 'index.js' && pcfg.main !== 'index.json') {
        const resolved = relative_resolve_1.resolveFile(pcfg.main, convertFiles) || relative_resolve_1.resolveDir(pcfg.main, convertFiles, folderMains);
        if (resolved.endsWith('.node'))
            writeNodeAlias('index.dew.js', resolved);
        else if (convertFiles[resolved])
            writeDewAlias('index.dew.js', relative_resolve_1.toDew(resolved, false));
    }
    else {
        // index.js and index.json both already aliased to index.dew.js
        if ('index.node' in convertFiles && !('index.js' in convertFiles) && !('index.json' in convertFiles)) {
            writeNodeAlias('index.dew.js', 'index.node');
        }
    }
    /*
     * Config resolution
     * As well as setting up aliases, we must also now update the config main and map to reference exact files
     * This is because "esm" is designed to skip automatic extension adding and directory indices
     * In addition, a ".json" main needs a special wrapper
     */
    let changed = false;
    if (pcfg.main) {
        // TODO add support for maps
        // issue is that folder and file map cases need to be separated, but completely doable by just outputting two maps per original map
        if (!(pcfg.map && pcfg.map[pcfg.main])) {
            let resolved = relative_resolve_1.resolveFile(pcfg.main, convertFiles);
            // JSON mains
            if (resolved) {
                if (resolved.endsWith('.json'))
                    resolved += '.js';
                if (resolved !== pcfg.main) {
                    pcfg.main = resolved;
                    changed = true;
                }
            }
        }
    }
    if (changed) {
        let { json: pjson, style } = await config_file_1.readJSONStyled(path.resolve(dir, 'package.json'));
        if (!pjson)
            pjson = {};
        await config_file_1.writeJSONStyled(path.resolve(dir, 'package.json'), Object.assign(pjson, package_1.serializePackageConfig(pcfg)), style || config_file_1.defaultStyle);
    }
    log.debug(`Completed dew conversion, writing dew aliases for ${pkgName}...`);
    await Promise.all(aliasPromises);
}
exports.convertCJSPackage = convertCJSPackage;
function listAllFiles(dir) {
    dir = path.resolve(dir);
    const files = [];
    return new Promise((resolve, reject) => {
        let cnt = 0;
        visitFileOrDir(dir);
        function visitFileOrDir(fileOrDir) {
            cnt++;
            fileOrDir = path.resolve(fileOrDir);
            fs.readdir(fileOrDir, (err, paths) => {
                if (err) {
                    if (err.code === 'ENOTDIR') {
                        files.push(path.relative(dir, fileOrDir).replace(/\\/g, '/'));
                        if (--cnt === 0)
                            resolve(files);
                    }
                    else {
                        reject(err);
                    }
                }
                else {
                    cnt--;
                    if (paths.length === 0 && cnt === 0)
                        resolve(files);
                    paths.forEach(fileOrDirPath => visitFileOrDir(path.resolve(fileOrDir, fileOrDirPath)));
                }
            });
        }
    });
}
exports.listAllFiles = listAllFiles;
//# sourceMappingURL=convertCJSPackage.js.map