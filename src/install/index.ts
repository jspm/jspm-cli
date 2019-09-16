/*
 *   Copyright 2014-2019 Guy Bedford (http://guybedford.com)
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

import Config from '../config';
import { Project } from '../api';
import RegistryManager from './registry-manager';
import { Semver, SemverRange } from 'sver';
import path = require('path');
import { PackageName, PackageTarget, ExactPackage, parseExactPackageName, serializePackageName, PackageConfig, DepType, Dependencies,
    ResolveTree, processPackageConfig, overridePackageConfig, processPackageTarget, resourceInstallRegEx, validateOverride } from './package';
import { readJSON, JspmUserError, bold, highlight, JspmError, isWindows, validAliasRegEx } from '../utils/common';
import fs = require('graceful-fs');
import rimraf = require('rimraf');
import mkdirp = require('mkdirp');
import { writeBinScripts } from './bin';
import globalOverrides from '../overrides';
import { isCheckoutSource, gitCheckout } from './source';

const fileInstallRegEx = /^(\.[\/\\]|\.\.[\/\\]|\/|\\|~[\/\\])/;

export interface InstallOptions {
  edge?: boolean; // allow installing prerelease ranges
  lock?: boolean; // existing dependency installs remain locked, new ones get deduped
  latest?: boolean; // all dependencies loaded to latest version with no deduping
  dedupe?: boolean;
  // optional?: boolean; // install optional dependencies
  force?: boolean; // resets checked out and linked packages, force checks internal caches
  exact?: boolean; // install to exact version
};

export interface Install {
  name: string;
  parent: string | void;
  target: PackageTarget | string;
  type: DepType;
  override?: PackageConfig | void;
};

interface PackageInstall extends Install {
  target: PackageTarget;
};

interface ResourceInstall extends Install {
  target: string;
};

interface PackageInstallState {
  exists: boolean;
  hash: string | void;
  linkPath: string | void;
  gitRemotes: string[] | void;
};

export class Installer {
  binFolderChecked: boolean;
  private opts: InstallOptions;
  private project: Project;
  private config: Config;
  private registryManager: RegistryManager;
  private installTree: ResolveTree;
  private primaryType: DepType;
  // we install one "top-level" operation at a time
  // so no need to track individual completions
  private installs: {
    [name: string]: Promise<void>
  };
  private sourceInstalls: {
    [name: string]: Promise<PackageConfig | void>
  };

  offline: boolean;
  preferOffline: boolean;

  private secondaryRanges: {
    [parent: string]: {
      [name: string]: PackageTarget | string;
    }
  };
  private primaryRanges: {
    [name: string]: {
      type: DepType;
      target: PackageTarget | string;
    }
  };
  private jspmPackageInstallStateCache: {
    [path: string]: PackageInstallState
  };
  private globalPackagesPath: string;
  private changed: boolean;
  private busy: boolean;
  private updatePrimaryRanges: boolean;

  constructor (project: Project) {
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

  dispose () {

  }

  ensureNotBusy () {
    if (this.busy)
      throw new JspmUserError('Installer can only install a single top-level install operation at once.');    
  }

  async update (selectors: string[], opts: InstallOptions) {
    let updateInstalls: Install[] = [];
    selectors.forEach(selector => {
      let matches = this.installTree.select(selector);
      if (!matches.length)
        throw new JspmUserError(`Package ${bold(selector)} is not an installed package.`);
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
          const exactName = serializePackageName(exactResolution);
          if (exactNames.indexOf(exactName) === -1)
            exactNames.push(exactName);
        });
        if (exactNames.length > 1)
          throw new JspmUserError(`Ambiguous update package ${bold(selector)} matches multiple packages: ${exactNames.map(name => highlight(name)).join(', ')}.`);
      }
      
      matches.forEach(match => {
        const { name, parent } = match;
        updateInstalls.push({
          name,
          parent,
          type: DepType.primary,
          target: undefined
        });
      });
    });

    await this.ensureInstallRanges();

    updateInstalls.forEach(install => {
      if (!install.parent) {
        const parentRanges = this.primaryRanges[install.name];
        if (!parentRanges)
          throw new JspmUserError(`Unable to detect an install range for ${bold(install.name)}.`);
        install.type = parentRanges.type;
        install.target = parentRanges.target;
      }
      else {
        const parentObj = this.secondaryRanges[install.parent];
        install.target = parentObj && parentObj[install.name];
        if (!install.target)
          throw new JspmUserError(`Unable to detect an install range for ${bold(install.name)} in ${highlight(install.parent)}.`);
      }
    });
    opts.latest = true;
    return this.install(updateInstalls, opts);
  }

  async link (pkg: string, source: string, opts: InstallOptions) {
    const linkSource = await this.registryManager.resolveSource(source, this.project.projectPath, this.project.projectPath);

    const linkInstall = {
      name: undefined,
      parent: undefined,
      target: undefined,
      type: undefined
    };
    let linkPkg: ExactPackage;

    // find exact or unique matching package in the tree, throwing if not found
    try {
      linkPkg = parseExactPackageName(pkg);
    }
    catch (e) {}

    // not a full package name -> select for best name match
    if (!linkPkg) {
      let matches = this.installTree.select(pkg);
      if (!matches.length)
        throw new JspmUserError(`Package ${bold(pkg)} is not an installed package. Either reference an existing installed package or provide the full package name to link into of the form ${bold('<registry:name@version>')}`);
      // if a secondary, ensure that they all coalesce to the same package
      const exactNames = [];
      matches.forEach(match => {
        const exactResolution = match.parent ? this.installTree.dependencies[match.parent].resolve[match.name] : this.installTree.resolve[match.name];
        linkPkg = exactResolution;
        const exactName = serializePackageName(exactResolution);
        if (exactNames.indexOf(exactName) === -1)
          exactNames.push(exactName);
      });
      if (exactNames.length > 1)
        throw new JspmUserError(`Ambiguous link package ${bold(pkg)} matches multiple packages: ${exactNames.map(name => highlight(name)).join(', ')}.`);
      
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
    })) {}
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
    })) {}
    // not existing at all
    // -> new primary install to linked
    else {
      linkInstall.type = DepType.primary; // check opts type?
      linkInstall.target = new PackageTarget(linkPkg.registry, linkPkg.name, linkPkg.version);
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
        linkInstall.type = DepType.primary;
        linkInstall.target = new PackageTarget(linkPkg.registry, linkPkg.name, linkPkg.version);
      }
    }

    // source set through lock for existing "link over" cases
    const linkPkgName = serializePackageName(linkPkg);
    const linkPkgResolved = this.installTree.dependencies[linkPkgName] = this.installTree.dependencies[linkPkgName] || { source: undefined, resolve: {} };
    linkPkgResolved.source = linkSource;

    opts.lock = true;
    return this.install([linkInstall], opts);
  }

  async checkout (selectors: string[]) {
    const checkouts = [];
    selectors.forEach(selector => {
      let matches = this.installTree.select(selector);
      if (!matches.length)
        throw new JspmUserError(`Package ${bold(selector)} is not an installed package.`);
      // if a secondary, ensure that they all coalesce to the same package
      const exactNames = [];
      matches.forEach(match => {
        const exactResolution = match.parent ? this.installTree.dependencies[match.parent].resolve[match.name] : this.installTree.resolve[match.name];
        const exactName = serializePackageName(exactResolution);
        if (exactNames.indexOf(exactName) === -1)
          exactNames.push(exactName);
      });
      if (exactNames.length > 1)
        throw new JspmUserError(`Ambiguous checkout package ${bold(selector)} matches multiple packages: ${exactNames.map(name => highlight(name)).join(', ')}.`);
      checkouts.push(exactNames[0]);
    });

    await Promise.all(checkouts.map(async checkoutName => {
      const registryIndex = checkoutName.indexOf(':');

      const packageInstallState = await this.getPackageInstallState(checkoutName);
      let stopReason = '';
      if (!packageInstallState.exists)
        stopReason = 'is not installed';
      else if (packageInstallState.linkPath)
        stopReason = 'is already linked';
      // skip if already checked out
      else if (!packageInstallState.hash)
        return this.project.log.ok(`Package ${highlight(checkoutName)} is already checked out.`);

      let repo;
      if (!stopReason) {
        const checkoutPath = path.join(this.config.pjson.packages, checkoutName.substr(0, registryIndex), checkoutName.substr(registryIndex + 1));
        const config = await this.readPackageConfig(checkoutPath);
        if (!config) {
          stopReason = `has no package configuration. Use "jspm link ${checkoutName} clone:..." instead`;
        }
        else {
          repo = config.repository && config.repository.url;
          if (!repo)
            stopReason = `has no repository configuration. Use "${bold(`jspm link ${checkoutName} clone:...`)}" instead`;
        }
      }
      if (stopReason)
        throw new JspmUserError(`Unable to checkout ${highlight(checkoutName)} as it ${stopReason}.`);

      if (repo.startsWith('git://'))
        repo = repo.slice(6).replace('/', ':');
      await this.link(checkoutName, 'clone:' + repo, {});
      this.project.log.ok(`Checked out package ${highlight(checkoutName)} for local modifications.`);
    }));
  }

  async uninstall (names: string[]) {
    this.ensureNotBusy();
    this.busy = true;
    if (names.length === 0)
      throw new JspmUserError(`No package provided to uninstall.`);
    names.forEach(name => {
      if (!this.primaryRanges[name])
        throw new JspmUserError(`Package ${bold(name)} doesn\'t match any existing top-level installed packages.`);
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
  async install (installs: Install[], opts: InstallOptions) {
    this.ensureNotBusy();
    this.busy = true;

    this.opts = opts;
    this.changed = false;

    if (this.opts.dedupe !== false)
      this.opts.dedupe = !this.opts.lock;

    this.primaryType = installs.length === 0 ? DepType.primary : installs[0].type;

    // no installs, install from package.json
    if (installs.length === 0) {
      // maintain existing package.json ranges
      if (!this.opts.latest)
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
        else if (!target.match(resourceInstallRegEx)) {
          let registryIndex = target.indexOf(':');
          let targetString = target;
          // a/b -> github:a/b sugar
          if (registryIndex === -1 && target.indexOf('/') !== -1 && target[0] !== '@')
            targetString = 'github:' + target;
          if (registryIndex === -1)
            targetString = ':' + targetString;
          install.target = processPackageTarget(install.name, targetString, this.project.defaultRegistry);
        }
      }

      // auto-generate name from target if necessary
      if (!install.name) {
        if (typeof install.target !== 'string') {
          const idx = install.target.name.lastIndexOf(':') + 1;
          const substr = install.target.name.substr(idx);
          if (substr.match(validAliasRegEx))
            install.name = substr;
          else
            install.name = substr.split('/').pop();
        }
        else {
          install.name = getResourceName(install.target, this.project.projectPath);
        }
      }
      if (!install.name.match(validAliasRegEx))
        throw new JspmUserError(`Invalid name ${bold(install.name)} for install to ${highlight(install.target.toString())}`);
      if (typeof install.target === 'string')
        return this.resourceInstall(<ResourceInstall>install);
      else
        return this.packageInstall(<PackageInstall>install);
    }));

    await this.clean();

    const configChanged = this.config.save();
    this.busy = false;
    return configChanged || this.changed;
  }

  // most general override applies (greater containing range)
  // we first check this.config.pjson.overrides, followed by globalOverrides
  private getOverride (pkg: ExactPackage | string, cut = false): PackageConfig | void {
    if (typeof pkg === 'string') {
      const matchIndex = this.config.pjson.overrides.findIndex(({ target }) => target === pkg);
      const match = this.config.pjson.overrides[matchIndex];
      if (cut && matchIndex !== -1 && !match.fresh)
        this.config.pjson.overrides.splice(matchIndex, 1);
      return match && match.override;
    }
    else {
      let bestTargetIndex = -1;
      let bestTarget: PackageTarget | void;
      let bestOverride: PackageConfig | void;
      let bestIsFresh: boolean;
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
      if (!bestOverride) {
        const pkgs = globalOverrides[pkg.registry];
        if (pkgs) {
          const versions = pkgs[pkg.name];
          if (versions) {
            let bestTargetRange: SemverRange;
            for (const v in versions) {
              const range = new SemverRange(v);
              if (range.has(pkg.version)) {
                if (!bestTarget || range.gt(bestTargetRange)) {
                  bestTargetRange = range;
                  bestOverride = processPackageConfig(versions[v]);
                }
              }
            }
          }
        }
      }
      return bestOverride;
    }
  }

  // get an override and remove it from the override list in the process
  // this way an override saved back does not result in duplication
  private cutOverride (pkg: ExactPackage | string): PackageConfig | void {
    return this.getOverride(pkg, true);
  }

  private setOverride (pkgTarget: PackageTarget | string, override: PackageConfig) {
    this.config.pjson.overrides.push({
      target: pkgTarget,
      override,
      fresh: true
    });
  }

  private async packageInstall (install: PackageInstall): Promise<void> {
    // first check if already doing this install, to avoid redoing work
    // this in turn catches circular installs on the early returns
    const installId = `${install.type === DepType.peer ? undefined : install.parent}|${install.name}`;
    const existingPackageInstall = this.installs[installId];
    if (existingPackageInstall)
      return;
    
    return this.installs[installId] = (async () => {
      this.project.log.debug(`Installing ${install.name}${install.parent ? ` for ${install.parent}` : ``}`);
  
      // install information
      let target = install.target;
      let override: PackageConfig | void = install.override && validateOverride(install.override, install.name) && processPackageConfig(install.override);
      let source: string;
  
      let resolvedPkg: ExactPackage;

      const existingPkg = this.installTree.getResolution(install);

      // if a lock install, use existing resolution
      if (this.opts.lock)
        resolvedPkg = existingPkg;

      // if a non-latest secondary install, use existing resolution or find the best match in the tree
      else if (install.type === DepType.secondary && !this.opts.latest)
        resolvedPkg = existingPkg || this.installTree.getBestMatch(target);
      
      if (resolvedPkg) {
        const existingResolutionName = serializePackageName(resolvedPkg);
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
          target = new PackageTarget(resolvedPkg.registry, resolvedPkg.name, resolvedPkg.version);
        }
      }
      // update install of 
      else if (existingPkg && this.opts.latest) {
        const existingPkgName = serializePackageName(existingPkg);
        const existingResolved = this.installTree.dependencies[serializePackageName(existingPkgName)];
        if (isCheckoutSource(existingResolved.source)) {
          resolvedPkg = existingPkg;
          // check the checkout source exists
          const pkgPath = path.join(this.config.pjson.packages, existingPkgName.replace(':', path.sep));
          let config = await this.readPackageConfig(pkgPath);
          if (config && config.version !== existingPkg.version) {
            resolvedPkg = {
              registry: resolvedPkg.registry,
              name: resolvedPkg.name,
              version: config.version,
              semver: new Semver(config.version)
            };
            await new Promise((resolve, reject) =>
              fs.rename(pkgPath, path.join(this.config.pjson.packages, serializePackageName(resolvedPkg).replace(':', path.sep)), err => err ? reject(err) : resolve())
            );
            this.setResolution(install, target, resolvedPkg, existingResolved.source);
          }
          return;
        }
      }

      // run resolver lookup
      let resolution: {
        pkg: ExactPackage,
        target: PackageName,
        source: string,
        override: PackageConfig | void,
        deprecated: string
      };
      try {
        resolution = await this.registryManager.resolve(target, override, this.opts.edge);
      }
      catch (e) {
        throw new JspmError(`Resolving ${highlight(serializePackageName(target))}`, undefined, e);
      }

      if (!resolution)
        throw new JspmUserError(`No resolution found for ${highlight(serializePackageName(target).replace(/\@\*$/, ''))}${this.offline ? ' (offline)' : ''}.`);

      resolvedPkg = resolution.pkg;
      source = resolution.source;
      override = resolution.override;

      // if there was no install override, get any override from package.json
      if (!install.override) {
        const existingOverride = this.cutOverride(resolvedPkg);
        if (existingOverride) {
          if (override)
            overridePackageConfig(override, existingOverride);
          else
            override = Object.assign({}, existingOverride);
        }
      }

      // immediately store the resolution if necessary
      target = this.setResolution(install,
          new PackageTarget(resolution.target.registry, resolution.target.name, resolution.target.version), resolution.pkg, source);

      // upgrade anything to this resolution which can (this is the orphaning)
      if (this.opts.dedupe)
        this.upgradePackagesTo(resolvedPkg).catch(() => {});
      
      const sourceInstallPromise = this.sourceInstall(resolvedPkg, source, override, resolution && resolution.deprecated);
      if (sourceInstallPromise) {
        // override from resolve replaces any existing package.json override which is not used
        override = await sourceInstallPromise;
        if (override)
          this.setOverride(target, override);
      }
    })();
  }

  private sourceInstall (resolvedPkg: ExactPackage, source: string, override: PackageConfig | void, deprecated: string | void): Promise<PackageConfig | void> | void {
    const resolvedPkgName = serializePackageName(resolvedPkg);

    const sourceInstallId = `${resolvedPkgName}|${source}`;

    let existingSourceInstall = this.sourceInstalls[sourceInstallId];
    // avoid circular (ok since a single install tree)
    if (existingSourceInstall)
      return;

    return this.sourceInstalls[sourceInstallId] = (async () => {
      if (isCheckoutSource(source)) {
        if (source.startsWith('file:')) {
          if (await this.setPackageToSymlink(resolvedPkgName, path.resolve(this.project.projectPath, source.slice(5))))
            this.changed = true;
        }
        else if (source.startsWith('clone:')) {
          if (await this.setPackageToClone(resolvedPkgName, source.slice(6)))
            this.changed = true;
        }
        const pkgPath = path.join(this.config.pjson.packages, resolvedPkgName.replace(':', path.sep));
        let config = await this.readPackageConfig(pkgPath);
        if (override) {
          ({ config, override } = overridePackageConfig(config, override));
          if (override)
            this.project.log.warn(`The override for ${highlight(resolvedPkgName)} is not being applied as it is a checked-out package. Rather edit the original package.json file directly instead of applying an override.`);
        }
        return this.installDependencies(config, resolvedPkgName, source);
      }

      // install
      try {
        var installResult = await this.registryManager.ensureInstall(source, override, this.opts.force);
      }
      catch (e) {
        const errMsg = `Unable to install ${highlight(resolvedPkgName)}.`;
        if (e instanceof JspmUserError)
          throw new JspmUserError(errMsg, undefined, e);
        else
          throw new JspmError(errMsg, undefined, e);
      }

      if (installResult.changed)
        this.changed = true;
      
      let config, hash;
      ({ config, override, hash } = installResult);

      await Promise.all([
        // install dependencies, skipping already preloaded
        this.installDependencies(config, resolvedPkgName, source),

        // symlink to the global install
        (async () => {
          if (await this.setPackageToHash(resolvedPkgName, hash)) {
            this.changed = true;
            
            // only show deprecation message on first install into jspm_packages
            if (deprecated)
              this.project.log.warn(`Deprecation warning for ${highlight(resolvedPkgName)}: ${bold(deprecated)}`);
          }
        })(),

        this.createBins(config, resolvedPkgName)
      ]);

      return override;
    })();
  }

  private async createBins (config: PackageConfig, resolvedPkgName: string) {
    // NB we should create a queue based on precedence to ensure deterministic ordering
    // when there are namespace collissions, but this problem will likely not be hit for a while
    if (config.bin) {
      const binDir = path.join(this.config.pjson.packages, '.bin');
      if (!this.binFolderChecked) {
        await new Promise((resolve, reject) => mkdirp(binDir, err => err ? reject(err) : resolve(binDir)));
        this.binFolderChecked = true;
      }
      await Promise.all(Object.keys(config.bin).map(p => 
        writeBinScripts(binDir, p, resolvedPkgName.replace(':', path.sep) + path.sep + config.bin[p])
      ));
    }
  }

  // resource install is different to source install in that
  // we need to normalize the source string into resolved form and
  // we need to install first to find out the name of the package
  private async resourceInstall (install: ResourceInstall): Promise<void> {
    // first check if already doing this install, to avoid redoing work
    // this in turn catches circular installs on the early returns
    const installId = `${install.type === DepType.peer ? undefined : install.parent}|${install.name}`;
    const existingPackageInstall = this.installs[installId];
    if (existingPackageInstall)
      return;

    return this.installs[installId] = (async () => {
      let override = (install.override as PackageConfig) || this.cutOverride(install.target);

      // handle lock lookups for resourceInstall
      const existingResolution = this.installTree.getResolution(install);
      if (existingResolution) {
        const existingResolutionName = serializePackageName(existingResolution);
        const existingResolved = this.installTree.dependencies[existingResolutionName];

        if (existingResolved && existingResolved.source && existingResolved.source === install.target) {
          this.project.log.debug(`${install.name} matched against existing install`);
          this.setResolution(install, install.target, existingResolution, existingResolved.source);
          override = await this.sourceInstall(existingResolution, existingResolved.source, override, undefined);
          if (override)
            this.setOverride(install.target, override);
          return;
        }
      }

      this.project.log.debug(`Installing resource ${install.name}${install.parent ? ` for ${install.parent}` : ``}`);
      const parentPath = install.parent && install.type !== DepType.peer ? path.join(this.config.pjson.packages, install.parent.replace(':', path.sep)) : this.project.projectPath;

      // first normalize the source
      try {
        var source = await this.registryManager.resolveSource(install.target, parentPath, this.project.projectPath);
      }
      catch (e) {
        const errMsg = `Unable to locate ${highlight(install.target)}.`;
        if (e instanceof JspmUserError)
          throw new JspmUserError(errMsg, undefined, e);
        else
          throw new JspmError(errMsg, undefined, e);
      }

      let config, hash, linkPath;
      let registry, name, version;

      // link
      const isLink = isCheckoutSource(source);
      if (isLink) {
        if (source.startsWith('clone:'))
          throw new JspmUserError(`Clone source ${highlight(source)} cannot be installed directly.`);
        linkPath = path.resolve(this.project.projectPath, source.slice(5));
        config = await this.readPackageConfig(linkPath);
        if (override) {
          ({ config, override } = overridePackageConfig(config, override));
          if (override)
            this.project.log.warn(`The override for ${highlight(install.target)} is not being applied as it is a checked-out package. Rather edit the original package.json file directly instead of applying an override.`);
        }
        registry = config.registry || this.project.defaultRegistry;
        name = config.name || install.name;
        version = config.version;
      }
      // install
      else {
        try {
          var installResult = await this.registryManager.ensureInstall(source, override, this.opts.force);
        }
        catch (e) {
          const errMsg = `Unable to install ${source}.`;
          if (e instanceof JspmUserError)
            throw new JspmUserError(errMsg, undefined, e);
          else
            throw new JspmError(errMsg, undefined, e);
        }

        if (installResult.changed)
          this.changed = true;
        
        ({ config, override, hash } = installResult);

        registry = config.registry || this.project.defaultRegistry;
        name = config.name || install.name;
        version = config.version;
        if (!version) {
          let refIndex = install.target.lastIndexOf('#');
          if (refIndex !== -1)
            version = install.target.substr(refIndex + 1);
        }
      }

      if (this.project.userInput) {
        if (!registry) registry = 'npm';        
        if (!version)
          version = await this.project.input(`Enter the ${bold('version')} to ${isLink ? 'link' : 'install'}`, 'master', {
            info: `Version not available for ${install.target}.`,
            validate: (input: string) => {
              if (!input)
                return 'A version must be provided.';
            }
          });
      }
      else {
        let missing = !registry && 'registry' || !name && 'name' || !version && 'version';
        if (missing) {
          throw new JspmUserError(`Unable to ${isLink ? `link ${linkPath}` : `install resource target ${install.target}`} as no ${bold(missing)} property is provided. This should be set in the original package.json or be added with an override to the install if necessary.`)
        }
      }

      const resolvedPkgName = `${registry}:${name}@${version}`;
      const resolvedPkg = parseExactPackageName(resolvedPkgName);

      // save resolution
      this.setResolution(install, install.target, resolvedPkg, source);
      if (override)
        this.setOverride(install.target, override);

      await Promise.all([
        this.installDependencies(config, resolvedPkgName, source),
        (async () => {
          if (isLink) {
            if (await this.setPackageToSymlink(resolvedPkgName, linkPath))
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

  private async installDependencies (config: PackageConfig, resolvedPkgName: string, source: string, preloadedDepNames?: string[]): Promise<void> {
    const registry = config.registry || this.project.defaultRegistry;
    const preLoad = preloadedDepNames !== undefined && preloadedDepNames.length !== 0;
    try {
      await Promise.all(depsToInstalls.call(this, registry, config, resolvedPkgName, source, preLoad === false && preloadedDepNames).map(install => {
        if (preLoad && preloadedDepNames)
          preloadedDepNames.push(install.name);
        if (typeof install.target === 'string')
          return this.resourceInstall(<ResourceInstall>install);
        else
          return this.packageInstall(<PackageInstall>install);
      }));
    }
    catch (e) {
      throw new JspmError(`Installing ${highlight(resolvedPkgName)}.`, undefined, e);
    }
  }

  private setResolution (install: Install, target: string, resolution: PackageName, source: string): string;
  private setResolution (install: Install, target: PackageTarget, resolution: PackageName, source: string): PackageTarget;
  private setResolution (install: Install, target: PackageTarget | string, resolution: PackageName, source: string): PackageTarget | string {
    const exactResolution = {
      registry: resolution.registry,
      name: resolution.name,
      version: resolution.version,
      semver: new Semver(resolution.version)
    };
    const resolutionString = serializePackageName(resolution);

    if (!install.parent || install.type === DepType.peer) {
      this.installTree.resolve[install.name] = exactResolution;
      // only write in targets when primary range is empty
      const existingRange = this.primaryRanges[install.name];
      if (!existingRange || this.updatePrimaryRanges === true) {
        if (typeof target !== 'string') {
          if (target.range.isExact || this.opts.exact)
            target = target.fromVersion(resolution.version);
          if (Semver.isValid(resolution.version)) {
            if (target.range.isMajor || target.range.isWildcard)
              target = target.fromVersion('^' + resolution.version);
            else if (target.range.isStable)
              target = target.fromVersion('~' + resolution.version);
          }
          else {
            target = new PackageTarget(resolution.registry, resolution.name, resolution.version);
          }
        }
        this.changed = true;
        if (this.updatePrimaryRanges && !install.parent) {
          this.primaryRanges[install.name] = { type: install.type, target };
        }
        else {
          const existingPrimaryAndNotDev = this.primaryRanges[install.name] && 
              (this.primaryRanges[install.name].type === DepType.peer || this.primaryRanges[install.name].type === DepType.primary);
          // peerDependencies install as devDependencies
          const type = existingPrimaryAndNotDev ? this.primaryRanges[install.name].type
              : install.type === DepType.peer ? DepType.dev
              : install.parent ? this.primaryType
              : install.type;
          this.primaryRanges[install.name] = { type, target };
        }
      }
    }
    else {
      const parentRecord = this.installTree.dependencies[install.parent];
      if (!parentRecord)
        throw new JspmError(`No parent in tree for resolution ${resolutionString}.`);
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

  public getPackagePath (name: string) {
    const resolvedPkgName = serializePackageName(this.config.jspm.installed.resolve[name]);
    const registryIndex = resolvedPkgName.indexOf(':');
    return path.join(this.config.pjson.packages, resolvedPkgName.substr(0, registryIndex), resolvedPkgName.substr(registryIndex + 1));
  }

  private async readPackageConfig (pkgPath: string): Promise<any | void> {
    const json = await readJSON(path.join(pkgPath, 'package.json'));
    if (!json)
      return;
    return processPackageConfig(json);
  }

  // upgrades any packages in the installing or installed tree to the newly added resolution
  private async upgradePackagesTo (upgradePkg: ExactPackage) {
    await this.ensureInstallRanges(upgradePkg);

    await this.installTree.visit((pkg: ExactPackage, name: string, parent?: string) => {
      let range;
      if (parent) {
        const parentRanges = this.secondaryRanges[parent];
        if (!parentRanges)
          return
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

  private async setPackageToHash (pkgName: string, hash: string): Promise<boolean> {
    const packageInstallState = await this.getPackageInstallState(pkgName);

    if (packageInstallState.hash === hash)
      return false;
    
    const { exists, linkPath, hash: curHash } = packageInstallState;
    packageInstallState.exists = true;
    packageInstallState.hash = hash;
    packageInstallState.linkPath = undefined;

    const localPackagePath = path.join(this.config.pjson.packages, pkgName.replace(':', path.sep));

    if (exists) {
      if (curHash === undefined && linkPath === undefined) {
        this.project.log.info(`Removing checked out package ${highlight(pkgName)}.`);
        await new Promise((resolve, reject) => rimraf(localPackagePath, err => err ? reject(err) : resolve()));
      }
      else {
        if (linkPath !== undefined)
          this.project.log.info(`Replacing custom symlink for ${highlight(pkgName)}.`);
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

  private async setPackageToClone (pkgName: string, gitTarget: string): Promise<boolean> {
    const packageInstallState = await this.getPackageInstallState(pkgName);
    if (packageInstallState.gitRemotes) {
      if (!packageInstallState.gitRemotes.includes(gitTarget))
        this.project.log.info(`Checked out package ${highlight(pkgName)} is not currently actual clone of ${highlight(gitTarget)}.`);
      return false;
    }
    const localPackagePath = path.join(this.config.pjson.packages, pkgName.replace(':', path.sep));
    if (packageInstallState.exists) {
      if (packageInstallState.hash === undefined && packageInstallState.linkPath === undefined) {
        this.project.log.info(`Removing checked out package ${highlight(pkgName)}.`);
        await new Promise((resolve, reject) => rimraf(localPackagePath, err => err ? reject(err) : resolve()));
      }
      else {
        if (packageInstallState.linkPath !== undefined)
          this.project.log.info(`Removing custom symlink for ${highlight(pkgName)}.`);
        await new Promise((resolve, reject) => fs.unlink(localPackagePath, err => err ? reject(err) : resolve()));
      }
    }
    await gitCheckout(this.project.log, gitTarget, null, false, localPackagePath, 0);
    return true;
  }

  private async setPackageToSymlink (pkgName: string, linkPath: string): Promise<boolean> {
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

  private async packageExists (pkgName: string): Promise<boolean> {
    return (await this.getPackageInstallState(pkgName)).exists;
  }

  private async getPackageInstallState (pkgName: string): Promise<PackageInstallState> {
    let packageInstallState = this.jspmPackageInstallStateCache[pkgName];
    if (packageInstallState)
      return packageInstallState;

    const pkgPath = path.join(this.config.pjson.packages, pkgName.replace(':', path.sep));
    
    packageInstallState = {
      exists: false,
      hash: undefined,
      linkPath: undefined,
      gitRemotes: undefined
    };

    const symlinkPath = await new Promise<string>((resolve, reject) => {
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

    if (!symlinkPath) {
      packageInstallState.gitRemotes = await checkGitTarget(pkgPath);
      return this.jspmPackageInstallStateCache[pkgName] = packageInstallState;
    }
    
    packageInstallState.exists = true;

    if (symlinkPath.startsWith(this.globalPackagesPath) && symlinkPath[this.globalPackagesPath.length] === path.sep) {
      const pathHash = symlinkPath.substring(this.globalPackagesPath.length + 1, symlinkPath.length - 1);
      if (pathHash.indexOf(path.sep) === -1) {
        packageInstallState.hash = pathHash;
        return this.jspmPackageInstallStateCache[pkgName] = packageInstallState;
      }
    }

    packageInstallState.gitRemotes = await checkGitTarget(pkgPath);

    if (symlinkPath !== pkgPath)
      packageInstallState.linkPath = symlinkPath;

    return this.jspmPackageInstallStateCache[pkgName] = packageInstallState;
  }

  private async ensureInstallRanges (exactPkg?: ExactPackage) {
    await this.installTree.visitAsync(async (pkg: ExactPackage, name: string, parent?: string) => {
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
        config = await this.readPackageConfig(path.join(this.config.pjson.packages, parent.replace(':', path.sep)));
      }
      else {
        // no source -> ignore
        if (!parentDepObj || !parentDepObj.source)
          return;
  
        // fail gracefully eg for offline
        try {
          // we dont verify, reset or alter overrides here because we want to be minimally invasive outside of the direct install tree
          const override = this.getOverride(parseExactPackageName(parent));
          var installResult = await this.registryManager.ensureInstall(parentDepObj.source, override, false);
        }
        catch (e) {
          return;
        }
  
        // we dont persist the updated override or check the jspm_packages symlink, because we dont want to
        // alter in any way installed packages not directly on the install tree -> aiming for principle of least surprise to user
        if (installResult.changed)
          this.changed = true;
        ({ config } = installResult);
      }
  
      const rangeTarget = config.dependencies && config.dependencies[name] ||
          config.peerDependencies && config.peerDependencies[name] ||
          config.optionalDependencies && config.optionalDependencies[name];
      
      if (!rangeTarget)
        return;
      
      this.secondaryRanges[parent] = this.secondaryRanges[parent] || {};
      this.secondaryRanges[parent][name] = processPackageTarget(name, rangeTarget, this.project.defaultRegistry, true);
    });
  }

  async clean (save = false) {
    const packageList: string[] = [];

    const addDependentPackages = (pkgName: string) => {
      packageList.push(pkgName);
      // get all immediate children of this package
      // for those children not already seen (in packages list),
      // run getDependentPackages in turn on those
      let depObj = this.installTree.dependencies[pkgName];
      if (!depObj || !depObj.resolve)
        return;
      Object.keys(depObj.resolve).forEach(dep => {
        const curPkg = depObj.resolve[dep];
        const curPkgName = serializePackageName(curPkg);
        if (packageList.indexOf(curPkgName) !== -1)
          return;
        addDependentPackages(curPkgName);
      });
    }

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
      addDependentPackages(serializePackageName(resolved));
    });

    // now that we have the package list, remove everything not in it
    Object.keys(this.installTree.dependencies).forEach(dep => {
      if (packageList.indexOf(dep) === -1) {
        this.project.log.info(`Removed ${highlight(dep)}.`);
        delete this.installTree.dependencies[dep];
      }
    });

    // depthCheck returns true to keep going (files being ignored),
    //   false to add the dir to the flat list
    const removeNonPackageDirs = async dir => {
      let files = await new Promise<string[]>((resolve, reject) => fs.readdir(dir, (err, files) => {
        if (err) {
          if (err.code === 'ENOENT')
            resolve([]);
          else
            reject(err);
        }
        else {
          resolve(files);
        }
      }));
      let deletedAll = true;
      let relPath = path.relative(this.config.pjson.packages, dir);
      let pkgBase = relPath.replace(path.sep, ':');
      if (isWindows)
        pkgBase = pkgBase.replace(/\\/g, '/');
      await Promise.all(files.map(async file => {
        let filePath = path.resolve(dir, file);
        let pkgName = pkgBase + (pkgBase.indexOf(':') === -1 ? ':' : '/') + file;

        if (packageList.indexOf(pkgName) !== -1 || pkgName === ':.bin') {
          deletedAll = false;
          return;
        }
    
        let fileInfo = await new Promise<fs.Stats>((resolve, reject) => fs.lstat(filePath, (err, stats) => err ? reject(err) : resolve(stats)));
        // package folder
        if (file.indexOf('@') > 0) {
          // warn on directory removal
          if (fileInfo.isSymbolicLink()) {
            await new Promise((resolve, reject) => fs.unlink(filePath, err => err ? reject(err) : resolve()));
          }
          else if (fileInfo.isDirectory()) {
            const remove = await this.project.confirm(`The orphaned package at ${highlight(filePath)} is currently checked out, are you sure you want to remove it?`, true);
            if (remove)
              await new Promise((resolve, reject) => rimraf(filePath, err => err ? reject(err) : resolve()));
            else
              deletedAll = false;
          }
          // ignore rogue files
          else {}
        }
        // non package folder -> traverse
        else if (fileInfo.isDirectory()) {
          if (!(await removeNonPackageDirs(filePath)))
            deletedAll = false;
        }
        // ignore rogue files
        else {}
      }));
      if (deletedAll && dir !== this.config.pjson.packages)
        await new Promise((resolve, reject) => fs.rmdir(dir, err => err ? reject(err) : resolve()));
      return deletedAll;
    }

    await removeNonPackageDirs(this.config.pjson.packages);

    if (save)
      return await this.config.save();
  }
}

function depsToInstalls (defaultRegistry: string, deps: Dependencies, parent: string, parentSource: string, skipDepsNames?: string[]): Install[] {
  let installs = [];
  if (deps.dependencies)
    Object.keys(deps.dependencies).forEach(name => {
      if (skipDepsNames && skipDepsNames.indexOf(name) !== -1)
        return;
      const target = deps.dependencies[name];
      if (target) {
        installs.push({
          name,
          parent,
          target: processPackageTarget(name, target, defaultRegistry, true),
          type: DepType.secondary
        });
      }
    });
  if (deps.peerDependencies)
    Object.keys(deps.peerDependencies).forEach(name => {
      if (skipDepsNames && skipDepsNames.indexOf(name) !== -1)
        return;
      const target = deps.peerDependencies[name];
      if (target) {
        installs.push({
          name,
          parent,
          target: processPackageTarget(name, target, defaultRegistry, true),
          type: DepType.peer
        });
      }
    });
  if (deps.optionalDependencies)
    Object.keys(deps.optionalDependencies).forEach(name => {
      if (skipDepsNames && skipDepsNames.indexOf(name) !== -1)
        return;
      const target = deps.optionalDependencies[name];
      if (target) {
        installs.push({
          name,
          parent,
          target: processPackageTarget(name, target, defaultRegistry, true),
          type: DepType.secondary
        });
      }
    });
  // if any install is a file: install, and the parent is also a file: install, resolve the link relatively
  if (parentSource.startsWith('file:')) {
    const parentLinkPath = path.resolve(this.project.projectPath, parentSource.slice(5));
    for (const install of installs) {
      if (typeof install.target === 'string' && install.target.startsWith('file:')) {
        const resolvedLinkPath = path.resolve(parentLinkPath, install.target.slice(5));
        let relPath = path.relative(this.project.projectPath, resolvedLinkPath).replace(/\\/g, '/');
        if (!relPath.startsWith('../'))
          relPath = './' + relPath;
        install.target = 'file:' + relPath;
      }
    }
  }
  return installs;
}

function getResourceName (source: string, projectPath: string): string {
  // if the resource is a folder, check the package.json file
  if (source.startsWith('file:') || source.startsWith('clone:')) {
    const pjsonPath = path.join(projectPath, source.slice(5), 'package.json');
    let pjsonSource;
    try {
      pjsonSource = fs.readFileSync(pjsonPath).toString();
    }
    catch (err) {}

    if (pjsonSource) {
      let pjson;
      try {
        pjson = JSON.parse(pjsonSource);
      }
      catch (err) {
        throw new JspmUserError(`Invalid JSON parsing ${highlight(pjsonPath)}.`);
      }

      if (typeof pjson.name === 'string')
        return pjson.name;
    }

    if (source.startsWith('clone:'))
      throw new JspmUserError(`Use ${bold('jspm checkout [name]')} or ${bold(`jspm link [name] ${source}`)} to setup a git clone install.`);

    source = source.slice(0, 5) + path.resolve(projectPath, source.slice(5));
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

// best-effort attempt to determine a git repo remote
async function checkGitTarget (packagePath: string): Promise<string[] | void> {
	const gitCfg = await new Promise<string | void>(resolve => 
		fs.readFile(path.join(packagePath, '.git', 'config'), (err, source) => err ? resolve() : resolve(source.toString()))
  );
	if (!gitCfg)
		return;

	const remotes = [];
	let remoteName;
	for (const line of gitCfg.split('\n')) {
		if (remoteName) {
			const [, remoteUrl] = line.match(/^\s*url\s*=\s*(.+)/) || [];
			if (remoteUrl) {
        if (remotes.indexOf(remoteUrl) === -1)
          remotes.push(remoteUrl);
				remoteName = undefined;
				continue;
			}
		}
		[, remoteName] = line.match(/^\s*\[remote\s*"([^"]+)"\s*\]/) || [];
	}
	return remotes;
}
