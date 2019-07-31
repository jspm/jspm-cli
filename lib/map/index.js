"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const package_1 = require("../install/package");
const common_1 = require("../utils/common");
const utils_1 = require("./utils");
const { builtins, applyMap } = require('@jspm/resolve');
const url_1 = require("url");
const common_2 = require("./common");
const fs = require("graceful-fs");
const esm_lexer_1 = require("./esm-lexer");
const jspmBuiltins = Object.assign({ '@empty.dew': true }, builtins);
const nodeCoreBrowserUnimplemented = {
    child_process: true, cluster: true, dgram: true, dns: true, fs: true, module: true, net: true, readline: true, repl: true, tls: true
};
;
;
class Mapper {
    constructor(project, env = { browser: true }) {
        if (!env.node && env.browser !== false)
            env.browser = true;
        this.project = project;
        this.dependencies = {};
        for (const dep of Object.keys(project.config.jspm.installed.resolve)) {
            const entry = project.config.pjson.dependencies[dep];
            if (entry && entry.type === package_1.DepType.dev && (env.production || env.dev === false))
                continue;
            this.dependencies[dep] = package_1.serializePackageName(project.config.jspm.installed.resolve[dep]);
        }
        if (this.dependencies['@jspm/core'])
            this._nodeBuiltinsPkg = './jspm_packages/' + this.dependencies['@jspm/core'].replace(':', '/') + '/nodelibs';
        this.env = env;
        this.cachedPackagePaths = {};
    }
    get nodeBuiltinsPkg() {
        if (this._nodeBuiltinsPkg)
            return this._nodeBuiltinsPkg;
        throw new Error('Unable to locate @jspm/core dependency. Make sure this is properly installed.');
    }
    async createMapAll() {
        const imports = {};
        const scopes = {};
        const packageMap = {
            imports,
            scopes
        };
        const populationPromises = [];
        for (const depName of Object.keys(this.dependencies)) {
            if (depName === '@jspm/core')
                continue;
            populationPromises.push(this.populatePackage(depName, this.dependencies[depName], undefined, packageMap));
        }
        for (const name of Object.keys(jspmBuiltins)) {
            if (name in imports)
                continue;
            imports[name] = this.nodeBuiltinsPkg + '/' + (nodeCoreBrowserUnimplemented[name] ? '@empty' : name) + '.js';
        }
        await Promise.all(populationPromises);
        utils_1.clean(packageMap);
        return packageMap;
    }
    async populatePackage(depName, pkgName, scopeParent, packageMap, seen = {}) {
        // no need to duplicate base-level dependencies
        if (scopeParent && this.dependencies[depName] === pkgName)
            return;
        const pkgPath = `jspm_packages/${pkgName.replace(':', '/')}`;
        const packages = scopeParent ? (packageMap.scopes[scopeParent] = (packageMap.scopes[scopeParent] || {})) : packageMap.imports;
        const curPkg = packages[depName + '/'] = './' + pkgPath + '/';
        const pkg = this.project.config.jspm.installed.dependencies[pkgName];
        const pathsPromise = (async () => {
            const { name, main, paths, map } = await this.getPackageConfig(pkgName);
            if (main)
                packages[depName] = curPkg + main;
            for (const subpath of Object.keys(paths))
                packages[depName + '/' + subpath] = './' + pkgPath + '/' + paths[subpath];
            if (seen[pkgName + '|map'])
                return;
            seen[pkgName + '|map'] = true;
            const scopedPackages = (packageMap.scopes[pkgPath + '/'] = (packageMap.scopes[pkgPath + '/'] || {}));
            // scopedPackages[name + '/']
            for (const subpath of Object.keys(paths))
                scopedPackages[name + '/' + subpath] = './' + name + '/' + paths[subpath];
            for (const target of Object.keys(map)) {
                let mapped = map[target];
                if (mapped.startsWith('./')) {
                    mapped = pkgPath + mapped.substr(1);
                }
                else {
                    const depMapped = applyMap(mapped, pkg.resolve) || applyMap(mapped, this.dependencies);
                    if (depMapped) {
                        mapped = 'jspm_packages/' + depMapped.replace(':', '/');
                    }
                    else if (jspmBuiltins[mapped]) {
                        mapped = `${this.nodeBuiltinsPkg}/${mapped}.js`;
                    }
                }
                scopedPackages[target] = './' + mapped;
            }
        })();
        if (seen[pkgName])
            return;
        seen[pkgName] = true;
        const populationPromises = [pathsPromise];
        for (const depName of Object.keys(pkg.resolve)) {
            populationPromises.push(this.populatePackage(depName, package_1.serializePackageName(pkg.resolve[depName]), pkgPath + '/', packageMap, seen));
        }
        await Promise.all(populationPromises);
    }
    async getPackageConfig(pkgName) {
        const cached = this.cachedPackagePaths[pkgName];
        if (cached)
            return await cached;
        return await (this.cachedPackagePaths[pkgName] = (async () => {
            const pjson = await common_1.readJSON(`${this.project.projectPath}/jspm_packages/${pkgName.replace(':', '/')}/package.json`);
            if (!pjson)
                throw new common_1.JspmUserError(`Package ${common_1.highlight(pkgName)} is not installed correctly. Run jspm install.`);
            const name = typeof pjson.name === 'string' ? pjson.name : undefined;
            let main = typeof pjson.main === 'string' ? pjson.main : undefined;
            const paths = {};
            const map = {};
            // const deps = {};
            if (pjson.map) {
                if (name)
                    map[name + '/'] = './';
                if (main) {
                    const mapped = applyMap('./' + main, pjson.map, this.env);
                    if (mapped)
                        main = mapped === '@empty' ? `${this.nodeBuiltinsPkg}/@empty.js` : mapped;
                    if (name)
                        map[name] = './' + main;
                }
                for (const target of Object.keys(pjson.map)) {
                    if (target.startsWith('./')) {
                        const mapped = applyMap(target, pjson.map, this.env);
                        if (mapped) {
                            paths[target.substr(2)] = mapped === '@empty' ? `${this.nodeBuiltinsPkg}/@empty.js` : mapped;
                            if (name)
                                map[name + '/' + target.substr(2)] = mapped === '@empty' ? `${this.nodeBuiltinsPkg}/@empty.js` : './' + mapped;
                        }
                    }
                    else {
                        const mapped = applyMap(target, pjson.map, this.env);
                        if (mapped)
                            map[target] = mapped;
                    }
                }
            }
            return { name, main, paths, map };
        })());
    }
}
// jspmPackagesUrl must be an absolute URL
function cdnReplace(path) {
    return path.replace(/jspm_packages\/(\w+)\//, 'jspm_packages/$1:');
}
function renormalizeMap(map, jspmPackagesURL, cdn) {
    // TODO: map base support here
    if (jspmPackagesURL.endsWith('/'))
        jspmPackagesURL = jspmPackagesURL.substr(0, jspmPackagesURL.length - 1);
    const newMap = {};
    if (map.imports) {
        const packages = Object.create(null);
        newMap.imports = packages;
        for (const pkgName of Object.keys(map.imports)) {
            const pkg = map.imports[pkgName];
            newMap.imports[pkgName] = (cdn ? cdnReplace(pkg) : pkg).replace(/^(\.\/)+jspm_packages/, jspmPackagesURL);
        }
    }
    if (map.scopes) {
        const scopes = Object.create(null);
        newMap.scopes = scopes;
        for (const scopeName of Object.keys(map.scopes)) {
            const scope = map.scopes[scopeName];
            const newScope = Object.create(null);
            let scopeRegistry = scopeName.substr(14);
            scopeRegistry = scopeRegistry.substr(0, scopeRegistry.indexOf('/'));
            for (const pkgName of Object.keys(scope)) {
                const pkg = scope[pkgName];
                newScope[pkgName] = (cdn ? cdnReplace(pkg) : pkg).replace(/^(\.\/)+jspm_packages/, jspmPackagesURL);
            }
            newMap.scopes[jspmPackagesURL + (cdn ? cdnReplace(scopeName) : scopeName).substr(13)] = newScope;
        }
    }
    return newMap;
}
exports.renormalizeMap = renormalizeMap;
async function map(project, env) {
    const mapper = new Mapper(project, env);
    return await mapper.createMapAll();
}
exports.map = map;
class MapResolver {
    constructor(project, map) {
        let baseDir = project.projectPath;
        this.project = project;
        this.imports = map.imports;
        this.scopes = Object.create(null);
        if (baseDir[baseDir.length - 1] !== '/')
            baseDir += '/';
        const baseURL = new url_1.URL('file:' + baseDir).href;
        if (map.scopes !== undefined) {
            for (const scopeName of Object.keys(map.scopes)) {
                let resolvedScopeName = common_2.resolveIfNotPlainOrUrl(scopeName, baseURL) || scopeName.indexOf(':') !== -1 && scopeName || common_2.resolveIfNotPlainOrUrl('./' + scopeName, baseURL);
                if (resolvedScopeName[resolvedScopeName.length - 1] !== '/')
                    resolvedScopeName += '/';
                this.scopes[resolvedScopeName] = {
                    originalName: scopeName,
                    imports: map.scopes[scopeName] || {}
                };
            }
        }
        this.trace = Object.create(null);
        this.usedMap = { imports: {}, scopes: {} };
        const parsed = utils_1.parseImportMap(map, baseURL);
        this.mapResolve = (specifier, parent) => utils_1.resolveImportMap(specifier, parent, parsed);
    }
    async resolveAll(id, parentUrl, excludeDeps = false, seen) {
        let toplevel = false;
        if (seen === undefined) {
            toplevel = true;
            seen = Object.create(null);
        }
        let resolved;
        try {
            resolved = this.resolve(id, parentUrl, toplevel);
        }
        catch (e) {
            if (excludeDeps && (common_1.isURL(id) || !id.startsWith('./') && !id.startsWith('../')))
                return '@external';
            throw e;
        }
        if (excludeDeps && !toplevel) {
            const parentBoundary = utils_1.getPackageBase(parentUrl, this.project.projectPath);
            const resolvedBoundary = utils_1.getPackageBase(resolved, this.project.projectPath);
            if (!resolvedBoundary || resolvedBoundary !== parentBoundary)
                return resolved;
        }
        if (seen[resolved])
            return resolved;
        seen[resolved] = true;
        let deps;
        try {
            deps = await this.resolveDeps(resolved);
        }
        catch (err) {
            throw new common_1.JspmUserError(`Loading ${common_1.highlight(id)} from ${common_1.bold(decodeURI(parentUrl.substr(7 + +common_1.isWindows).replace(/\//g, path.sep)))}`, err.code, err);
        }
        const resolvedDeps = await Promise.all(deps.map(dep => this.resolveAll(dep, resolved, excludeDeps, seen)));
        if (deps.length) {
            const trace = this.trace[resolved] = Object.create(null);
            for (let i = 0; i < deps.length; i++)
                trace[deps[i]] = resolvedDeps[i];
        }
        return resolved;
    }
    resolve(id, parentUrl, toplevel = false) {
        let resolved = common_2.resolveIfNotPlainOrUrl(id, parentUrl);
        if (resolved)
            return resolved;
        resolved = this.mapResolve(id, parentUrl);
        if (resolved) {
            const scopeMatch = utils_1.getScopeMatch(parentUrl, this.scopes);
            if (scopeMatch) {
                const match = utils_1.getImportMatch(id, this.scopes[scopeMatch].imports);
                if (match) {
                    const scopeName = this.scopes[scopeMatch].originalName;
                    const scope = this.usedMap.scopes[scopeName] = this.usedMap.scopes[scopeName] || {};
                    scope[match] = this.scopes[scopeMatch].imports[match];
                    return resolved;
                }
            }
            const match = utils_1.getImportMatch(id, this.imports);
            if (match) {
                this.usedMap.imports[match] = this.imports[match];
                return resolved;
            }
            throw new Error('Internal error');
        }
        if (toplevel)
            return common_2.resolveIfNotPlainOrUrl('./' + id, parentUrl);
        throw new Error(`No resolution for ${id} in ${parentUrl}`);
    }
    async resolveDeps(url) {
        if (!url.startsWith('file:'))
            return [];
        const filePath = decodeURI(url.substr(7 + +common_1.isWindows)).replace(/\//g, path.sep);
        let imports, err, source;
        source = await new Promise((resolve, reject) => fs.readFile(filePath, (err, source) => err ? reject(err) : resolve(source.toString())));
        [imports, , err] = esm_lexer_1.analyzeModuleSyntax(source);
        if (err)
            throw new common_1.JspmUserError(`Syntax error analyzing ${common_1.bold(filePath)}`, 'ANALYSIS_ERROR');
        const deps = [];
        const stringRegEx = /^\s*('[^"'\\]+'|"[^'"\\]+")\s*$/g;
        for (const { s, e, d } of imports) {
            if (d === -2)
                continue;
            // dynamic import
            if (d !== -1) {
                let importExpression = source.slice(e, d);
                // we don't yet support partial dynamic import traces
                if (importExpression.match(stringRegEx)) {
                    deps.push(JSON.parse('"' + importExpression.slice(1, -1) + '"'));
                }
            }
            else {
                deps.push(source.slice(s, e));
            }
        }
        return deps;
    }
}
async function filterMap(project, map, modules, flatScope = false) {
    const mapResolve = new MapResolver(project, map);
    let baseURL = new url_1.URL('file:' + project.projectPath).href;
    if (baseURL[baseURL.length - 1] !== '/')
        baseURL += '/';
    for (const module of modules)
        await mapResolve.resolveAll(module, baseURL);
    utils_1.clean(mapResolve.usedMap);
    if (flatScope)
        utils_1.flattenScopes(mapResolve.usedMap);
    return mapResolve.usedMap;
}
exports.filterMap = filterMap;
async function trace(project, map, baseDir, modules, excludeDeps = false) {
    const mapResolve = new MapResolver(project, map);
    let baseURL = new url_1.URL('file:' + baseDir).href;
    if (baseURL[baseURL.length - 1] !== '/')
        baseURL += '/';
    for (const module of modules)
        await mapResolve.resolveAll(module, baseURL, excludeDeps);
    return mapResolve.trace;
}
exports.trace = trace;
;
//# sourceMappingURL=index.js.map