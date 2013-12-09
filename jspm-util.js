/*
 *   Copyright 2013 Guy Bedford
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
 *
 */

var semver = require('semver');
var fs = require('fs');
var path = require('path');
var glob = require('glob');
var rimraf = require('rimraf');
var jspmLoader = require('jspm-loader');
var https = require('https');
var Transpiler = require('es6-module-transpiler').Compiler;
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var tar = require('tar');

var jspmUtil = {};

var curOpenFiles = 0;
var maxOpenFiles = 50;

var readQueue = [];
var spawnQueue = [];
var writeQueue = [];

jspmUtil.exactVersionRegEx = /^(\d+)(\.\d+)(\.\d+)?$/;

var nextFileQueue = function() {
  if (curOpenFiles >= maxOpenFiles)
    return;

  var next;
  if (readQueue.length) {
    next = readQueue.pop();
    if (next)
      readFile(next.file, next.callback);
  }
  else if (spawnQueue.length) {
    next = spawnQueue.pop();
    if (next)
      jspmUtil.spawnCompiler.apply(null, next);
  }
  else if (writeQueue.length) {
    next = writeQueue.pop();
    if (next)
      writeFile(next.file, next.data, next.callback);
  }
}


var readFile = function(file, callback) {
  if (curOpenFiles >= maxOpenFiles)
    return readQueue.push({ file: file, callback: callback });
  curOpenFiles++;
  fs.readFile(file, function(err, source) {
    curOpenFiles--;
    nextFileQueue();
    callback(err, source);
  });
}
var writeFile = function(file, data, callback) {
  if (curOpenFiles >= maxOpenFiles)
    return writeQueue.push({ file: file, data: data, callback: callback });
  curOpenFiles++;
  fs.writeFile(file, data, function(err) {
    curOpenFiles--;
    nextFileQueue();
    callback(err);
  });
}

jspmUtil.dirContains = function(dirName, fileName) {
  dirName = path.resolve(dirName);
  fileName = path.resolve(fileName);
  if (path.relative(dirName, fileName).substr(0, 2) == '..')
    return false;
  return true;
}

jspmUtil.applyIgnoreFiles = function(dir, files, ignore, callback) {
  // take all files
  glob(dir + path.sep + '**' + path.sep + '*', function(err, allFiles) {
    
    // create an array of files to remove
    var removeFiles = [];

    if (files) {
      // remove all files not listed by a files directory
      removeFiles = allFiles;
      var fileFiles = [];
      for (var i = 0; i < files.length; i++) {
        if (files[i].substr(0, 2) == './')
          files[i] = files[i].substr(2);
        var fileName = dir + path.sep + files[i];
        try {
          if (fs.statSync(fileName).isDirectory()) {
            for (var j = 0; j < allFiles.length; j++) {
              if (jspmUtil.dirContains(fileName, allFiles[j]))
                fileFiles.push(fileName);
            }
          }
          else
            fileFiles.push(fileName);
        }
        catch(e) {}
      }
      // if files are specifically included, add them back
      for (var i = 0; i < fileFiles.length; i++) {
        for (var j = 0; j < removeFiles.length; j++) {
          if (removeFiles[j].substr(0, fileFiles[i].length) == fileFiles[i])
            removeFiles.splice(j--, 1);
        }
      }
    }

    if (ignore) {
      // remove all files and folders in the ignore list
      for (var i = 0; i < ignore.length; i++) {
        var fileName = path.resolve(dir, ignore[i]);
        try {
          if (fs.statSync(fileName).isDirectory()) {
            for (var j = 0; j < allFiles.length; j++)
              if (jspmUtil.dirContains(fileName, allFiles[j]))
                removeFiles.push(allFiles[j]);
          }
          else {
            if (removeFiles.indexOf(fileName) == -1)
              removeFiles.push(fileName);
          }
        }
        catch(e) {}
      }
    }

    // do the removal
    var removed = 0;
    var err;

    var checkComplete = function(_err) {
      err = err || _err;
      removed++;
      if (removed == removeFiles.length)
        callback(err);
    }

    for (var i = 0; i < removeFiles.length; i++) (function(i) {
      fs.unlink(removeFiles[i], function(err) {
        if (err && err.code != 'EPERM') {
          callback(err);
          callback = function() {}
          return;
        }

        checkComplete();
      });
    })(i);
    
    if (!removeFiles.length)
      callback();
  });
}


jspmUtil.getPackageJSON = function(dir, callback) {
  readFile(path.resolve(dir, 'package.json'), function(err, pjson) {
    if (err) {
      if (err.code == 'ENOENT')
        return callback(null, null);
      else
        return callback(err);
    }
    try {
      pjson = JSON.parse(pjson);
    }
    catch(e) {
      return callback('Unable to parse package.json');
    }
    if (pjson.jspm)
      jspmUtil.extend(pjson, pjson.jspm);
    callback(null, pjson);
  });
}

jspmUtil.registryLookup = function(name, callback) {
  var resData = [];
  https.get({
    hostname: 'registry.jspm.io',
    path: '/' + name,
    headers: { accept: 'application/json' },
    rejectUnauthorized: false
  }, function(res) {
    res.on('data', function(chunk) {
      resData.push(chunk);
    });
    res.on('end', function() {
      var result;
      try {
        result = JSON.parse(resData.join(''));
      }
      catch(e) {
        return callback(!resData.join('') ? 'Not found' : resData.join(''));
      }
      callback(null, result);
    });
    res.on('error', callback);
  });
}

jspmUtil.extend = function(objA, objB, deep) {
  for (var p in objB)
    if (deep && typeof objA[p] == 'object')
      jspmUtil.extend(objA[p], objB[p]);
    else
      objA[p] = objB[p];
  return objA;
}

jspmUtil.collapseLibDir = function(repoPath, packageOptions, callback, errback) {
  var collapseDir;
  var isBuilt = false;
  if (packageOptions.directories) {
    collapseDir = packageOptions.directories.dist || packageOptions.directories.lib;

    if (packageOptions.directories.dist)
      isBuilt = true;
  }

  if (!collapseDir)
    return callback(isBuilt);

  // move lib dir into temporary path
  var tmpPath = path.resolve(repoPath, '..' + path.sep + '.tmp-' + repoPath.split(path.sep).pop());
  fs.rename(path.resolve(repoPath, collapseDir), tmpPath, function(err) {
    if (err)
      return errback(err);

    // clear directory entirely
    rimraf(repoPath, function(err) {
      if (err)
        return errback(err);
      // move lib dir back
      fs.rename(tmpPath, repoPath, function(err) {
        if (err)
          return errback(err);

        callback(isBuilt);
      });
    });
  });  
}

var cjsRequireRegEx = /require\s*\(\s*("([^"]+)"|'([^']+)')\s*\)/g;
jspmUtil.mapCJSDependencies = function(source, replaceMap) {
  var change = false;
  var newSource = source.replace(cjsRequireRegEx, function(statement, str, singleString, doubleString) {
    var name = singleString || doubleString;
    var match;
    if ((match = jspmUtil.wildcardMatch(name, replaceMap, true, true))) {
      change = true;
      return statement.replace(new RegExp('"' + name + '"|\'' + name + '\'', 'g'), '\'' + jspmUtil.replaceWildcards(replaceMap[match.match], match.wildcards) + match.suffix + '\'');
    }
    else
      return statement;
  });
  return change && newSource;
}

var amdDefineRegEx = /(?:^\s*|[}{\(\);,\n\?\&]\s*)define\s*\(\s*("[^"]+"\s*,|'[^']+'\s*,\s*)?(\[(\s*("[^"]+"|'[^']+')\s*,)*(\s*("[^"]+"|'[^']+')\s*)?\])/;
jspmUtil.mapAMDDependencies = function(source, replaceMap) {
  var statement = amdDefineRegEx.exec(source);
  
  if (statement) {
    var depArray = eval(statement[2]);
    var match;
    var change = false;

    for (var i = 0; i < depArray.length; i++) {
      var name = depArray[i];
      if ((match = jspmUtil.wildcardMatch(name, replaceMap, true, true))) {
        if (replaceMap[match.match] != name) {
          change = true;
          name = name.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
          depArray[i] = jspmUtil.replaceWildcards(replaceMap[match.match], match.wildcards) + match.suffix;
        }
      }
    }
    return change && source.replace(statement[2], JSON.stringify(depArray));
  }
  else
    return;
}

var es6DepRegEx = /(^|\}|\s)(from|import)\s*("([^"]+)"|'([^']+)')/g;
jspmUtil.mapES6Dependencies = function(source, replaceMap) {
  var change = false;
  var newSource = source.replace(es6DepRegEx, function(statement, start, type, str, singleString, doubleString) {
    var name = singleString || doubleString;
    var match;
    if ((match = jspmUtil.wildcardMatch(name, replaceMap, true, true))) {
      change = true;
      return statement.replace(new RegExp('"' + name + '"|\'' + name + '\'', 'g'), '\'' + jspmUtil.replaceWildcards(replaceMap[match.match], match.wildcards) + match.suffix + '\'');
    }
    else
      return statement;
  });
  return change && newSource;
}

var separatorRegEx = /[\/:]/;
jspmUtil.wildcardMatch = function(name, matches, prefix, wildcards) {
  if (name.substr(0, 1) == '.')
    return;
  var curMatch = '';
  var curMatchSuffix = '';
  wildcards = wildcards && [];
  
  main:
  for (var p in matches) {
    var matchParts = p.split(separatorRegEx);
    var nameParts = name.split(separatorRegEx);
    if (matchParts.length > nameParts.length)
      continue;
    if (!prefix && nameParts.length > matchParts.length)
      continue;

    for (var i = 0; i < matchParts.length; i++) {
      // do wildcard matching on individual parts if necessary
      if (wildcards && matchParts[i].indexOf('*') != -1) {
        // check against the equivalent regex from the wildcard statement
        var match = nameParts[i].match(new RegExp(matchParts[i].replace(/([^*\w])/g, '\\$1').replace(/(\*)/g, '(.*)')));
        if (!match)
          continue main;
        // store the wildcard matches
        match.shift();
        wildcards = wildcards.concat(match);
      }
      else if (nameParts[i] != matchParts[i])
        continue main;
    }
  
    if (p.length <= curMatch.length)
      continue;

    curMatch = p;
    curMatchSuffix = name.substr(nameParts.splice(0, matchParts.length).join('/').length);
  }
  return wildcards ? curMatch && { match: curMatch, suffix: curMatchSuffix, wildcards: wildcards } : curMatch;
}
jspmUtil.replaceWildcards = function(target, wildcards) {
  return target.replace(/\*/g, function() {
    return wildcards.shift();
  });
}

jspmUtil.processDependencies = function(repoPath, packageOptions, callback, errback, skipStatic) {
  // NB packageOptions.shim, packageOptions.map, packageOptions.main, packageOptions.format config etc
  //    will need to be applied to the loader before linking instead of static operations in the current changes


  // glob. replace map dependency strings (basic string replacement). at the same time, extract external dependencies.
  glob(repoPath + path.sep + '**' + path.sep + '*.js', function(err, files) {
    if (err)
      return errback(err);

    var processed = 0;
    var total = files.length;
    var dependencies = [];
    for (var i = 0; i < files.length; i++) (function(fileName) {
      var changed = false;
      readFile(fileName, function(err, source) {
        if (err && err.code == 'EISDIR') {
          processed++;
          return;
        }

        if (err)
          return errback(err);

        source += '';

        // apply shim (with wildcards)
        var localPath = path.relative(repoPath, fileName);
        var match;
        localPath = localPath.substr(0, localPath.length - 3);
        if ((match = jspmUtil.wildcardMatch(localPath, packageOptions.shim, false, true))) {
          changed = true;

          // do dep shim
          var shimDeps = packageOptions.shim[match.match];
          if (typeof shimDeps == 'string')
            shimDeps = { imports: [shimDeps] };
          else if (typeof shimDeps == 'boolean')
            shimDeps = { imports: [] };
          else if (shimDeps instanceof Array)
            shimDeps = { imports: shimDeps };

          var depStrs = '';
          if (typeof shimDeps.imports == 'string')
            shimDeps.imports = [shimDeps.imports];
          if (shimDeps.imports)
            for (var i = 0; i < shimDeps.imports.length; i++)
              depStrs += '"import ' + shimDeps.imports[i] + '";\n';

          if (shimDeps.exports)
            depStrs += '"export ' + shimDeps.exports + '";\n';
          
          source = '"global";\n' + depStrs + source;
        }

        // apply dependency map
        if (packageOptions.map) {

          // if there are any relative maps in the map, these are "package-relative"
          // ensure that this is configured
          var oldMaps = {};
          for (var p in packageOptions.map) {
            var v = packageOptions.map[p];
            if (v.substr(0, 2) == './') {
              oldMaps[p] = v;
              v = path.relative(path.dirname(fileName), path.resolve(repoPath, v));
              if (v.substr(0, 1) != '.')
                v = './' + v;
              packageOptions.map[p] = v;
            }
          }

          var newSource;
          // CJS
          // require('name') -> require('new-name');
          newSource = jspmUtil.mapCJSDependencies(source, packageOptions.map);
          if (newSource) {
            source = newSource;
            changed = true;
          }
          // ES6
          // from 'name' -> from 'new-name'
          // import 'name' -> import 'new-name'
          newSource = jspmUtil.mapES6Dependencies(source, packageOptions.map);
          if (newSource) {
            source = newSource;
            changed = true;
          }

          // AMD
          // require(['names', 'are', 'here']) -> require(['new', 'names', 'here'])
          newSource = jspmUtil.mapAMDDependencies(source, packageOptions.map);
          if (newSource) {
            source = newSource;
            changed = true;
          }

          // revert relative mapping
          for (var p in oldMaps) {
            packageOptions.map[p] = oldMaps[p];
          }
        }



        // parse out external dependencies
        var imports = (jspmLoader.link(source, {}) || jspmLoader._link(source, {})).imports;
        if (imports) {
          for (var j = 0; j < imports.length; j++) {

            // map the import name now
            var importName = imports[j];
            if (packageOptions.map) {
              var match = jspmUtil.wildcardMatch(importName, packageOptions.map, true, true);
              if (match)
                importName = jspmUtil.replaceWildcards(packageOptions.map[match.match], match.wildcards) + match.suffix;
            }

            if (importName.indexOf('!') != -1) {
              // plugins get installed
              var pluginName = imports[j].substr(imports[j].indexOf('!') + 1);
              pluginName = pluginName || imports[j].substr(imports[j].lastIndexOf('.') + 1, imports[j].length - imports[j].lastIndexOf('.') - 2);
              if (dependencies.indexOf(pluginName) == -1)
                dependencies.push(pluginName);
              imports[j] = imports[j].substr(0, imports[j].indexOf('!'));
            }
            if (importName.substr(0, 1) != '.') {
              var location;
              if (importName.indexOf(':') != -1)
                location = importName.split(':')[0];
              if (!location)
                importName = importName.split('/')[0];
              else if (location == 'github')
                importName = importName.split('/').splice(0, 2).join('/');
              else
                importName = importName;

              if (dependencies.indexOf(importName) == -1)
                dependencies.push(importName);
            }
          }
        }

        // save back source
        (changed && !skipStatic ? writeFile : function(fileName, source, callback) {
          callback();
        })(fileName, source, function(err) {
          if (err)
            return errback(err);

          processed++;

          if (processed == total)
            callback(dependencies);
        });

      });
    })(files[i]);

    if (!files.length)
      callback(dependencies);
  });
}

jspmUtil.transpile = function(source, sourceMap, file, originalFile, callback) {
  process.nextTick(function() {
    try {
      var transpiler = new Transpiler(source);
      var output = transpiler.toAMD();

      // replace __default__ with default
      output = output.replace(/\.__default__/g, '\.default');

      // add a transpile flag to esnure correct default behaviour
      output = '"es6-transpile";\n' + output;

      callback(null, output);

    }
    catch(e) {
      return callback(e);
    }
  });
}

jspmUtil.spawnCompiler = function(name, source, sourceMap, options, file, originalFile, callback) {
  if (curOpenFiles == maxOpenFiles) {
    spawnQueue.push([name, source, sourceMap, options, file, originalFile, callback]);
    return;
  }
  curOpenFiles++;
  var child = spawn('node', [path.resolve(__dirname, name + '-compiler.js')], {
    cwd: __dirname
    // timeout: 120
  });
  var stdout = [];
  child.stdout.on('data', function(data) {
    stdout.push(data);
  });
  child.stdout.on('end', function() {
    try {
      var output = JSON.parse(stdout.join(''));
    }
    catch(e) {
      return callback(stdout + '');
    }
    curOpenFiles--;
    nextFileQueue;
    callback(output.err, output.source, output.sourceMap);
  });
  child.stdin.on('error', function() {});
  child.stdout.on('error', function() {});
  child.stdin.write(JSON.stringify({
    source: source,
    sourceMap: sourceMap,
    options: options,
    file: file,
    originalFile: originalFile
  }));
  child.stdin.end();
}


var amdCJSRegEx = /^\s*define\s*\(\s*function.+\{\s*$/m;
var cjsRequireRegEx = /(?:^\s*|[}{\(\);,\n=:]\s*)require\s*\(\s*("([^"]+)"|'([^']+)')\s*\)/g;
var firstLineCommentRegEx = /^( *\/\/.*| *\/\*[^\*]*)\n/;

jspmUtil.compile = function(repoPath, basePath, baseURL, packageOptions, callback) {

  buildOptions = packageOptions && packageOptions.buildConfig || {};

  if (!buildOptions.traceur && !buildOptions.uglify)
    return callback();

  glob(repoPath + '/**/*.js', function(err, files) {
    if (err)
      return callback(err);
    
    var completed = 0;
    var errors = '';

    var fileComplete = function(err, file, originalFile) {
      if (err) {
        if (errors.indexOf(file) == -1)
          errors += file + ':\n';
        errors += JSON.stringify(err) + '\n';
        // revert to original
        return fs.rename(originalFile, file, function() {
          fileComplete(null, file);
        });
      }
      completed++;
      if (completed == files.length) {
        if (errors) {
          writeFile(repoPath + path.sep + 'jspm-build.log', errors, function() {
            callback(errors);
          });
        }
        else
          callback();
      }
    }

    for (var i = 0; i < files.length; i++) (function(file) {

      // avoid symlink loops
      var exists = fs.existsSync(file.replace(/\.js$/, '.js.map'));
      if (exists)
        return fileComplete(null, file);

      // 1. rename to new original name
      var originalFile = file.replace(/\.js$/, '.src.js');
      fs.renameSync(file, originalFile);

      // 2. get the source
      readFile(originalFile, function(err, source) {
        if (err)
          return fileComplete(err, file, originalFile);

        source += '';

        var originalFileName = path.relative(path.dirname(originalFile), originalFile);
        var fileName = path.relative(path.dirname(file), file);

        // 3. traceur
        (buildOptions.traceur ? jspmUtil.spawnCompiler : function(name, source, sourceMap, options, fileName, originalFileName, callback) {
          callback(null, source, null);
        })('traceur', source, null, buildOptions.traceur === true ? {} : buildOptions.traceur, fileName, originalFileName, function(err, source, sourceMap) {
          if (err)
            return fileComplete(err, file, originalFile);

          // 4. transpile
          (buildOptions.traceur ? jspmUtil.transpile : function(source, sourceMap, fileName, originalFileName, callback) {
            callback(null, source, sourceMap);
          })(source, sourceMap, fileName, originalFileName, function(err, source, sourceMap) {

            if (err)
              return fileComplete(err, file, originalFile);

            // explicitly write in CJS requires before minification
            var cjsStatement;
            if (buildOptions.traceur && (cjsStatement = source.match(amdCJSRegEx))) {
              var requires = ['require', 'exports', 'module'];
              var match;
              while (match = cjsRequireRegEx.exec(source))
                requires.push(match[2] || match[3]);

              source = source.replace(cjsStatement[0], cjsStatement[0].replace(/define\s*\(/, 'define(' + JSON.stringify(requires) + ', '));
            }

            // save the source as the original source at this point
            // this makes source map support 'sort of' work
            writeFile(originalFile, source, function(err) {
              if (err)
                return fileComplete(err, file, originalFile);

              // 5. uglify
              (buildOptions.uglify ? jspmUtil.spawnCompiler : function(name, source, sourceMap, options, fileName, originalFileName, callback) {
                callback(null, source, sourceMap);
              })('uglify', source, null, buildOptions.uglify || {}, fileName, originalFileName, function(err, source, sourceMap) {
                if (err) {
                  return fileComplete(err.message || err, file, originalFile);
                }

                // if the first line is not a comment
                // add one extra line at the top, and include this in the source map
                if (buildOptions.uglify && source && !source.match(firstLineCommentRegEx)) {
                  source = '\n' + source;
                  var m = JSON.parse(sourceMap);
                  m.mappings = ';' + m.mappings;
                  sourceMap = JSON.stringify(m);
                }

                // 6. save the file and final source map
                writeFile(file, source
                  + (sourceMap ? '\n//# sourceMappingURL=' + (baseURL || '') + path.relative(basePath, file) + '.map' : ''), function(err) {
                  if (err)
                    return fileComplete(err, file, originalFile);

                  writeFile(file + '.map', sourceMap, function(err) {
                    if (err)
                      return fileComplete(err, file, originalFile);

                    fileComplete(null, file);
                  });
                });
              });

            });

          });

        });

      });

    })(files[i]);

    if (files.length == 0)
      callback();
  });
}

jspmUtil.getMain = function(repoPath, main) {
  if (main) {
    if (main.substr(0, 2) == './')
      main = main.substr(2);
    if (main.substr(main.length - 3, 3) == '.js')
      main = main.substr(0, main.length - 3);
    if (fs.existsSync(repoPath + '/' + main + '.js'))
      return main;
  }

  if (fs.existsSync(repoPath + '/index.js'))
    return 'index';

  var name = repoPath.split('/').pop().split('@')[0];
  if (fs.existsSync(repoPath + '/' + name + '.js'))
    return name;
}

jspmUtil.createVersionMap = function(versions) {
  var versionMap = {};

  // store a list of latest minors to set their meta at the end
  var latestMinorVersions = [];

  // build up the version map
  for (var v in versions) {
    var version = semver.valid(v);
    var exactVersion = version && version.match(jspmUtil.exactVersionRegEx);
    version = version || v;

    var curMap = { version: version, hash: versions[v] };

    if (exactVersion) {
      // add the exact version to the version map
      versionMap[version] = curMap;
      
      // set latest version if it is
      if (!versionMap.latest)
        versionMap.latest = curMap;
      if (semver.gt(version, versionMap.latest.version))
        versionMap.latest = curMap;

      // set minor version if it is
      var minorVersion = version.split('.').splice(0, 2).join('.');
      if (!versionMap[minorVersion]) {
        versionMap[minorVersion] = curMap;
        latestMinorVersions.push(version);
      }
      if (!semver.valid(versionMap[minorVersion].version) || semver.gt(version, versionMap[minorVersion].version)) {
        // bump off the last latest minor listed and replace with this
        var oldMinorIndex = latestMinorVersions.indexOf(versionMap[minorVersion].version);
        latestMinorVersions.splice(oldMinorIndex, 1);
        latestMinorVersions.push(version);

        versionMap[minorVersion] = curMap;                
      }
    }
    else {
      // add the tag version to the version map
      versionMap[version] = curMap;
    }
  }

  // if latest still not set then use 'master' tag
  if (!versionMap.latest && versionMap.master)
    versionMap.latest = { version: 'master', hash: versionMap.master.hash };

  // set the latest meta
  if (versionMap.latest)
    versionMap[versionMap.latest.version].isLatest = true;

  // set the latest minor meta
  for (var i = 0; i < latestMinorVersions.length; i++)
    versionMap[latestMinorVersions[i]].isLatestMinor = true;

  return versionMap;
}
module.exports = jspmUtil;
