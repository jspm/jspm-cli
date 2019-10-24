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
import ConfigFile, { ValueType } from './config-file';
import * as path from 'path';
import { PackageConfig, DepType, PackageTarget, processPackageTarget,
    serializePackageTargetCanonical, parsePackageName, processPackageConfig } from '../install/package';
import { Project } from '../project';
import { bold } from '../utils/common';
import { normalizeResourceTarget } from '../install/source';

export default class PackageJson extends ConfigFile {
  private jspmPrefix: boolean;
  private depsPrefixed: boolean;
  private dir: string;
  private project: Project;

  jspmAware: boolean;
  name: string;
  version: string;
  type: string;
  src: string;
  dist: string;
  main: string;
  baseURL: string;
  packages: string;
  private: boolean;
  dependencies: {
    [name: string]: {
      type: DepType,
      target: string | PackageTarget
    }
  };
  private _dependencies: Record<string, string>;
  private _devDependencies: Record<string, string>;
  private _optionalDependencies: Record<string, string>;
  private _peerDependencies: Record<string, string>;
  overrides: { target: PackageTarget | string, override: PackageConfig, fresh: boolean }[];
  hooks: {
    [hook: string]: string
  };
  scripts: {
    [name: string]: string;
  };
  configFile: string;

  constructor (pjsonPath: string, project: Project, hasJspmConfig: boolean) {
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
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
        'private',
        'scripts',
        ['hooks', [
          'preinstall',
          'postinstall'
        ]],
        'overrides'
      ]],
      'private',
      'scripts',
      'type',
      ['hooks', [
        'preinstall',
        'postinstall'
      ]],
      'overrides'
    ]);
    this.project = project;
    this.lock();
    this.read();

    this.type = this.getValue(['type'], 'string');
    if (hasJspmConfig && !this.type)
      this.project.log.info(`Current project has no package.json ${bold('"type"')} field. It is advisable to explicitly set this to ${bold('"module"')} or ${bold('"commonjs"')}.`);

    this.dir = path.dirname(this.fileName);

    this.jspmPrefix = this.has(['jspm']);
    this.jspmAware = this.jspmPrefix || this.has(['registry']);

    // jspm: true is allowed
    try {
      if (this.getValue(['jspm'], 'boolean'))
        this.jspmPrefix = false;
    }
    catch (e) {}

    //if (!this.jspmAware)
    //  this.jspmPrefix = true;

    this.name = this.prefixedGetValue(['name'], 'string') || !this.jspmAware && 'app';
    this.version = this.prefixedGetValue(['version'], 'string');
    this.hooks = this.prefixedGetObject(['hooks'], true) || {};
    this.scripts = this.prefixedGetObject(['scripts'], false) || {};
    this.private = this.prefixedGetValue(['private'], 'boolean');

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
    
    if (this._optionalDependencies = this.readDependencies('optionalDependencies'))
      Object.keys(this._optionalDependencies).forEach(dep => {
        this.dependencies[dep] = {
          type: DepType.optional,
          target: processPackageTarget(dep, this._optionalDependencies[dep], this.project.defaultRegistry, false)
        };
      });
    if (this._devDependencies = this.readDependencies('devDependencies'))
      Object.keys(this._devDependencies).forEach(dep => {
        this.dependencies[dep] = {
          type: DepType.dev,
          target: processPackageTarget(dep, this._devDependencies[dep], this.project.defaultRegistry, false)
        };
      });
    if (this._dependencies = this.readDependencies('dependencies'))
      Object.keys(this._dependencies).forEach(dep => {
        this.dependencies[dep] = {
          type: DepType.primary,
          target: processPackageTarget(dep, this._dependencies[dep], this.project.defaultRegistry, false)
        };
      });
    if (this._peerDependencies = this.readDependencies('peerDependencies'))
      Object.keys(this._peerDependencies).forEach(dep => {
        this.dependencies[dep] = {
          type: DepType.peer,
          target: processPackageTarget(dep, this._peerDependencies[dep], this.project.defaultRegistry, false)
        };
      });

    for (let dep of Object.values(this.dependencies)) {
      if (typeof dep.target === 'string' && dep.target.startsWith('file:')) {
        dep.target = 'file:' + path.resolve(this.project.projectPath, dep.target.slice(5));
      }
    }
    
    const overrides = this.prefixedGetObject(['overrides']);
    this.overrides = [];
    if (overrides) {
      Object.keys(overrides).forEach(name => {
        const pkgName = parsePackageName(name);
        const target = new PackageTarget(pkgName.registry, pkgName.name, pkgName.version);
        this.overrides.push({
          target,
          override: processPackageConfig(overrides[name]),
          fresh: false
        });
      });
    }
  }

  dispose () {
    this.unlock();
  }

  setBaseURL (baseURL: string) {
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
  }

  write () {
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
    
    if (this.type) {
      this.remove(['type']);
      this.setValue(['type'], this.type);
    }

    if (this.private !== undefined) {
      this.prefixedSetValue(['private'], this.private);
    }

    const matchesPreviousTarget = (dependencies: Record<string, string>, name: string, previousTarget: string | PackageTarget) => {
      if (!dependencies || !dependencies[name])
        return false;
      const target = processPackageTarget(name, dependencies[name], this.project.defaultRegistry);
      if (typeof target === 'string')
        return normalizeResourceTarget(target, this.project.projectPath, this.project.projectPath) === previousTarget.toString();
      return target.toString() === previousTarget.toString();
    };

    const dependencies = {};
    const peerDependencies = {};
    const devDependencies = {};
    const optionalDependencies = {};
    for (const dep of Object.keys(this.dependencies)) {
      const { type, target } = this.dependencies[dep];
      switch (type) {
        case DepType.primary:
          if (matchesPreviousTarget(this._dependencies, dep, target))
            dependencies[dep] = this._dependencies[dep];
          else
            dependencies[dep] = serializePackageTargetCanonical(dep, target, this.project.defaultRegistry);
        break;
        case DepType.peer:
            if (matchesPreviousTarget(this._peerDependencies, dep, target))
            peerDependencies[dep] = this._peerDependencies[dep];
          else
            peerDependencies[dep] = serializePackageTargetCanonical(dep, target, this.project.defaultRegistry);
        break;
        case DepType.dev:
            if (matchesPreviousTarget(this._devDependencies, dep, target))
            devDependencies[dep] = this._devDependencies[dep];
          else
            devDependencies[dep] = serializePackageTargetCanonical(dep, target, this.project.defaultRegistry);
        break;
        case DepType.optional:
            if (matchesPreviousTarget(this._optionalDependencies, dep, target))
            optionalDependencies[dep] = this._optionalDependencies[dep];
          else
            optionalDependencies[dep] = serializePackageTargetCanonical(dep, target, this.project.defaultRegistry);
        break;
      }
    }

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
    .forEach(({ target, override }) => overrides[target.toString()] = override);

    this.prefixedSetObject(['overrides'], overrides, !this.jspmPrefix || !this.has(['overrides']));

    let baseURL = this.toRelativePath(this.baseURL);
    let baseURLPath = baseURL + (baseURL ? '/' : '');

    this.prefixedSetValue(['directories', 'baseURL'], baseURL || '.', '.');
    this.prefixedSetValue(['directories', 'packages'], this.toRelativePath(this.packages), baseURLPath + 'jspm_packages');
    this.prefixedSetValue(['directories', 'src'], this.toRelativePath(this.src) || '.', baseURLPath + 'src');
    this.prefixedSetValue(['directories', 'dist'], this.toRelativePath(this.dist), baseURLPath + 'dist');

    // always ensure we save as jspm aware
    if (!this.has(['jspm']) && !this.has(['registry'])) {
      if (this.jspmPrefix)
        this.setObject(['jspm'], {});
      //else
        //this.setValue(['jspm'], true);
    }

    return super.write();
  }

  setPrefix (jspmPrefix: boolean) {
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

  private readDependencies (depName: string) {
    if (this.depsPrefixed)
      return this.getObject(['jspm', depName]);
    else
      return this.getObject([depName]);
  }

  private writeDependencies (depName: string, value: Object) {
    if (this.depsPrefixed)
      return this.setObject(['jspm', depName], value, !this.has(['jspm', depName]));
    else
      this.setObject([depName], value, !this.has([depName]));
  }

  private prefixedSetObject (memberArray, object, clearIfEmpty = false) {
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

  private prefixedSetValue (memberArray, value, defaultValue?) {
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

  private prefixedGetValue (memberArray: string[], type?: ValueType) {
    var value;
    if (this.jspmPrefix)
      value = this.getValue(['jspm'].concat(memberArray), type);
    if (typeof value == 'undefined')
      value = this.getValue(memberArray, type);
    return value;
  }

  private prefixedGetObject (memberArray: string[], nested = true) {
    return this.jspmPrefix && this.getObject(['jspm'].concat(memberArray), nested) || this.getObject(memberArray, nested);
  }

  private toRelativePath (absPath: string) {
    return path.relative(this.dir, absPath).replace(/\\/g, '/');
  }
}