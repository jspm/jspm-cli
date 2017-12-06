/*
 *   Copyright 2014-2017 Guy Bedford (http://guybedford.com)
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
import ConfigFile from './config-file';
import { ResolveTree } from '../install/package';

/*
 * jspm.json file implementation
 * Designed to be a system file for jspm first, not humans first.
 */

// NB ff we install into a folder, whose jspm configuration file won't be detected as its own when detecting down the backtracking, we throw.
export default class JspmCfg extends ConfigFile {
  installed: ResolveTree;

  constructor (configPath) {
    super(configPath, [
      'resolve',
      'dependencies',
    ]);
    this.lock();
    this.read();
    this.installed = new ResolveTree(this.getObject(['resolve']), this.getObject(['dependencies']));
  }

  dispose () {
    this.unlock();
  }

  write () {
    this.setObject([], this.installed.serialize(), true, true);
    // NB for some reason this isn't detecting changelessness
    return super.write();
  }
}




/*
  getSystemJSConfig () {
    let cfg = {
      paths: {},
      map: {}
    };

    function ensureRegistry (registry: string) {
      if (cfg.paths[registry + ':'])
        return;
      cfg.paths[registry + ':'] = toFileURL(this.config.pjson.packages) + '/';
    }

    Object.keys(this.resolveMap).forEach(name => {
      let pkg = this.resolveMap[name];
      ensureRegistry(pkg.registry);

      cfg.map[name + '/'] = pkg.exactName + '/';
      let main = this.dependencies[pkg.exactName].main;
      if (main)
        cfg.map[name] = pkg.exactName + '/' + main;
    })

    Object.keys(this.dependencies).forEach(parent => {
      let cfgDepMap = cfg.map[parent] = cfg.map[parent] || {};
      let depObj = this.dependencies[parent];
      Object.keys(depObj.resolveMap).forEach(name => {
        let pkgName = depObj.resolveMap[name].exactName;

        cfgDepMap[name + '/'] = pkgName + '/';
        let main = this.dependencies[pkgName].main;
        if (main)
          cfgDepMap[name] = pkgName + '/' + main;
      });
    });

    return cfg;
  }
*/