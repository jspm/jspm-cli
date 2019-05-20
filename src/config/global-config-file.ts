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
import path = require('path');

import { JSPM_CONFIG_DIR, JSPM_LEGACY_CONFIG_DIR, readJSONSync } from '../utils/common';
import ConfigFile from './config-file';
import mkdirp = require('mkdirp');

const defaultGlobalConfig = {
  defaultRegistry: 'npm',
  registries: {
    github: {},
    npm: {}
  }
};

export class GlobalConfig extends ConfigFile {
  constructor () {
    super(path.resolve(JSPM_CONFIG_DIR, 'config'), [
      'defaultRegistry',
      'strictSSL',
      ['timeouts', [
        'download',
        'lookup'
      ]],
      ['registries', [
        ['github', [
          'auth',
          'maxRepoSize'
        ]],
        ['npm', []]
      ]]
    ]);

    this.read();

    // set global config defaults
    if (!this.exists()) {
      mkdirp.sync(JSPM_CONFIG_DIR);
      this.lock();

      // treat legacy jspm configuration file as defaults on first run only
      // thus creating a global configuration upgrade path
      try {
        const legacyGlobalConfig = readJSONSync(path.join(JSPM_LEGACY_CONFIG_DIR, 'config'));
        if (legacyGlobalConfig)
          this.prependObject(legacyGlobalConfig);
      }
      catch (e) {}

      this.prependObject(defaultGlobalConfig);

      this.write();
      this.unlock();
    }
  }

  get (configName: string | string[]) {
    if (typeof configName === 'string')
      configName = configName.split('.');
    try {
      return this.getValue(configName);
    }
    catch (e) {
      return this.getObject(configName);
    }
  }

  set (configName: string | string[], configValue: any[] | number | boolean | string) {
    if (typeof configName === 'string')
      configName = configName.split('.');
    this.lock();
    this.read();

    if (configValue !== undefined)
      this.setValue(configName, configValue);
    else
      this.remove(configName);

    this.write();
    this.unlock();
  }
}

export default new GlobalConfig();