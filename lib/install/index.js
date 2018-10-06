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
const sver_1 = require("sver");
const path = require("path");
const package_1 = require("./package");
const common_1 = require("../utils/common");
const fs = require("graceful-fs");
const ncp = require("ncp");
const rimraf = require("rimraf");
const mkdirp = require("mkdirp");
const bin_1 = require("./bin");
const fileInstallRegEx = /^(\.[\/\\]|\.\.[\/\\]|\/|\\|~[\/\\])/;
class Installer {
    constructor(project) {
        this.project = project;
        this.config = project.config;
        this.registryManager = project.registryManager;
        // cache information associated with the current jspm project
        // keyed by package path -> package info
        this.jspmPackageInstallStateCache = {};
        this.binFolderChecked = false;
        this.sourceInstalls = {};
        this.installs = {};
        this.primaryType = undefined;
        this.primaryRanges = this.config.pjson.dependencies;
        this.updatePrimaryRanges = true;
        this.secondaryRanges = {};
        this.installTree = this.config.jspm.installed;
        this.globalPackagesPath = path.join(project.cacheDir, 'packages');
        // ensure registries are loaded
        this.registryManager.loadEndpoints();
        this.changed = false;
        this.busy = false;
    }
    dispose() {
    }
    ensureNotBusy() {
        if (this.busy)
            throw new common_1.JspmUserError('Installer can only install a single top-level install operation at once.');
    }
    async update(selectors, opts) {
        let updateInstalls = [];
        selectors.forEach(selector => {
            let matches = this.installTree.select(selector);
            if (!matches.length)
                throw new common_1.JspmUserError(`Package ${common_1.bold(selector)} is not an installed package.`);
            if (matches.length > 1) {
                // if a secondary, ensure that they all coalesce to the same package
                let primary = false;
                let exactNames = [];
                matches.forEach(match => {
                    if (primary) {
                        if (match.parent)
                            return;
                    }
                    else if (!match.parent) {
                        primary = true;
                        exactNames = [];
                    }
                    const exactResolution = match.parent ? this.installTree.dependencies[match.parent].resolve[match.name] : this.installTree.resolve[match.name];
                    const exactName = package_1.serializePackageName(exactResolution);
                    if (exactNames.indexOf(exactName) === -1)
                        exactNames.push(exactName);
                });
                if (exactNames.length > 1)
                    throw new common_1.JspmUserError(`Ambiguous update package ${common_1.bold(selector)} matches multiple packages: ${exactNames.map(name => common_1.highlight(name)).join(', ')}.`);
            }
            matches.forEach(match => {
                const { name, parent } = match;
                updateInstalls.push({
                    name,
                    parent,
                    type: package_1.DepType.primary,
                    target: undefined
                });
            });
        });
        await this.ensureInstallRanges();
        updateInstalls.forEach(install => {
            if (!install.parent) {
                const parentRanges = this.primaryRanges[install.name];
                if (!parentRanges)
                    throw new common_1.JspmUserError(`Unable to detect an install range for ${common_1.bold(install.name)}.`);
                install.type = parentRanges.type;
                install.target = parentRanges.target;
            }
            else {
                const parentObj = this.secondaryRanges[install.parent];
                install.target = parentObj && parentObj[install.name];
                if (!install.target)
                    throw new common_1.JspmUserError(`Unable to detect an install range for ${common_1.bold(install.name)} in ${common_1.highlight(install.parent)}.`);
            }
        });
        return this.install(updateInstalls, opts);
    }
    // could support override here for link to non-link: sources
    async link(pkg, source, opts) {
        const linkSource = await this.registryManager.resolveSource(source, this.project.projectPath, this.project.projectPath);
        const linkInstall = {
            name: undefined,
            parent: undefined,
            target: undefined,
            type: undefined
        };
        let linkPkg;
        // find exact or unique matching package in the tree, throwing if not found
        try {
            linkPkg = package_1.parseExactPackageName(pkg);
        }
        catch (e) { }
        // not a full package name -> select for best name match
        if (!linkPkg) {
            let matches = this.installTree.select(pkg);
            if (!matches.length)
                throw new common_1.JspmUserError(`Package ${common_1.bold(pkg)} is not an installed package. Either reference an existing installed package or provide the full package name to link into of the form ${common_1.bold('<registry:name@version>')}`);
            // if a secondary, ensure that they all coalesce to the same package
            const exactNames = [];
            matches.forEach(match => {
                const exactResolution = match.parent ? this.installTree.dependencies[match.parent].resolve[match.name] : this.installTree.resolve[match.name];
                linkPkg = exactResolution;
                const exactName = package_1.serializePackageName(exactResolution);
                if (exactNames.indexOf(exactName) === -1)
                    exactNames.push(exactName);
            });
            if (exactNames.length > 1)
                throw new common_1.JspmUserError(`Ambiguous link package ${common_1.bold(pkg)} matches multiple packages: ${exactNames.map(name => common_1.highlight(name)).join(', ')}.`);
            linkInstall.parent = matches[0].parent;
            linkInstall.name = matches[0].name;
        }
        // exact package name -> find it in the tree
        else if (this.installTree.visit((pkg, name, parent) => {
            if (linkPkg.name !== pkg.name || linkPkg.version !== pkg.version || pkg.registry !== linkPkg.registry)
                return false;
            linkInstall.name = name;
            linkInstall.parent = parent;
            return true;
        })) { }
        // see if the exact package matches a top-level package.json install
        // that has not been done
        else if (Object.keys(this.primaryRanges).some(name => {
            const range = this.primaryRanges[name];
            if (typeof range.target !== 'string' && range.target.has(linkPkg)) {
                linkInstall.name = name;
                linkInstall.type = range.type;
                return true;
            }
            return false;
        })) { }
        // not existing at all
        // -> new primary install to linked
        else {
            linkInstall.type = package_1.DepType.primary; // check opts type?
            linkInstall.target = new package_1.PackageTarget(linkPkg.registry, linkPkg.name, linkPkg.version);
            this.installTree.resolve[linkInstall.name] = linkPkg;
        }
        // set primary range type and target
        // type not needed for secondaries and target not needed as lock is used
        if (linkInstall.parent === undefined) {
            const primaryRange = this.primaryRanges[linkInstall.name];
            if (primaryRange) {
                linkInstall.type = primaryRange.type;
                linkInstall.target = primaryRange.target;
            }
            else {
                linkInstall.type = package_1.DepType.primary;
                linkInstall.target = new package_1.PackageTarget(linkPkg.registry, linkPkg.name, linkPkg.version);
            }
        }
        // source set through lock for existing "link over" cases
        const linkPkgName = package_1.serializePackageName(linkPkg);
        const linkPkgResolved = this.installTree.dependencies[linkPkgName] = this.installTree.dependencies[linkPkgName] || { source: undefined, resolve: {} };
        linkPkgResolved.source = linkSource;
        opts.lock = true;
        return this.install([linkInstall], opts);
    }
    async checkout(selectors) {
        const checkouts = [];
        selectors.forEach(selector => {
            let matches = this.installTree.select(selector);
            if (!matches.length)
                throw new common_1.JspmUserError(`Package ${common_1.bold(selector)} is not an installed package.`);
            // if a secondary, ensure that they all coalesce to the same package
            const exactNames = [];
            matches.forEach(match => {
                const exactResolution = match.parent ? this.installTree.dependencies[match.parent].resolve[match.name] : this.installTree.resolve[match.name];
                const exactName = package_1.serializePackageName(exactResolution);
                if (exactNames.indexOf(exactName) === -1)
                    exactNames.push(exactName);
            });
            if (exactNames.length > 1)
                throw new common_1.JspmUserError(`Ambiguous checkout package ${common_1.bold(selector)} matches multiple packages: ${exactNames.map(name => common_1.highlight(name)).join(', ')}.`);
            checkouts.push(exactNames[0]);
        });
        await Promise.all(checkouts.map(async (checkoutName) => {
            const registryIndex = checkoutName.indexOf(':');
            const packageInstallState = await this.getPackageInstallState(checkoutName);
            let stopReason = '';
            if (!packageInstallState.exists)
                stopReason = 'not installed';
            else if (packageInstallState.linkPath)
                stopReason = 'already linked';
            // skip if already checked out
            else if (!packageInstallState.hash)
                return this.project.log.ok(`Package ${common_1.highlight(checkoutName)} is already checked out.`);
            if (stopReason)
                throw new common_1.JspmUserError(`Unable to checkout ${common_1.highlight(checkoutName)} as it is ${stopReason}.`);
            const checkoutPath = path.join(this.config.pjson.packages, checkoutName.substr(0, registryIndex), checkoutName.substr(registryIndex + 1));
            const installPath = await new Promise((resolve, reject) => fs.readlink(checkoutPath, (err, path) => err ? reject(err) : resolve(path)));
            await new Promise((resolve, reject) => fs.unlink(checkoutPath, err => err ? reject(err) : resolve()));
            await new Promise((resolve, reject) => ncp(installPath, checkoutPath, err => err ? reject(err) : resolve()));
            this.project.log.ok(`Checked out package ${common_1.highlight(checkoutName)} for local modifications.`);
        }));
    }
    async uninstall(names) {
        this.ensureNotBusy();
        this.busy = true;
        if (names.length === 0)
            throw new common_1.JspmUserError(`No package provided to uninstall.`);
        names.forEach(name => {
            if (!this.primaryRanges[name])
                throw new common_1.JspmUserError(`Package ${common_1.bold(name)} doesn\'t match any existing top-level installed packages.`);
            if (this.primaryRanges[name]) {
                delete this.primaryRanges[name];
                this.changed = true;
            }
            if (this.installTree.resolve[name]) {
                delete this.installTree.resolve[name];
                this.changed = true;
            }
        });
        await this.clean();
        this.busy = false;
        return this.config.save();
    }
    /*
     * Install API top-level function
     */
    async install(installs, opts) {
        this.ensureNotBusy();
        this.busy = true;
        this.opts = opts;
        this.changed = false;
        if (this.opts.dedupe !== false)
            this.opts.dedupe = !this.opts.lock;
        this.primaryType = installs.length === 0 ? package_1.DepType.primary : installs[0].type;
        // no installs, install from package.json
        if (installs.length === 0) {
            // maintain existing package.json ranges
            this.updatePrimaryRanges = false;
            installs = Object.keys(this.primaryRanges).map(dep => {
                const entry = this.primaryRanges[dep];
                return {
                    name: dep,
                    target: entry.target,
                    type: entry.type,
                    parent: undefined
                };
            });
        }
        // install in parallel
        await Promise.all(installs.map(install => {
            const target = install.target;
            if (typeof target === 'string') {
                /*
                  * File install sugar cases:
                  *   ./local -> file:./local
                  *   /local -> file:/local
                  *   ~/file -> file:~/file
                  */
                if (target.match(fileInstallRegEx)) {
                    install.target = 'file:' + target;
                }
                /*
                  * Plain target install
                  * Should ideally support a/b/c -> file:a/b/c resource sugar, but for now omitted
                  */
                else if (!target.match(package_1.resourceInstallRegEx)) {
                    let registryIndex = target.indexOf(':');
                    let targetString = target;
                    // a/b -> github:a/b sugar
                    if (registryIndex === -1 && target.indexOf('/') !== -1 && target[0] !== '@')
                        targetString = 'github:' + target;
                    if (registryIndex === -1)
                        targetString = ':' + targetString;
                    install.target = package_1.processPackageTarget(install.name, targetString, this.project.defaultRegistry);
                }
            }
            // auto-generate name from target if necessary
            if (!install.name) {
                if (typeof install.target !== 'string') {
                    if (install.target.name.substr(install.target.name.lastIndexOf(':') + 1).match(common_1.validPkgNameRegEx))
                        install.name = install.target.name.substr(install.target.name.lastIndexOf(':') + 1);
                    else
                        install.name = install.target.name.substr(install.target.name.lastIndexOf(':') + 1).split('/').pop();
                }
                else {
                    install.name = getResourceName(install.target, this.project.projectPath);
                }
            }
            if (!install.name.match(common_1.validPkgNameRegEx))
                throw new common_1.JspmUserError(`Invalid name ${common_1.bold(install.name)} for install to ${common_1.highlight(install.target.toString())}`);
            if (typeof install.target === 'string')
                return this.resourceInstall(install);
            else
                return this.packageInstall(install);
        }));
        await this.clean();
        const configChanged = this.config.save();
        this.busy = false;
        return configChanged || this.changed;
    }
    /*
    private async installPeer (_install: Install) {
      throw new Error('Todo');
    }
    */
    // most general override applies (greater containing range)
    getOverride(pkg, cut = false) {
        if (typeof pkg === 'string') {
            const matchIndex = this.config.pjson.overrides.findIndex(({ target }) => target === pkg);
            const match = this.config.pjson.overrides[matchIndex];
            if (cut && matchIndex !== -1 && !match.fresh)
                this.config.pjson.overrides.splice(matchIndex, 1);
            return match && match.override;
        }
        else {
            let bestTargetIndex = -1;
            let bestTarget;
            let bestOverride;
            let bestIsFresh;
            for (let i = 0; i < this.config.pjson.overrides.length; i++) {
                let { target, override, fresh } = this.config.pjson.overrides[i];
                if (typeof target === 'string')
                    continue;
                if (target.has(pkg)) {
                    if (!bestTarget || target.range.gt(bestTarget.range)) {
                        bestTargetIndex = i;
                        bestTarget = target;
                        bestOverride = override;
                        bestIsFresh = fresh;
                    }
                }
            }
            if (cut && bestTargetIndex !== -1 && !bestIsFresh)
                this.config.pjson.overrides.splice(bestTargetIndex, 1);
            return bestOverride;
        }
    }
    // get an override and remove it from the override list in the process
    // this way an override saved back does not result in duplication
    cutOverride(pkg) {
        return this.getOverride(pkg, true);
    }
    setOverride(pkgTarget, override) {
        this.config.pjson.overrides.push({
            target: pkgTarget,
            override,
            fresh: true
        });
    }
    async packageInstall(install) {
        // first check if already doing this install, to avoid redoing work
        // this in turn catches circular installs on the early returns
        const installId = `${install.type === package_1.DepType.peer ? undefined : install.parent}|${install.name}`;
        const existingPackageInstall = this.installs[installId];
        if (existingPackageInstall)
            return;
        return this.installs[installId] = (async () => {
            this.project.log.debug(`Installing ${install.name}${install.parent ? ` for ${install.parent}` : ``}`);
            // install information
            let target = install.target;
            let override = install.override && package_1.processPackageConfig(install.override);
            let source;
            let resolvedPkg;
            // if a lock install, use existing resolution
            if (this.opts.lock)
                resolvedPkg = this.installTree.getResolution(install);
            // if a non-latest secondary install, use existing resolution or find the best match in the tree
            if (install.type === package_1.DepType.secondary && !this.opts.latest)
                resolvedPkg = this.installTree.getResolution(install) || this.installTree.getBestMatch(target);
            if (resolvedPkg) {
                const existingResolutionName = package_1.serializePackageName(resolvedPkg);
                const existingResolved = this.installTree.dependencies[existingResolutionName];
                // if we found an existing resolution, use it if we have enough information
                if (existingResolved && existingResolved.source) {
                    this.project.log.debug(`${install.name} matched against existing install`);
                    target = this.setResolution(install, target, resolvedPkg, existingResolved.source);
                    override = this.cutOverride(resolvedPkg);
                    override = await this.sourceInstall(resolvedPkg, existingResolved.source, override, undefined);
                    if (override)
                        this.setOverride(target, override);
                    return;
                }
                // otherwise specifically lookup this exact version
                else {
                    target = new package_1.PackageTarget(resolvedPkg.registry, resolvedPkg.name, resolvedPkg.version);
                }
            }
            // run resolver lookup
            let resolution;
            try {
                resolution = await this.registryManager.resolve(target, override, this.opts.edge);
            }
            catch (e) {
                throw new common_1.JspmError(`Resolving ${common_1.highlight(package_1.serializePackageName(target))}`, undefined, e);
            }
            if (!resolution)
                throw new common_1.JspmUserError(`No resolution found for ${common_1.highlight(package_1.serializePackageName(target).replace(/\@\*$/, ''))}${this.offline ? ' (offline)' : ''}.`);
            resolvedPkg = resolution.pkg;
            source = resolution.source;
            override = resolution.override;
            // if there was no install override, get any override from package.json
            if (!install.override) {
                const existingOverride = this.cutOverride(resolvedPkg);
                if (existingOverride) {
                    if (override)
                        package_1.overridePackageConfig(override, existingOverride);
                    else
                        override = Object.assign({}, existingOverride);
                }
            }
            // immediately store the resolution if necessary
            target = this.setResolution(install, new package_1.PackageTarget(resolution.target.registry, resolution.target.name, resolution.target.version), resolution.pkg, source);
            // upgrade anything to this resolution which can (this is the orphaning)
            if (this.opts.dedupe)
                this.upgradePackagesTo(resolvedPkg).catch(() => { });
            const sourceInstallPromise = this.sourceInstall(resolvedPkg, source, override, resolution && resolution.deprecated);
            if (sourceInstallPromise) {
                // override from resolve replaces any existing package.json override which is not used
                override = await sourceInstallPromise;
                if (override)
                    this.setOverride(target, override);
            }
        })();
    }
    sourceInstall(resolvedPkg, source, override, deprecated) {
        const resolvedPkgName = package_1.serializePackageName(resolvedPkg);
        const sourceInstallId = `${resolvedPkgName}|${source}`;
        let existingSourceInstall = this.sourceInstalls[sourceInstallId];
        // avoid circular (ok since a single install tree)
        if (existingSourceInstall)
            return;
        return this.sourceInstalls[sourceInstallId] = (async () => {
            // checked out packages stay unless a reset
            // and use the configuration from the package.json directly
            if (!this.opts.reset && await this.isPackageCheckedOut(resolvedPkgName)) {
                const config = await this.readCheckedOutConfig(resolvedPkgName, override);
                this.project.log.info(`Skipping reinstall for ${common_1.highlight(resolvedPkgName)} as there is a custom folder checked out in its place. Use the ${common_1.bold('--reset')} install flag to revert to the original source.`);
                // override is undefined by definition of checked out.
                return this.installDependencies(resolvedPkg.registry, config, resolvedPkgName);
            }
            // handle linked packages
            if (source.startsWith('link:')) {
                if (await this.setPackageToLinked(resolvedPkgName, path.resolve(this.project.projectPath, source.substr(5))))
                    this.changed = true;
                const config = await this.readCheckedOutConfig(resolvedPkgName, override, true);
                return this.installDependencies(resolvedPkg.registry, config, resolvedPkgName);
            }
            let preloadedDepNames, preloadDepsInstallPromise;
            // kick off dependency installs now
            if (override) {
                preloadDepsInstallPromise = this.installDependencies(resolvedPkg.registry, override, resolvedPkgName, preloadedDepNames);
                preloadDepsInstallPromise.catch(() => { });
            }
            // install
            try {
                var installResult = await this.registryManager.ensureInstall(source, override, this.opts.reset ? async () => false : this.createCheckoutPrompt(resolvedPkgName), this.opts.verify);
            }
            catch (e) {
                const errMsg = `Unable to install ${common_1.highlight(resolvedPkgName)}.`;
                if (e instanceof common_1.JspmUserError)
                    throw new common_1.JspmUserError(errMsg, undefined, e);
                else
                    throw new common_1.JspmError(errMsg, undefined, e);
            }
            // install result is undefined when verification fails and we have a checkout
            // then handle like checked out instead
            if (!installResult) {
                const config = await this.readCheckedOutConfig(resolvedPkgName, override);
                return this.installDependencies(resolvedPkg.registry, config, resolvedPkgName);
            }
            if (installResult.changed)
                this.changed = true;
            let config, hash;
            ({ config, override, hash } = installResult);
            await Promise.all([
                // install dependencies, skipping already preloaded
                this.installDependencies(resolvedPkg.registry, config, resolvedPkgName, preloadedDepNames),
                // symlink to the global install
                (async () => {
                    if (await this.setPackageToHash(resolvedPkgName, hash)) {
                        this.changed = true;
                        // only show deprecation message on first install into jspm_packages
                        if (deprecated)
                            this.project.log.warn(`Deprecation warning for ${common_1.highlight(resolvedPkgName)}: ${common_1.bold(deprecated)}`);
                    }
                })(),
                this.createBins(config, resolvedPkgName),
                preloadDepsInstallPromise
            ]);
            return override;
        })();
    }
    async createBins(config, resolvedPkgName) {
        // NB we should create a queue based on precedence to ensure deterministic ordering
        // when there are namespace collissions, but this problem will likely not be hit for a while
        if (config.bin) {
            const binDir = path.join(this.config.pjson.packages, '.bin');
            if (!this.binFolderChecked) {
                await new Promise((resolve, reject) => mkdirp(binDir, err => err ? reject(err) : resolve(binDir)));
                this.binFolderChecked = true;
            }
            this.project.checkGlobalBin();
            await Promise.all(Object.keys(config.bin).map(p => bin_1.writeBinScripts(binDir, p, resolvedPkgName.replace(':', path.sep) + path.sep + config.bin[p])));
        }
    }
    // resource install is different to source install in that
    // we need to normalize the source string into resolved form and
    // we need to install first to find out the name of the package
    async resourceInstall(install) {
        // first check if already doing this install, to avoid redoing work
        // this in turn catches circular installs on the early returns
        const installId = `${install.type === package_1.DepType.peer ? undefined : install.parent}|${install.name}`;
        const existingPackageInstall = this.installs[installId];
        if (existingPackageInstall)
            return;
        return this.installs[installId] = (async () => {
            let override = install.override || this.cutOverride(install.target);
            // handle lock lookups for resourceInstall
            const existingResolution = this.installTree.getResolution(install);
            if (existingResolution) {
                const existingResolutionName = package_1.serializePackageName(existingResolution);
                const existingResolved = this.installTree.dependencies[existingResolutionName];
                if (existingResolved && existingResolved.source) {
                    this.project.log.debug(`${install.name} matched against existing install`);
                    this.setResolution(install, install.target, existingResolution, existingResolved.source);
                    override = await this.sourceInstall(existingResolution, existingResolved.source, override, undefined);
                    if (override)
                        this.setOverride(install.target, override);
                    return;
                }
            }
            this.project.log.debug(`Installing resource ${install.name}${install.parent ? ` for ${install.parent}` : ``}`);
            const parentPath = install.parent && install.type !== package_1.DepType.peer ? path.join(this.config.pjson.packages, install.parent.replace(':', path.sep)) : this.project.projectPath;
            // first normalize the source
            try {
                var source = await this.registryManager.resolveSource(install.target, parentPath, this.project.projectPath);
            }
            catch (e) {
                const errMsg = `Unable to locate ${common_1.highlight(install.target)}.`;
                if (e instanceof common_1.JspmUserError)
                    throw new common_1.JspmUserError(errMsg, undefined, e);
                else
                    throw new common_1.JspmError(errMsg, undefined, e);
            }
            const isLink = source.startsWith('link:');
            let config, hash, linkPath;
            let registry, name, version;
            // link
            if (isLink) {
                linkPath = path.resolve(this.project.projectPath, source.substr(5));
                try {
                    var json = await common_1.readJSON(path.join(linkPath, 'package.json'));
                }
                catch (e) { }
                config = package_1.processPackageConfig(json || {});
                if (override) {
                    ({ config, override } = package_1.overridePackageConfig(config, override));
                    if (override)
                        this.project.log.warn(`The override for ${common_1.highlight(install.target)} is not being applied as it is linked. Rather edit the original package.json file directly instead of applying an override.`);
                }
                registry = config.registry || install.parent && install.parent.substr(0, install.parent.indexOf(':'));
                name = config.name || install.name;
                version = config.version;
            }
            // install
            else {
                try {
                    var installResult = await this.registryManager.ensureInstall(source, override, async () => false, this.opts.verify);
                }
                catch (e) {
                    const errMsg = `Unable to install ${source}.`;
                    if (e instanceof common_1.JspmUserError)
                        throw new common_1.JspmUserError(errMsg, undefined, e);
                    else
                        throw new common_1.JspmError(errMsg, undefined, e);
                }
                if (installResult.changed)
                    this.changed = true;
                ({ config, override, hash } = installResult);
                registry = config.registry || install.parent && install.parent.substr(0, install.parent.indexOf(':'));
                name = config.name || install.name;
                version = config.version;
                if (!version) {
                    let refIndex = install.target.lastIndexOf('#');
                    if (refIndex !== -1)
                        version = install.target.substr(refIndex + 1);
                }
            }
            if (this.project.userInput) {
                if (!registry)
                    registry = await this.project.input(`Enter the ${common_1.bold('registry')} to ${isLink ? `link as` : `install ${install.target} as`}`, this.project.defaultRegistry, {
                        info: 'All installs in jspm need to be assigned a registry, name and version for flat installation.',
                        validate: (input) => {
                            if (!input.match(/^[a-z]+$/))
                                return 'A valid registry name must be provided.';
                        }
                    });
                if (!version)
                    version = await this.project.input(`Enter the ${common_1.bold('version')} to ${isLink ? `link as` : `install ${install.target} as`}`, 'master', {
                        info: 'All installs in jspm need to be assigned a registry, name and version for flat installation.',
                        validate: (input) => {
                            if (!input)
                                return 'A version must be provided.';
                        }
                    });
            }
            else {
                let missing = !registry && 'registry' || !name && 'name' || !version && 'version';
                if (missing) {
                    throw new common_1.JspmUserError(`Unable to ${isLink ? `link ${linkPath}` : `install resource target ${install.target}`} as no ${common_1.bold(missing)} property is provided. This should be set in the original package.json or be added with an override to the install if necessary.`);
                }
            }
            const resolvedPkgName = `${registry}:${name}@${version}`;
            const resolvedPkg = package_1.parseExactPackageName(resolvedPkgName);
            // save resolution
            this.setResolution(install, install.target, resolvedPkg, source);
            if (override)
                this.setOverride(install.target, override);
            // if checked out, skip the actual resource install
            if (!this.opts.reset && await this.isPackageCheckedOut(resolvedPkgName)) {
                const config = await this.readCheckedOutConfig(resolvedPkgName, override);
                this.project.log.info(`Skipping reinstall for ${common_1.highlight(resolvedPkgName)} as there is a custom folder checked out in its place. Use the ${common_1.bold('--reset')} install flag to revert to the original source.`);
                // override is undefined by definition of checked out.
                return this.installDependencies(resolvedPkg.registry, config, resolvedPkgName);
            }
            await Promise.all([
                this.installDependencies(resolvedPkg.registry, config, resolvedPkgName),
                (async () => {
                    if (isLink) {
                        if (await this.setPackageToLinked(resolvedPkgName, linkPath))
                            this.changed = true;
                    }
                    else {
                        if (await this.setPackageToHash(resolvedPkgName, hash))
                            this.changed = true;
                    }
                })(),
                this.createBins(config, resolvedPkgName)
            ]);
        })();
    }
    async installDependencies(registry, config, resolvedPkgName, preloadedDepNames) {
        const preLoad = preloadedDepNames !== undefined && preloadedDepNames.length !== 0;
        try {
            await Promise.all(depsToInstalls(registry, this.opts.optional, config, resolvedPkgName, preLoad === false && preloadedDepNames).map(install => {
                if (preLoad && preloadedDepNames)
                    preloadedDepNames.push(install.name);
                if (typeof install.target === 'string')
                    return this.resourceInstall(install);
                else
                    return this.packageInstall(install);
            }));
        }
        catch (e) {
            throw new common_1.JspmError(`Installing ${common_1.highlight(resolvedPkgName)}.`, undefined, e);
        }
    }
    setResolution(install, target, resolution, source) {
        const exactResolution = {
            registry: resolution.registry,
            name: resolution.name,
            version: resolution.version,
            semver: new sver_1.Semver(resolution.version)
        };
        const resolutionString = package_1.serializePackageName(resolution);
        if (!install.parent || install.type === package_1.DepType.peer) {
            this.installTree.resolve[install.name] = exactResolution;
            // only write in targets when primary range is empty
            const existingRange = this.primaryRanges[install.name];
            if (!existingRange || this.updatePrimaryRanges === true) {
                if (typeof target !== 'string') {
                    if (target.range.isExact || this.opts.exact)
                        target = target.fromVersion(resolution.version);
                    if (sver_1.Semver.isValid(resolution.version)) {
                        if (target.range.isMajor || target.range.isWildcard)
                            target = target.fromVersion('^' + resolution.version);
                        else if (target.range.isStable)
                            target = target.fromVersion('~' + resolution.version);
                    }
                    else {
                        target = new package_1.PackageTarget(resolution.registry, resolution.name, resolution.version);
                    }
                }
                this.changed = true;
                const existingPrimaryAndNotDev = this.primaryRanges[install.name] &&
                    (this.primaryRanges[install.name].type === package_1.DepType.peer || this.primaryRanges[install.name].type === package_1.DepType.primary);
                this.primaryRanges[install.name] = {
                    type: existingPrimaryAndNotDev ? this.primaryRanges[install.name].type : install.parent ? this.primaryType : install.type,
                    target
                };
            }
        }
        else {
            const parentRecord = this.installTree.dependencies[install.parent];
            if (!parentRecord)
                throw new common_1.JspmError(`No parent in tree for resolution ${resolutionString}.`);
            parentRecord.resolve[install.name] = exactResolution;
            (this.secondaryRanges[install.parent] = this.secondaryRanges[install.parent] || {})[install.name] = target;
        }
        const installObj = this.installTree.dependencies[resolutionString];
        if (!installObj)
            this.installTree.dependencies[resolutionString] = { source, resolve: {} };
        else
            installObj.source = source;
        return target;
    }
    getPackagePath(name) {
        const resolvedPkgName = package_1.serializePackageName(this.config.jspm.installed.resolve[name]);
        const registryIndex = resolvedPkgName.indexOf(':');
        return path.join(this.config.pjson.packages, resolvedPkgName.substr(0, registryIndex), resolvedPkgName.substr(registryIndex + 1));
    }
    createCheckoutPrompt(resolvedPkgName) {
        const registryIndex = resolvedPkgName.indexOf(':');
        const localPackagePath = path.join(this.config.pjson.packages, resolvedPkgName.substr(0, registryIndex), resolvedPkgName.substr(registryIndex + 1));
        return async (dir) => {
            let checkout = await this.project.confirm(`The global package ${resolvedPkgName} has been modified, do you want to checkout the package now for custom modification, or revert?`, true);
            if (checkout) {
                await new Promise((resolve, reject) => ncp(dir, localPackagePath, err => err ? reject(err) : resolve()));
                await new Promise((resolve, reject) => rimraf(dir, err => err ? reject(err) : resolve()));
            }
            return checkout;
        };
    }
    async readCheckedOutConfig(resolvedPkgName, override, linked = false) {
        const registryIndex = resolvedPkgName.indexOf(':');
        const registry = resolvedPkgName.substr(0, registryIndex);
        const pkgPath = path.join(this.config.pjson.packages, registry, resolvedPkgName.substr(registryIndex + 1));
        var json = await common_1.readJSON(path.join(pkgPath, 'package.json'));
        let config = package_1.processPackageConfig(json || {});
        if (override) {
            ({ config, override } = package_1.overridePackageConfig(config, override));
            if (override)
                this.project.log.warn(`The override for ${common_1.highlight(resolvedPkgName)} is not being applied as it is ${linked ? 'linked' : 'checked out'}. Rather edit the original package.json file directly instead of applying an override.`);
        }
        return config;
    }
    // upgrades any packages in the installing or installed tree to the newly added resolution
    async upgradePackagesTo(upgradePkg) {
        await this.ensureInstallRanges(upgradePkg);
        await this.installTree.visit((pkg, name, parent) => {
            let range;
            if (parent) {
                const parentRanges = this.secondaryRanges[parent];
                if (!parentRanges)
                    return;
                range = parentRanges[name];
            }
            else {
                range = this.primaryRanges[name].target;
            }
            // if theres a rangeless dependency, ignore
            if (!range)
                return;
            if (!range.has(pkg))
                return;
            if (range.has(upgradePkg) && upgradePkg.semver.gt(pkg.semver)) {
                // handle orphaning inflight cancellation?
                if (parent)
                    this.installTree.dependencies[parent][name] = upgradePkg;
                else
                    this.installTree[name] = upgradePkg;
            }
        });
    }
    async setPackageToHash(pkgName, hash) {
        const packageInstallState = await this.getPackageInstallState(pkgName);
        if (packageInstallState.hash === hash)
            return false;
        const { exists, linkPath } = packageInstallState;
        packageInstallState.exists = true;
        packageInstallState.hash = hash;
        packageInstallState.linkPath = undefined;
        const localPackagePath = path.join(this.config.pjson.packages, pkgName.replace(':', path.sep));
        if (exists) {
            if (hash === undefined && linkPath === undefined) {
                this.project.log.info(`Removing checked out package ${pkgName}.`);
                await new Promise((resolve, reject) => rimraf(localPackagePath, err => err ? reject(err) : resolve()));
            }
            else {
                if (linkPath !== undefined)
                    this.project.log.info(`Replacing custom symlink for ${pkgName}.`);
                await new Promise((resolve, reject) => fs.unlink(localPackagePath, err => err ? reject(err) : resolve()));
            }
        }
        else {
            await new Promise((resolve, reject) => mkdirp(path.dirname(localPackagePath), err => err ? reject(err) : resolve()));
        }
        const cachePath = path.resolve(this.globalPackagesPath, hash);
        await new Promise((resolve, reject) => mkdirp(path.dirname(localPackagePath), err => err ? reject(err) : resolve()));
        await new Promise((resolve, reject) => fs.symlink(cachePath, localPackagePath, 'junction', err => err ? reject(err) : resolve()));
        return true;
    }
    async setPackageToLinked(pkgName, linkPath) {
        const packageInstallState = await this.getPackageInstallState(pkgName);
        if (packageInstallState.linkPath === linkPath)
            return false;
        const { exists, hash } = packageInstallState;
        packageInstallState.exists = true;
        packageInstallState.hash = undefined;
        packageInstallState.linkPath = linkPath;
        const localPackagePath = path.join(this.config.pjson.packages, pkgName.replace(':', path.sep));
        if (exists) {
            if (hash === undefined && linkPath === undefined) {
                this.project.log.info(`Removing checked out package ${pkgName}.`);
                await new Promise((resolve, reject) => rimraf(localPackagePath, err => err ? reject(err) : resolve()));
            }
            else {
                if (linkPath !== undefined)
                    this.project.log.info(`Removing custom symlink for ${pkgName}.`);
                await new Promise((resolve, reject) => fs.unlink(localPackagePath, err => err ? reject(err) : resolve()));
            }
        }
        else {
            await new Promise((resolve, reject) => mkdirp(path.dirname(localPackagePath), err => err ? reject(err) : resolve()));
        }
        await new Promise((resolve, reject) => mkdirp(path.dirname(localPackagePath), err => err ? reject(err) : resolve()));
        await new Promise((resolve, reject) => fs.symlink(path.relative(path.dirname(localPackagePath), linkPath), localPackagePath, 'junction', err => err ? reject(err) : resolve()));
        return true;
    }
    async packageExists(pkgName) {
        const packageInstallState = await this.getPackageInstallState(pkgName);
        return packageInstallState.exists;
    }
    async isPackageCheckedOut(pkgName) {
        const packageInstallState = await this.getPackageInstallState(pkgName);
        return packageInstallState.exists && packageInstallState.hash === undefined && packageInstallState.linkPath === undefined;
    }
    async getPackageInstallState(pkgName) {
        let packageInstallState = this.jspmPackageInstallStateCache[pkgName];
        if (packageInstallState)
            return packageInstallState;
        const pkgPath = path.join(this.config.pjson.packages, pkgName.replace(':', path.sep));
        packageInstallState = {
            exists: false,
            hash: undefined,
            linkPath: undefined
        };
        const symlinkPath = await new Promise((resolve, reject) => {
            fs.readlink(pkgPath, (err, resolvedPath) => {
                if (err) {
                    switch (err.code) {
                        case 'ENOENT':
                            resolve();
                            break;
                        case 'EINVAL':
                            resolve('<UNKNOWN>');
                            break;
                        case 'UNKNOWN':
                            resolve(pkgPath);
                            break;
                        default:
                            reject(err);
                            break;
                    }
                }
                else {
                    resolve(path.resolve(path.dirname(pkgPath), resolvedPath));
                }
            });
        });
        if (!symlinkPath)
            return this.jspmPackageInstallStateCache[pkgName] = packageInstallState;
        packageInstallState.exists = true;
        if (symlinkPath.startsWith(this.globalPackagesPath) && symlinkPath[this.globalPackagesPath.length] === path.sep) {
            const pathHash = symlinkPath.substring(this.globalPackagesPath.length + 1, symlinkPath.length - 1);
            if (pathHash.indexOf(path.sep) === -1) {
                packageInstallState.hash = pathHash;
                return this.jspmPackageInstallStateCache[pkgName] = packageInstallState;
            }
        }
        if (symlinkPath !== pkgPath)
            packageInstallState.linkPath = symlinkPath;
        return this.jspmPackageInstallStateCache[pkgName] = packageInstallState;
    }
    async ensureInstallRanges(exactPkg) {
        await this.installTree.visitAsync(async (pkg, name, parent) => {
            // where an upgrade package is specified,
            // only check ranges that are the same package, but a different version
            if (exactPkg && (pkg.registry !== exactPkg.registry || pkg.name !== exactPkg.name || pkg.version === exactPkg.version))
                return;
            if (parent) {
                const secondaryRanges = this.secondaryRanges[parent];
                if (secondaryRanges && secondaryRanges[name])
                    return;
            }
            else {
                const primaryRange = this.primaryRanges[name];
                if (primaryRange)
                    return;
                return;
            }
            const parentDepObj = this.installTree.dependencies[parent];
            let config;
            if (await this.packageExists(parent)) {
                config = await this.readCheckedOutConfig(parent, undefined);
            }
            else {
                // no source -> ignore
                if (!parentDepObj || !parentDepObj.source)
                    return;
                // fail gracefully eg for offline
                try {
                    // we dont verify, reset or alter overrides here because we want to be minimally invasive outside of the direct install tree
                    const override = this.getOverride(package_1.parseExactPackageName(parent));
                    var installResult = await this.registryManager.ensureInstall(parentDepObj.source, override, this.createCheckoutPrompt(parent), false);
                }
                catch (e) {
                    return;
                }
                if (!installResult) {
                    config = await this.readCheckedOutConfig(parent, undefined);
                }
                // we dont persist the updated override or check the jspm_packages symlink, because we dont want to
                // alter in any way installed packages not directly on the install tree -> aiming for principle of least surprise to user
                else {
                    if (installResult.changed)
                        this.changed = true;
                    ({ config } = installResult);
                }
            }
            const rangeTarget = config.dependencies && config.dependencies[name] ||
                config.peerDependencies && config.peerDependencies[name] ||
                config.optionalDependencies && config.optionalDependencies[name];
            if (!rangeTarget)
                return;
            this.secondaryRanges[parent] = this.secondaryRanges[parent] || {};
            this.secondaryRanges[parent][name] = rangeTarget;
        });
    }
    async clean(save = false) {
        const packageList = [];
        const addDependentPackages = (pkgName) => {
            packageList.push(pkgName);
            // get all immediate children of this package
            // for those children not already seen (in packages list),
            // run getDependentPackages in turn on those
            let depObj = this.installTree.dependencies[pkgName];
            if (!depObj || !depObj.resolve)
                return;
            Object.keys(depObj.resolve).forEach(dep => {
                const curPkg = depObj.resolve[dep];
                const curPkgName = package_1.serializePackageName(curPkg);
                if (packageList.indexOf(curPkgName) !== -1)
                    return;
                addDependentPackages(curPkgName);
            });
        };
        // Remove anything not explicitly in package.json
        Object.keys(this.installTree.resolve).forEach(name => {
            if (!this.primaryRanges[name])
                delete this.installTree.resolve[name];
        });
        // getDependentPackages for each of baseMap
        Object.keys(this.primaryRanges).forEach(dep => {
            const resolved = this.installTree.resolve[dep];
            if (!resolved)
                return;
            addDependentPackages(package_1.serializePackageName(resolved));
        });
        // now that we have the package list, remove everything not in it
        Object.keys(this.installTree.dependencies).forEach(dep => {
            if (packageList.indexOf(dep) === -1) {
                this.project.log.info(`Removed ${common_1.highlight(dep)}.`);
                delete this.installTree.dependencies[dep];
            }
        });
        // depthCheck returns true to keep going (files being ignored),
        //   false to add the dir to the flat list
        const removeNonPackageDirs = async (dir) => {
            let files = await new Promise((resolve, reject) => fs.readdir(dir, (err, files) => err ? reject(err) : resolve(files)));
            let deletedAll = true;
            let relPath = path.relative(this.config.pjson.packages, dir);
            let pkgBase = relPath.replace(path.sep, ':');
            if (common_1.isWindows)
                pkgBase = pkgBase.replace(/\\/g, '/');
            await Promise.all(files.map(async (file) => {
                let filePath = path.resolve(dir, file);
                let pkgName = pkgBase + (pkgBase.indexOf(':') === -1 ? ':' : '/') + file;
                if (packageList.indexOf(pkgName) !== -1 || pkgName === ':.bin') {
                    deletedAll = false;
                    return;
                }
                let fileInfo = await new Promise((resolve, reject) => fs.lstat(filePath, (err, stats) => err ? reject(err) : resolve(stats)));
                // package folder
                if (file.indexOf('@') > 0) {
                    // warn on directory removal
                    if (fileInfo.isSymbolicLink()) {
                        await new Promise((resolve, reject) => fs.unlink(filePath, err => err ? reject(err) : resolve()));
                    }
                    else if (fileInfo.isDirectory()) {
                        const remove = await this.project.confirm(`The orphaned package at ${common_1.highlight(filePath)} is currently checked out, are you sure you want to remove it?`, true);
                        if (remove)
                            await new Promise((resolve, reject) => rimraf(filePath, err => err ? reject(err) : resolve()));
                        else
                            deletedAll = false;
                    }
                    // ignore rogue files
                    else { }
                }
                // non package folder -> traverse
                else if (fileInfo.isDirectory()) {
                    if (!(await removeNonPackageDirs(filePath)))
                        deletedAll = false;
                }
                // ignore rogue files
                else { }
            }));
            if (deletedAll)
                await new Promise((resolve, reject) => fs.rmdir(dir, err => err ? reject(err) : resolve()));
            return deletedAll;
        };
        await removeNonPackageDirs(this.config.pjson.packages);
        if (save)
            return await this.config.save();
    }
}
exports.Installer = Installer;
function depsToInstalls(defaultRegistry, optional, deps, parent, skipDepsNames) {
    let installs = [];
    if (deps.dependencies)
        Object.keys(deps.dependencies).forEach(name => {
            if (skipDepsNames && skipDepsNames.indexOf(name) !== -1)
                return;
            let target = deps.dependencies[name];
            if (target) {
                if (typeof target !== 'string' && !target.registry)
                    target = target.fromRegistry(defaultRegistry);
                installs.push({
                    name,
                    parent,
                    target,
                    type: package_1.DepType.secondary
                });
            }
        });
    if (deps.peerDependencies)
        Object.keys(deps.peerDependencies).forEach(name => {
            if (skipDepsNames && skipDepsNames.indexOf(name) !== -1)
                return;
            let target = deps.peerDependencies[name];
            if (target) {
                if (typeof target !== 'string' && !target.registry)
                    target = target.fromRegistry(defaultRegistry);
                installs.push({
                    name,
                    parent,
                    target,
                    type: package_1.DepType.peer
                });
            }
        });
    if (optional && deps.optionalDependencies)
        Object.keys(deps.optionalDependencies).forEach(name => {
            if (skipDepsNames && skipDepsNames.indexOf(name) !== -1)
                return;
            let target = deps.optionalDependencies[name];
            if (target) {
                if (typeof target !== 'string' && !target.registry)
                    target = target.fromRegistry(defaultRegistry);
                installs.push({
                    name,
                    parent,
                    target,
                    type: package_1.DepType.secondary
                });
            }
        });
    return installs;
}
function getResourceName(source, projectPath) {
    // if the resource is a folder, check the package.json file
    if (source.startsWith('file:') || source.startsWith('link:')) {
        const pjsonPath = path.resolve(projectPath, source.substr(5), 'package.json');
        let pjsonSource;
        try {
            pjsonSource = fs.readFileSync(pjsonPath).toString();
        }
        catch (err) { }
        if (pjsonSource) {
            let pjson;
            try {
                pjson = JSON.parse(pjsonSource);
            }
            catch (err) {
                throw new common_1.JspmUserError(`Invalid JSON parsing ${common_1.highlight(pjsonPath)}.`);
            }
            if (typeof pjson.name === 'string')
                return pjson.name;
        }
        source = source.substr(0, 5) + path.resolve(projectPath, source.substr(5));
    }
    // get name simply from end of resource name
    // name will be validated on install
    const refIndex = source.lastIndexOf('#');
    if (refIndex === -1) {
        let pathIndex = source.lastIndexOf('/');
        if (pathIndex === -1)
            pathIndex = source.lastIndexOf('\\');
        if (pathIndex === -1)
            return source.substr(source.indexOf(':') + 1);
        else
            return source.substr(pathIndex + 1);
    }
    else {
        let pathIndex = source.lastIndexOf('/', refIndex - 1);
        if (pathIndex === -1)
            pathIndex = source.lastIndexOf('\\', refIndex - 1);
        if (pathIndex === -1)
            return source.substring(source.indexOf(':') + 1, refIndex);
        else
            return source.substring(pathIndex + 1, refIndex);
    }
}
//# sourceMappingURL=index.js.map