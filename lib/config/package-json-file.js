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
const config_file_1 = require("./config-file");
const path = require("path");
const package_1 = require("../install/package");
class PackageJson extends config_file_1.default {
    constructor(pjsonPath, project) {
        super(pjsonPath, [
            'name',
            'version',
            'main',
            ['directories', [
                    'src',
                    'dist',
                    'baseURL',
                    'packages'
                ]],
            ['configFiles', [
                    'jspm'
                ]],
            'dependencies',
            'devDependencies',
            'peerDependencies',
            'optionalDependencies',
            ['jspm', [
                    'name',
                    'version',
                    ['directories', [
                            'src',
                            'dist',
                            'baseURL',
                            'packages'
                        ]],
                    ['configFiles', [
                            'jspm'
                        ]],
                    'dependencies',
                    'devDependencies',
                    'peerDependencies',
                    'optionalDependencies',
                    'scripts',
                    ['hooks', [
                            'preinstall',
                            'postinstall'
                        ]],
                    'overrides'
                ]],
            'scripts',
            'mode',
            ['hooks', [
                    'preinstall',
                    'postinstall'
                ]],
            'overrides'
        ]);
        this.project = project;
        this.lock();
        this.read();
        const mode = this.getValue(['mode'], 'string');
        this.esm = mode === 'esm' || this.getValue(['esm']) === true && mode !== 'cjs';
        this.dir = path.dirname(this.fileName);
        this.jspmPrefix = this.has(['jspm']);
        this.jspmAware = this.jspmPrefix || this.has(['registry']);
        // jspm: true is allowed
        try {
            if (this.getValue(['jspm'], 'boolean'))
                this.jspmPrefix = false;
        }
        catch (e) { }
        //if (!this.jspmAware)
        //  this.jspmPrefix = true;
        this.name = this.prefixedGetValue(['name'], 'string') || !this.jspmAware && 'app';
        this.version = this.prefixedGetValue(['version'], 'string');
        this.hooks = this.prefixedGetObject(['hooks'], true) || {};
        this.scripts = this.prefixedGetObject(['scripts'], false) || {};
        this.setBaseURL(this.prefixedGetValue(['directories', 'baseURL'], 'string') || '');
        this.depsPrefixed = this.jspmPrefix;
        if (this.jspmAware &&
            !this.has(['jspm', 'dependencies']) &&
            !this.has(['jspm', 'peerDependencies']) &&
            !this.has(['jspm', 'devDependencies']) &&
            !this.has(['jspm', 'optionalDependencies']) &&
            (this.has(['dependencies']) ||
                this.has(['peerDependencies']) ||
                this.has(['devDependencies']) ||
                this.has(['optionalDependencies'])))
            this.depsPrefixed = false;
        this.dependencies = {};
        const optionalDependencies = this.readDependencies('optionalDependencies');
        if (optionalDependencies)
            Object.keys(optionalDependencies).forEach(dep => {
                this.dependencies[dep] = {
                    type: package_1.DepType.optional,
                    target: package_1.processPackageTarget(dep, optionalDependencies[dep], this.project.defaultRegistry, false)
                };
            });
        const devDependencies = this.readDependencies('devDependencies');
        if (devDependencies)
            Object.keys(devDependencies).forEach(dep => {
                this.dependencies[dep] = {
                    type: package_1.DepType.dev,
                    target: package_1.processPackageTarget(dep, devDependencies[dep], this.project.defaultRegistry, false)
                };
            });
        const dependencies = this.readDependencies('dependencies');
        if (dependencies)
            Object.keys(dependencies).forEach(dep => {
                this.dependencies[dep] = {
                    type: package_1.DepType.primary,
                    target: package_1.processPackageTarget(dep, dependencies[dep], this.project.defaultRegistry, false)
                };
            });
        const peerDependencies = this.readDependencies('peerDependencies');
        if (peerDependencies)
            Object.keys(peerDependencies).forEach(dep => {
                this.dependencies[dep] = {
                    type: package_1.DepType.peer,
                    target: package_1.processPackageTarget(dep, peerDependencies[dep], this.project.defaultRegistry, false)
                };
            });
        const overrides = this.prefixedGetObject(['overrides']);
        this.overrides = [];
        if (overrides) {
            Object.keys(overrides).forEach(name => {
                let target;
                if (name.match(package_1.resourceInstallRegEx)) {
                    target = name;
                }
                else {
                    const pkgName = package_1.parsePackageName(name);
                    target = new package_1.PackageTarget(pkgName.registry, pkgName.name, pkgName.version);
                }
                this.overrides.push({
                    target,
                    override: package_1.processPackageConfig(overrides[name]),
                    fresh: false
                });
            });
        }
    }
    dispose() {
        this.unlock();
    }
    setBaseURL(baseURL) {
        if (baseURL[0] === '/' || baseURL.indexOf('//') !== -1 || baseURL.indexOf('\\\\') !== -1 || baseURL.indexOf(':') !== -1) {
            this.project.log.warn('Server baseURL should be a relative file path. Reverting to current project folder.');
            baseURL = '';
        }
        this.baseURL = path.resolve(this.dir, baseURL);
        let src = this.prefixedGetValue(['directories', 'src']);
        if (src === undefined)
            this.src = path.resolve(this.baseURL, 'src');
        else
            this.src = path.resolve(this.dir, src);
        let dist = this.prefixedGetValue(['directories', 'dist']);
        if (dist === undefined)
            this.dist = path.resolve(this.baseURL, 'dist');
        else
            this.dist = path.resolve(this.dir, dist);
        let packages = this.prefixedGetValue(['directories', 'packages']);
        if (packages === undefined)
            this.packages = path.resolve(this.baseURL, 'jspm_packages');
        else
            this.packages = path.resolve(this.dir, packages);
        let configFile = this.prefixedGetValue(['configFiles', 'jspm']);
        this.configFile = path.resolve(this.dir, configFile || 'jspm.json');
    }
    write() {
        // sync public properties with underlying file representation
        if (this.name) {
            this.prefixedSetValue(['name'], this.name);
        }
        else {
            this.remove(['name']);
            this.remove(['jspm', 'name']);
        }
        if (this.main)
            this.setValue(['main'], this.main);
        if (this.esm) {
            this.remove(['esm']);
            this.setValue(['mode'], 'esm');
        }
        const dependencies = {};
        const peerDependencies = {};
        const devDependencies = {};
        const optionalDependencies = {};
        Object.keys(this.dependencies).forEach(dep => {
            const entry = this.dependencies[dep];
            const defaultRegistry = this.project.defaultRegistry;
            switch (entry.type) {
                case package_1.DepType.primary:
                    dependencies[dep] = package_1.serializePackageTargetCanonical(dep, entry.target, defaultRegistry);
                    break;
                case package_1.DepType.peer:
                    peerDependencies[dep] = package_1.serializePackageTargetCanonical(dep, entry.target, defaultRegistry);
                    break;
                case package_1.DepType.dev:
                    devDependencies[dep] = package_1.serializePackageTargetCanonical(dep, entry.target, defaultRegistry);
                    break;
                case package_1.DepType.optional:
                    optionalDependencies[dep] = package_1.serializePackageTargetCanonical(dep, entry.target, defaultRegistry);
                    break;
            }
        });
        this.writeDependencies('dependencies', dependencies);
        this.writeDependencies('peerDependencies', peerDependencies);
        this.writeDependencies('devDependencies', devDependencies);
        this.writeDependencies('optionalDependencies', optionalDependencies);
        const overrides = {};
        this.overrides.sort(({ target: targetA }, { target: targetB }) => {
            if (typeof targetA === 'string')
                return typeof targetB === 'string' ? (targetA > targetB ? 1 : -1) : 1;
            else if (typeof targetB === 'string')
                return -1;
            if (targetA.registry !== targetB.registry)
                return targetA.registry > targetB.registry ? 1 : -1;
            if (targetA.name !== targetB.name)
                return targetA.name > targetB.name ? 1 : -1;
            return targetA.range.gt(targetB.range) ? 1 : -1;
        })
            .forEach(({ target, override }) => {
            overrides[target.toString()] = package_1.serializePackageConfig(override, typeof target !== 'string' ? target.registry : undefined);
        });
        this.prefixedSetObject(['overrides'], overrides, !this.jspmPrefix || !this.has(['overrides']));
        let baseURL = this.toRelativePath(this.baseURL);
        let baseURLPath = baseURL + (baseURL ? '/' : '');
        this.prefixedSetValue(['directories', 'baseURL'], baseURL || '.', '.');
        this.prefixedSetValue(['directories', 'packages'], this.toRelativePath(this.packages), baseURLPath + 'jspm_packages');
        this.prefixedSetValue(['directories', 'src'], this.toRelativePath(this.src) || '.', baseURLPath + 'src');
        this.prefixedSetValue(['directories', 'dist'], this.toRelativePath(this.dist), baseURLPath + 'dist');
        this.prefixedSetValue(['configFiles', 'jspm'], this.toRelativePath(this.configFile), 'jspm.json');
        let configDir = this.toRelativePath(path.dirname(this.configFile));
        configDir = configDir + (configDir ? '/' : '');
        // always ensure we save as jspm aware
        if (!this.has(['jspm']) && !this.has(['registry'])) {
            if (this.jspmPrefix)
                this.setObject(['jspm'], {});
            //else
            //this.setValue(['jspm'], true);
        }
        return super.write();
    }
    setPrefix(jspmPrefix) {
        // removes the "jspm" property in the package.json
        // flattening it down the to base-level
        if (this.jspmPrefix && this.has(['jspm']) && !jspmPrefix) {
            var jspmProperties = this.getProperties(['jspm']);
            var baseProperties = this.getProperties([]);
            var depsPrefixed = this.depsPrefixed;
            if (depsPrefixed) {
                this.remove(['dependencies']);
                this.remove(['peerDependencies']);
                this.remove(['devDependencies']);
            }
            jspmProperties.forEach(prop => {
                this.remove([prop.key]);
                baseProperties.push(prop);
            });
            this.remove(['jspm']);
            this.changed = true;
        }
        else if (!this.jspmPrefix && jspmPrefix) {
            if (this.getValue(['jspm']))
                this.remove(['jspm']);
        }
        this.jspmPrefix = this.depsPrefixed = jspmPrefix;
    }
    readDependencies(depName) {
        if (this.depsPrefixed)
            return this.getObject(['jspm', depName]);
        else
            return this.getObject([depName]);
    }
    writeDependencies(depName, value) {
        if (this.depsPrefixed)
            return this.setObject(['jspm', depName], value, !this.has(['jspm', depName]));
        else
            this.setObject([depName], value, !this.has([depName]));
    }
    prefixedSetObject(memberArray, object, clearIfEmpty = false) {
        var prefixed = ['jspm'].concat(memberArray);
        var newPrefixed = this.jspmPrefix && !this.jspmAware;
        if (!newPrefixed && this.has(prefixed))
            this.setObject(prefixed, object, clearIfEmpty);
        else if (!newPrefixed && this.has(memberArray))
            this.setObject(memberArray, object, clearIfEmpty);
        else if (this.jspmPrefix)
            this.setObject(prefixed, object, clearIfEmpty);
        else
            this.setObject(memberArray, object, clearIfEmpty);
    }
    prefixedSetValue(memberArray, value, defaultValue) {
        var prefixed = ['jspm', ...memberArray];
        var newPrefixed = this.jspmPrefix && !this.jspmAware;
        // if already specified, continue to specify
        if (!newPrefixed && this.has(prefixed))
            this.setValue(prefixed, value);
        else if (!newPrefixed && this.has(memberArray))
            this.setValue(memberArray, value);
        // otherwise only specify if not default
        else if (this.jspmPrefix && value !== defaultValue)
            this.setValue(prefixed, value);
        else if (value !== defaultValue)
            this.setValue(memberArray, value);
    }
    prefixedGetValue(memberArray, type) {
        var value;
        if (this.jspmPrefix)
            value = this.getValue(['jspm'].concat(memberArray), type);
        if (typeof value == 'undefined')
            value = this.getValue(memberArray, type);
        return value;
    }
    prefixedGetObject(memberArray, nested = true) {
        return this.jspmPrefix && this.getObject(['jspm'].concat(memberArray), nested) || this.getObject(memberArray, nested);
    }
    toRelativePath(absPath) {
        return path.relative(this.dir, absPath).replace(/\\/g, '/');
    }
}
exports.default = PackageJson;
//# sourceMappingURL=package-json-file.js.map