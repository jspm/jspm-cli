/*
 *   Copyright 2014-2015 Guy Bedford (http://guybedford.com)
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

require('core-js/es6/string');

var semverRegEx = /^(\d+)(?:\.(\d+)(?:\.(\d+)(?:-([\da-z-]+(?:\.[\da-z-]+)*)(?:\+([\da-z-]+(?:\.[\da-z-]+)*))?)?)?)?$/i;
var numRegEx = /^\d+$/;

function toInt(num) {
  return parseInt(num, 10);
}

function parseSemver(v) {
  var semver = v.match(semverRegEx);
  if (!semver)
    return {
      tag: v
    };
  else
    return {
      major: toInt(semver[1]),
      minor: toInt(semver[2]),
      patch: toInt(semver[3]),
      pre: semver[4] && semver[4].split('.')
    };
}

var parts = ['major', 'minor', 'patch'];
function semverCompareParsed(v1, v2) {
  // not semvers - tags have equal precedence
  if (v1.tag && v2.tag)
    return 0;

  // semver beats non-semver
  if (v1.tag)
    return -1;
  if (v2.tag)
    return 1;

  // compare version numbers
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    var part1 = v1[part];
    var part2 = v2[part];
    if (part1 === part2)
      continue;
    if (isNaN(part1))
      return -1;
    if (isNaN(part2))
      return 1;
    return part1 > part2 ? 1 : -1;
  }

  if (!v1.pre && !v2.pre)
    return 0;

  if (!v1.pre)
    return 1;
  if (!v2.pre)
    return -1;

  // prerelease comparison
  for (var j = 0, l = Math.min(v1.pre.length, v2.pre.length); j < l; j++) {
    if (v1.pre[j] === v2.pre[j])
      continue;

    var isNum1 = v1.pre[j].match(numRegEx);
    var isNum2 = v2.pre[j].match(numRegEx);

    // numeric has lower precedence
    if (isNum1 && !isNum2)
      return -1;
    if (isNum2 && !isNum1)
      return 1;

    // compare parts
    if (isNum1 && isNum2)
      return toInt(v1.pre[j]) > toInt(v2.pre[j]) ? 1 : -1;
    else
      return v1.pre[j] > v2.pre[j] ? 1 : -1;
  }

  if (v1.pre.length === v2.pre.length)
    return 0;

  // more pre-release fields win if equal
  return v1.pre.length > v2.pre.length ? 1 : -1;
}

// match against a parsed range object
// saves operation repetition
// doesn't support tags
// if not semver or fuzzy, assume exact
function matchParsed(range, version) {
  var rangeVersion = range.version;

  if (rangeVersion.tag)
    return rangeVersion.tag === version.tag;

  // if the version is less than the range, it's not a match
  if (semverCompareParsed(rangeVersion, version) === 1)
    return false;

  // now we just have to check that the version isn't too high for the range
  if (isNaN(version.minor) || isNaN(version.patch))
    return false;

  // if the version has a prerelease, ensure the range version has a prerelease in it
  // and that we match the range version up to the prerelease exactly
  if (version.pre) {
    if (!(rangeVersion.major === version.major && rangeVersion.minor === version.minor && rangeVersion.patch === version.patch))
      return false;
    return range.semver || range.fuzzy || rangeVersion.pre.join('.') === version.pre.join('.');
  }

  // check semver range
  if (range.semver) {
    // ^0
    if (rangeVersion.major === 0 && isNaN(rangeVersion.minor))
      return version.major < 1;
    // ^1..
    else if (rangeVersion.major >= 1)
      return rangeVersion.major === version.major;
    // ^0.1, ^0.2
    else if (rangeVersion.minor >= 1)
      return version.major === 0 && rangeVersion.minor === version.minor;
    // ^0.0.x falls down to exact match below
  }

  // check fuzzy range (we can assume rangeVersion.minor exists, due to behaviour switch)
  if (range.fuzzy)
    return version.major === rangeVersion.major && version.minor <= rangeVersion.minor;

  // exact match
  // eg 001.002.003 matches 1.2.3
  return !rangeVersion.pre && rangeVersion.major === version.major && rangeVersion.minor === version.minor && rangeVersion.patch === version.patch;
}

/*
 * semver       - is this a semver range
 * fuzzy        - is this a fuzzy range
 * version      - the parsed version object
 */
function parseRange(range) {
  var rangeObj = {};

  ((rangeObj.semver = range.startsWith('^')) ||
      (rangeObj.fuzzy = range.startsWith('~'))
  ) && (range = range.substr(1)); // jshint ignore:line

  var rangeVersion = rangeObj.version = parseSemver(range);

  if (rangeVersion.tag)
    return rangeObj;

  // 0, 0.1 behave like ~0, ~0.1
  if (!rangeObj.fuzzy && !rangeObj.semver && (isNaN(rangeVersion.minor) || isNaN(rangeVersion.patch)))
    rangeObj.fuzzy = true;

  // ~1, ~0 behave like ^1, ^0
  if (rangeObj.fuzzy && isNaN(rangeVersion.minor)) {
    rangeObj.semver = true;
    rangeObj.fuzzy = false;
  }

  // ^0.0 behaves like ~0.0
  if (rangeObj.semver && rangeObj.major === 0 && !isNaN(rangeVersion.minor) && isNaN(rangeVersion.patch)) {
    rangeObj.semver = false;
    rangeObj.fuzzy = true;
  }

  return rangeObj;
}

exports.semverRegEx = semverRegEx;

exports.compare = function(v1, v2) {
  return semverCompareParsed(parseSemver(v1), parseSemver(v2));
};

exports.match = function match(range, version) {
  // supported range types:
  // 0.2, 1, ~1.2.3, ^1.2.3, ^0.4.3-alpha.1
  if (range === '' || range === '*')
    return true;
  return matchParsed(parseRange(range), parseSemver(version));
};
