/*
 *   Copyright 2014 Guy Bedford (http://guybedford.com)
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
var semverRegEx = exports.semverRegEx = /^(\d+)(?:\.(\d+)(?:\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?)?)?$/;
var numRegEx = /^\d+$/;
var semverCompare = exports.compare = function(v1, v2) {
  var semver1 = v1.match(semverRegEx);
  var semver2 = v2.match(semverRegEx);

  // not semvers - just sort string tags
  if (!semver1 && !semver2)
    return semver1 > semver2 ? 1 : -1;

  // semver beats non-semver
  if (!semver1)
    return -1;
  if (!semver2)
    return 1;

  // compare version numbers
  for (var i = 1; i <= 3; i++) {
    if (semver1[i] == semver2[i])
      continue;
    // missing numbers take lower precedence
    if (!semver1[i])
      return -1;
    else if (!semver2[i])
      return 1;
    return parseInt(semver1[i]) > parseInt(semver2[i]) ? 1 : -1;
  }

  if (semver1[4] === semver2[4])
    return 0;

  // prerelease have lower order
  if (!semver1[4])
    return 1;
  if (!semver2[4])
    return -1;

  // prerelease comparison
  var prerelease1 = semver1[4].split('.');
  var prerelease2 = semver2[4].split('.');
  for (var i = 0, l = Math.min(prerelease1.length, prerelease2.length); i < l; i++) {
    if (prerelease1[i] == prerelease2[i])
      continue;

    var isNum1 = prerelease1[i].match(numRegEx);
    var isNum2 = prerelease2[i].match(numRegEx);
    
    // numeric has lower precedence
    if (isNum1 && !isNum2)
      return -1;
    if (isNum2 && !isNum1)
      return 1;

    // compare parts
    if (isNum1 && isNum2)
      return parseInt(prerelease1[i]) > parseInt(prerelease2[i]) ? 1 : -1;
    else
      return prerelease1[i] > prerelease2[i] ? 1 : -1;
  }

  if (prerelease1.length == prerelease2.length)
    return 0;

  // more pre-release fields win if equal
  return prerelease1.length > prerelease2.length ? 1 : -1;
}

exports.match = function match(range, version) {
  // supported range types:
  // 0.2, 1, ~1.2.3, ^1.2.3, ^0.4.3-alpha.1, *
  var isSemver, isFuzzy;

  if (range === version || range === '*')
    return true;

  ((isSemver = range.substr(0, 1) == '^') 
      || (isFuzzy = range.substr(0, 1) == '~')
  ) && (range = range.substr(1));

  // if the version is less than the range, it's not a match
  if (semverCompare(range, version) == 1)
    return false;

  // now we just have to check that the version isn't too high for the range
  var rangeMatch = range.match(semverRegEx);
  var versionMatch = version.match(semverRegEx);

  if (!versionMatch || !rangeMatch)
    return false;

  var rangeMajor = parseInt(rangeMatch[1]);
  var rangeMinor = parseInt(rangeMatch[2]);
  var rangePatch = parseInt(rangeMatch[3]);
  var rangePre = rangeMatch[4];

  var versionMajor = parseInt(versionMatch[1]);
  var versionMinor = parseInt(versionMatch[2]);
  var versionPatch = parseInt(versionMatch[3]);
  var versionPre = versionMatch[4];

  if (isNaN(versionMinor) || isNaN(versionPatch))
    return false;

  // if the version has a prerelease, ensure the range version has a prerelease in it
  // and that we match the range version up to the prerelease exactly
  if (versionPre)
    return !!(rangePre && rangeMajor == versionMajor && rangeMinor == versionMinor && rangePatch == versionPatch);

  // 0, 0.1 behave like ~0, ~0.1
  if (!isSemver && !isFuzzy && (isNaN(rangeMinor) || isNaN(rangePatch)))
    isFuzzy = true;

  // ~1, ~0 behave like ^1, ^0
  if (isFuzzy && isNaN(rangeMinor)) {
    isSemver = true;
    isFuzzy = false;
  }

  // ^0.0 behaves like ~0.0
  if (isSemver && !isNaN(rangeMinor) && isNaN(rangePatch)) {
    isSemver = false;
    isFuzzy = true;
  }

  // check semver range
  if (isSemver) {
    // ^0
    if (rangeMajor == 0 && isNaN(rangeMinor))
      return versionMajor < 1;
    // ^1..
    else if (rangeMajor >= 1)
      return rangeMajor == versionMajor;
    // ^0.1, ^0.2
    else if (rangeMinor >= 1)
      return rangeMinor == versionMinor;
    // ^0.0.0
    else
      return (rangePatch || 0) == versionPatch;
  }

  // check fuzzy range
  if (isFuzzy)
    return versionMajor == rangeMajor && versionMinor < (rangeMinor || 0) + 1;

  // exact match
  // eg 001.002.003 matches 1.2.3
  return !!(!rangePre && rangeMajor == versionMajor && rangeMinor == versionMinor && rangePatch == versionPatch);
}