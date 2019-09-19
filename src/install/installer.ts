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

import { PackageConfig, readPackageConfig } from "./package";
import path = require('path');
import rimraf = require('rimraf');
import mkdirp = require('mkdirp');
import { isCheckoutSource, readGitSource } from "./source";
import { highlight, JspmUserError, bold, JspmError } from "../utils/common";
import { writeBinScripts } from "./bin";
import { Project } from "../project";
import fs = require('fs');
import { isGitRepo, setLocalHead } from "./git";
import ncp = require('ncp');

export async function install (project: Project, source: string, override: PackageConfig | void, fullVerification: boolean = false): Promise<{
  config: PackageConfig;
  override: PackageConfig | void;
  writePackage: (packageName: string) => Promise<boolean>;
}> {
  const checkoutSource = isCheckoutSource(source);
  if (checkoutSource) {
    if (override) {
      project.log.warn(`The override for ${highlight(source)} is not being applied as it is a checked-out package. Rather edit the original package.json file directly instead of applying an override.`);
      override = undefined;
    }
    if (source.startsWith('file:')) {
      const dir = path.resolve(project.projectPath, source.slice(5));
      const config = await readPackageConfig(dir);
      return {
        config,
        override: undefined,
        async writePackage (packageName: string) {
          const changed = setPackageToSymlink(project, packageName, source, dir, fullVerification);
          await createBins(project, config, packageName);
          return changed;
        }
      };
    }
    // fallthrough for git sources
  }
  const installResult = await project.registryManager.ensureGlobalInstall(source, override, fullVerification);
  return {
    config: installResult.config,
    override: installResult.override,
    async writePackage (packageName: string) {
      const changed = await (checkoutSource ? setPackageToClone : setPackageToSymlink)(project, packageName, source, path.resolve(project.globalPackagesPath, installResult.hash), fullVerification) || installResult.changed;
      await createBins(project, installResult.config, packageName);
      return changed;
    }
  };
}

export async function createBins (project: Project, config: PackageConfig, resolvedPkgName: string) {
  // NB we should create a queue based on precedence to ensure deterministic ordering
  // when there are namespace collissions, but this problem will likely not be hit for a while
  if (config.bin) {
    const binDir = path.join(project.config.pjson.packages, '.bin');
    await new Promise((resolve, reject) => mkdirp(binDir, err => err ? reject(err) : resolve(binDir)));
    await Promise.all(Object.keys(config.bin).map(p => 
      writeBinScripts(binDir, p, resolvedPkgName.replace(':', path.sep) + path.sep + config.bin[p])
    ));
  }
}

async function clearPackage (project: Project, pkgName: string, pkgPath: string, linkPath: string | void, force: boolean) {
  if (linkPath === undefined) {
    if (!force)
      throw new JspmError(`Unable to write package ${highlight(pkgName)} as it is already a custom checked-out package. Add the ${bold('-f')} flag to force removal.`);
    project.log.info(`Removing checked out package ${highlight(pkgName)}.`);
    await new Promise((resolve, reject) => rimraf(pkgPath, err => err ? reject(err) : resolve()));
  }
  else {
    project.log.info(`Replacing custom symlink for ${highlight(pkgName)}.`);
    await new Promise((resolve, reject) => fs.unlink(pkgPath, err => err ? reject(err) : resolve()));
  }
}

async function setPackageToSymlink (project: Project, pkgName: string, _source: string, symlinkPath: string, force: boolean): Promise<boolean> {
  const pkgPath = path.join(project.config.pjson.packages, pkgName.replace(':', path.sep));
  const { linkPath, exists } = await getPackageLinkState(pkgPath);

  if (linkPath === symlinkPath + path.sep)
    return false;

  if (exists)
    await clearPackage(project, pkgName, pkgPath, linkPath, force);
  else
    await new Promise((resolve, reject) => mkdirp(path.dirname(pkgPath), err => err ? reject(err) : resolve()));

  await new Promise((resolve, reject) => fs.symlink(path.relative(path.dirname(pkgPath), symlinkPath), pkgPath, 'junction', err => err ? reject(err) : resolve()));
  return true;
}

export async function getPackageLinkState (pkgPath: string): Promise<{
  exists: boolean,
  linkPath: string | void
}> {
  try {
    return {
      exists: true,
      linkPath: await new Promise((resolve, reject) => fs.readlink(pkgPath, (err, link) => err ? reject(err) : resolve(link)))
    };
  }
  catch (e) {
    if (e.code === 'ENOENT')
      return { exists: false, linkPath: undefined };
    if (e.code === 'EINVAL' || e.code === 'UNKNOWN')
      return { exists: true, linkPath: undefined };
    throw e;
  }
}

async function setPackageToClone (project: Project, pkgName: string, source: string, globalClone: string, force: boolean): Promise<boolean> {
  const pkgPath = path.join(project.config.pjson.packages, pkgName.replace(':', path.sep));

  if (isGitRepo(pkgPath)) {
    const { ref } = readGitSource(source);
    return await setLocalHead(project, pkgPath, globalClone, ref, force);
  }
  else {
    const { exists, linkPath } = await getPackageLinkState(pkgPath);
    if (exists)
      await clearPackage(project, pkgName, pkgPath, linkPath, force);
    else
      await new Promise((resolve, reject) => mkdirp(path.dirname(pkgPath), err => err ? reject(err) : resolve()));
    
    // otherwise just do a full copy of the global clone
    await new Promise((resolve, reject) => ncp(globalClone, pkgPath, err => err ? reject(err) : resolve()));
    return true;
  }  
}
