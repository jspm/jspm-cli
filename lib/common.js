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


var asp = require('rsvp').denodeify;
var fs = require('graceful-fs');

// the opposite of extend
// useful for setting default config
function dprepend(a, b) {
  for (var p in b) {
    var val = b[p];
    if (typeof val == 'object')
      dprepend(a[p] = typeof a[p] == 'object' ? a[p] : {}, val);
    else if (!(p in a))
      a[p] = val;
  }
  return a;
}
exports.dprepend = dprepend;

exports.extend = function(a, b) {
  for (var p in b)
    a[p] = b[p];
  return a;
}

exports.hasProperties = function(obj) {
  for (var p in obj) {
    if (obj.hasOwnProperty(p))
      return true;
  }
  return false;
}

exports.readJSON = function(file) {
  return asp(fs.readFile)(file)
  .then(function(pjson) {
    try {
      return JSON.parse(pjson);
    }
    catch(e) {
      throw "Error parsing package.json file " + file;
    }
  }, function(err) {
    if (err.code === 'ENOENT')
      return {};
    throw err;
  });
}

// given an object, create a new object with the properties ordered alphabetically
exports.alphabetize = function(obj) {
  var newObj = {};
  Object.keys(obj).sort().forEach(function(p) {
    newObj[p] = obj[p];
  });
  return newObj;
}