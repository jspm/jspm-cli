/*
 *   Copyright 2020 Guy Bedford
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

export let baseUrl: URL;
if (typeof process !== 'undefined' && process.versions.node) {
  baseUrl = new URL('file://' + process.cwd() + '/');
}
else if (typeof document !== 'undefined') {
  const baseEl: HTMLBaseElement | null = document.querySelector('base[href]');
  if (baseEl)
    baseUrl = new URL(baseEl.href + (baseEl.href.endsWith('/') ? '' : '/'));
  else if (typeof location !== 'undefined')
    baseUrl = new URL('../', new URL(location.href));
}

export function deepClone (obj) {
  const outObj = Object.create(null);
  for (const p of Object.keys(obj)) {
    const val = obj[p];
    if (Array.isArray(val))
      outObj[p] = [...val];
    else if (typeof val === 'object' && val !== null)
      outObj[p] = deepClone(val);
    else
      outObj[p] = val;
  }
  return outObj;
}

export function alphabetize<T> (obj: T): T {
  const out: T = <T>{};
  for (const key of Object.keys(obj).sort())
    out[key] = obj[key];
  return out;
}

export function isURL (specifier: string) {
  if (specifier.startsWith('/'))
    return true;
  try {
    new URL(specifier);
  }
  catch {
    return false;
  }
  return true;
}

export function isPlain (specifier: string) {
  if (specifier.startsWith('./') || specifier.startsWith('../'))
    return false;
  return !isURL(specifier);
}

export function getPackageName (specifier: string, parentUrl: URL) {
  let sepIndex = specifier.indexOf('/');
  if (specifier[0] === '@') {
    if (sepIndex === -1)
      throw new Error(`${specifier} is not an invalid scope name, imported from ${parentUrl.href}.`);
    sepIndex = specifier.indexOf('/', sepIndex + 1);
  }
  return sepIndex === -1 ? specifier : specifier.slice(0, sepIndex);
}
