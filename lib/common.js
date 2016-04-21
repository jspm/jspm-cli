/*
 *   Copyright 2014-2016 Guy Bedford (http://guybedford.com)
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
var fs = require('graceful-fs');
var path = require('path');
var asp = require('bluebird').Promise.promisify;

// the opposite of extend
// useful for setting default config
exports.dprepend = function dprepend(a, b) {
  for (var p in b) {
    var val = b[p];
    if (val instanceof Array && !(p in a))
      a[p] = val.concat([]);
    if (typeof val === 'object')
      dprepend(a[p] = typeof a[p] === 'object' ? a[p] : {}, val);
    else if (!(p in a))
      a[p] = val;
  }
  return a;
};

exports.extend = extend;
function extend(a, b) {
  for (var p in b)
    a[p] = b[p];
  return a;
}

function dextend(a, b) {
  for (var p in b) {
    var val = b[p];
    if (val instanceof Array)
      a[p] = val.concat([]);
    else if (typeof val === 'object')
      dextend(a[p] = typeof a[p] === 'object' ? a[p] : {}, val);
    else
      a[p] = val;
  }
  return a;
}
exports.dextend = dextend;

exports.inDir = inDir;
function inDir(fileName, dir, strictlyWithin, sep) {
  sep = sep || path.sep;
  if (dir[dir.length - 1] != sep)
    dir += sep;
  return fileName.substr(0, dir.length) === dir && (strictlyWithin === false || fileName[dir.length - 1] === sep);
}

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

exports.HOME = process.env.LOCALAPPDATA || process.env.HOME || process.env.HOMEPATH;

var isWin = process.platform.match(/^win/);
exports.isWin = isWin;

exports.absURLRegEx = /^[\/]|[^\/]+:\/\//;

exports.toFileURL = function toFileURL(path) {
  return 'file://' + (isWin ? '/' : '') + path.replace(/\\/g, '/');
};

exports.fromFileURL = function fromFileURL(path) {
  return path.substr(isWin ? 8 : 7).replace(path.sep, '/');
};

// given a deps object and registry
// return the map of names to PackageName objects
var PackageName = require('./package-name');
exports.processDeps = processDeps;
function processDeps(deps, registry, debugName) {
  var outdeps = {};
  if (!deps)
    return outdeps;
  Object.keys(deps).forEach(function(p) {
    var dep = deps[p];

    if (dep instanceof PackageName) {
      outdeps[p] = dep;
      return outdeps[p];
    }

    var outPackage;

    // jquery: github:components/jquery
    // jquery: jquery@1.5
    // -> RHS is dep
    if (dep.indexOf(':') !== -1)
      outPackage = dep;

    else if (!registry)
      throw new TypeError('Install of %' + p + '% to `' + dep + '` within `' + debugName + '` has no registry property provided.');

    // jquery: components/jquery@1.5
    else if (dep.lastIndexOf('@') > 0)
      outPackage = registry + ':' + dep;

    // jquery: 1.5
    else
      outPackage = registry + ':' + p + '@' + dep;

    outdeps[p] = new PackageName(outPackage, false);
  });
  return outdeps;
}

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

exports.md5 = function(input) {
  var crypto = require('crypto');
  var md5Hash = crypto.createHash('md5');
  md5Hash.update(input);
  return md5Hash.digest('hex');
};

// given an object, create a new object with the properties ordered alphabetically
exports.alphabetize = function(obj) {
  var newObj = {};
  Object.keys(obj).sort().forEach(function(p) {
    newObj[p] = obj[p];
  });
  return newObj;
};

// default newline to the appropriate value for the system
var newLine = require('os').EOL;
var tab = '  ';
exports.stringify = function (subject) {
  return JSON.stringify(subject, null, tab).replace(/\n/g, newLine);
};

/* Recursively remove directory, all those above it, if they are empty.
 * Takes optional `stopDir` to terminate at. */
 exports.cascadeDelete = cascadeDelete;
function cascadeDelete(dir, stopDir) {
  if (dir && dir !== stopDir) {
    return asp(fs.rmdir)(dir)
    .catch(function(err) {
      // just continue if directory does not exist
      if (err.code !== 'ENOENT')
        throw err;
    })
    .then(function() {
      return cascadeDelete(path.dirname(dir), stopDir);
    })
    .catch(function(err) {
      // gracefully stop at first non-empty directory
      if (err.code !== 'ENOTEMPTY')
        throw err;
    });
  }
}

// meta first-level extends where:
// array + array appends
// object + object extends
// other properties replace
function extendMeta(a, b) {
  for (var p in b) {
    var val = b[p];
    if (!(p in a))
      a[p] = val;
    else if (val instanceof Array && a[p] instanceof Array)
      a[p] = a[p].concat(val);
    else if (typeof val == 'object' && typeof a[p] == 'object')
      a[p] = extend(a[p], val);
    else
      a[p] = val;
  }
}

exports.extendSystemConfig = extendSystemConfig;
function extendSystemConfig(configA, configB) {

  Object.keys(configB).forEach(function(p) {
    if (!(p in configA))
      configA[p] = configB[p];

    else if (['paths', 'bundles', 'depCache', 'map'].indexOf(p) != -1)
      extend(configA[p], configB[p]);

    else if (p == 'meta')
      Object.keys(configB.meta).forEach(function(path) {
        if (!(path in configA.meta))
          configA.meta[path] = configB.meta[path];
        else
          extendMeta(configA.meta[path], configB.meta[path]);
      });

    else if (p == 'packages')
      Object.keys(configB.packages).forEach(function(path) {
        if (!(path in configA.packages))
          configA.packages[path] = configB.packages[path];
        else
          Object.keys(configB.packages[path]).forEach(function(pkgCfg) {
            if (!(pkgCfg in configA.packages[path]))
              configA.packages[path][pkgCfg] = configB.packages[path][pkgCfg];
            else if (pkgCfg == 'map')
              extend(configA.packages[path].map, configB.packages[path].map);
            else if (pkgCfg == 'modules')
              extendMeta(configA.packages[path].modules, configB.packages[path].modules);
            else
              configA.packages[path][pkgCfg] = configB.packages[path][pkgCfg];
          });
      });

    else
      configA[p] = configB[p];
  });

  return configA;
}
