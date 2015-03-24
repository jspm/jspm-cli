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

var asp = require('rsvp').denodeify;
var fs = require('graceful-fs');
var config = require('./config');

// the opposite of extend
// useful for setting default config
exports.dprepend = function dprepend(a, b) {
  for (var p in b) {
    if (!b.hasOwnProperty(p))
      continue;

    var val = b[p];
    if (typeof val === 'object')
      dprepend(a[p] = typeof a[p] === 'object' ? a[p] : {}, val);
    else if (!(p in a))
      a[p] = val;
  }
  return a;
};

exports.extend = function(a, b) {
  for (var p in b) {
    if (b.hasOwnProperty(p)) {
      a[p] = b[p];
    }
  }
  return a;
};

function dextend(a, b) {
  for (var p in b) {
    if (!b.hasOwnProperty(p))
      continue;
    var val = b[p];
    if (typeof val === 'object')
      dextend(a[p] = typeof a[p] === 'object' ? a[p] : {}, val);
    else
      a[p] = val;
  }
  return a;
}
exports.dextend = dextend;

exports.hasProperties = function(obj) {
  for (var p in obj) {
    if (obj.hasOwnProperty(p))
      return true;
  }
  return false;
};

exports.readJSON = function(file) {
  return asp(fs.readFile)(file)
  .then(function(pjson) {
    pjson = pjson.toString();
    // remove any byte order mark
    if (pjson.startsWith('\uFEFF'))
      pjson = pjson.substr(1);
    try {
      return JSON.parse(pjson);
    }
    catch(e) {
      throw 'Error parsing package.json file ' + file;
    }
  }, function(err) {
    if (err.code === 'ENOENT')
      return {};
    throw err;
  });
};

exports.readJSONSync = function(file) {
  var pjson;
  try {
    pjson = fs.readFileSync(file).toString();
  }
  catch(e) {
    if (e.code === 'ENOENT')
      pjson = '{}';
  }
  if (pjson.startsWith('\uFEFF'))
    pjson = pjson.substr(1);
  try {
    return JSON.parse(pjson);
  }
  catch(e) {
    throw 'Error parsing package.json file ' + file;
  }
  return pjson;
};

// given an object, create a new object with the properties ordered alphabetically
exports.alphabetize = function(obj) {
  var newObj = {};
  Object.keys(obj).sort().forEach(function(p) {
    newObj[p] = obj[p];
  });
  return newObj;
};

exports.getRedirectContents = function(format, main) {
  if (format === 'es6')
    return 'export * from "' + main + '";';

  else if (format === 'cjs' || format === 'global')
    return 'module.exports = require("' + main + '");';

  else if (format === 'amd')
    return 'define(["' + main + '"], function(main) {\n  return main;\n});';

  else if (format === 'register')
    return 'System.register(["' + main + '"], ' +
      'function($__export) {\n  return {  setters: [function(m) { for (var p in m) $__export(p, m[p]); }],  execute: function() {}  };\n});';

  else
    throw 'Unknown module format ' + format + '.';
};

exports.stringify = function (subject) {
  // replace the LF used by `JSON.stringify` with the preferred new line
  return JSON.stringify(subject, null, 2).replace(/\n/g, config.newLine);
};
