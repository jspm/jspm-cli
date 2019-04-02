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

/*
 * jspm core overrides
 *
 * These overrides apply to all jspm installs, overriding the package.json properties
 * of the matching packages.
 * 
 * PRs are welcome to this file, provided:
 * 1. The package has high enough use that this is an important override for jspm core to maintain.
 * 2. The override is necessary for jspm compatibility.
 * 3. An attempt to create an upstream PR has been made, and rejected.
 * 
 */

import { PackageConfig } from "./install/package";

/*
  Example Entry:
  "npm": {
    "assert": {
      "^1.2.3": {
        ...override
      }
    }
  }
*/

export default <Record<string, Record<string, Record<string, PackageConfig>>>>{};