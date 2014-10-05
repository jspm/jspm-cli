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
    if (!semver1[i])
      return 1;
    else if (!semver2[i])
      return -1;
    if (semver1[i] != semver2[i])
      return parseInt(semver1[i]) > parseInt(semver2[i]) ? 1 : -1;
  }

  if (semver1[4] == semver2[4])
    return 0;

  // compare prereleases
  if (!semver1[4])
    return 1;
  if (!semver2[4])
    return -1;

  return semver1[4] > semver2[4] ? 1 : -1;
}

exports.match = function(range, version) {
  if (range == version)
    return true;

  var minVersion;
  if (range.substr(0, 1) == '^') {
    range = range.substr(1);
    minVersion = true;
  }

  var semverRangeMatch = range.match(semverRegEx);

  if (!semverRangeMatch)
    return false;

  // translate '^' in range to simpler range form
  if (minVersion) {
    // ^0 -> 0
    // ^1 -> 1
    if (!semverRangeMatch[2])
      minVersion = false;
    
    if (!semverRangeMatch[3]) {
      
      // ^1.1 -> ^1.1.0
      if (semverRangeMatch[2] > 0)
        semverRangeMatch[3] = '0';

      // ^0.1 -> 0.1
      // ^0.0 -> 0.0
      else
        minVersion = false;
    }
  }

  if (minVersion) {
    // >= 1.0.0
    if (semverRangeMatch[1] > 0) {
      if (!semverRangeMatch[2])
        range = semverRangeMatch[1] + '.0.0';
      if (!semverRangeMatch[3])
        range = semverRangeMatch[1] + '.0';
      minVersion = range;
      semverRangeMatch = [semverRangeMatch[1]];
    }
    // >= 0.1.0
    else if (semverRangeMatch[2] > 0) {
      minVersion = range;
      semverRangeMatch = [0, semverRangeMatch[2]];
    }
    // >= 0.0.0
    else {
      // NB compatible with prerelease is just prelease itself?
      minVersion = false;
      semverRangeMatch = [0, 0, semverRangeMatch[3]];
    }
    range = semverRangeMatch.join('.');
  }

  // now we just have 1 / 1.2 / 1.4, with a minVersion
  // if I have requested x.y, find an x.y.z-b
  // if I have requested x, find any x.y / x.y.z-b
  if (version.substr(0, range.length) == range && version.charAt(range.length).match(/^[\.\-]?$/)) {
    // if a minimum version, then check too
    if (!minVersion)
      return true;
    else if (semverCompare(version, minVersion) >= 0)
      return true;
  }
  return false;
}