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
var maxOpenFiles = 10;

var readQueue = [];

jspmUtil.exactVersionRegEx = /^(\d+)(\.\d+)(\.\d+)?$/;


var readFile = function(file, callback) {
  if (curOpenFiles >= maxOpenFiles)
    return readQueue.push({ file: file, callback: callback });

  curOpenFiles++;
  fs.readFile(file, function(err, source) {
    curOpenFiles--;

    var next = readQueue.pop();
    if (next)
      readFile(next.file, next.callback);

    callback(err, source);
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
        if (removeFiles.indexOf(fileFiles[i]) != -1)
          removeFiles.splice(removeFiles.indexOf(fileFiles[i]), 1);
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
                removeFiles.push(files[j]);
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
    callback(null, pjson.jspm || pjson);
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
        return callback(!resData.join('') ? 'Not found' : 'Invalid registry response.');
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
jspmUtil.processDependencies = function(repoPath, packageOptions, callback, errback) {
  // glob. replace map dependency strings (basic string replacement). at the same time, extract external dependencies.
  glob(repoPath + path.sep + '**' + path.sep + '*.js', function(err, files) {
    if (err)
      return errback(err);

    var processed = 0;
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

        // apply dependency shim
        var localPath = path.relative(repoPath, fileName);
        for (var name in packageOptions.shim) {
          var relName = name.substr(0, 2) == './' ? name.substr(2) : name;
          if (relName.substr(relName.length - 3, 3) != '.js')
            relName += '.js';
          if (relName == localPath) {
            changed = true;

            // do dep shim
            var shimDeps = packageOptions.shim[name];
            if (typeof shimDeps == 'string')
              shimDeps = [shimDeps];
            else if (typeof shimDeps == 'boolean')
              shimDeps = { imports: [] };
            else if (shimDeps instanceof Array)
              shimDeps = { imports: shimDeps };

            var depStrs = '';
            for (var i = 0; i < shimDeps.imports.length; i++)
              depStrs += '"import ' + shimDeps.imports[i] + '";\n';

            if (shimDeps.exports)
              depStrs += '"export ' + shimDeps.exports + '";\n';
            
            source = '"global";\n' + depStrs + source;
          }
        }

        // apply dependency map
        for (var name in packageOptions.dependencyMap) {
          var mapped = packageOptions.dependencyMap[name];
          if (mapped != name) {
            changed = true;
            name = name.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
            source = source.replace(new RegExp('"' + name + '"|\'' + name + '\'', 'g'), '\'' + mapped + '\'');
          }
        }

        // parse out external dependencies
        var imports = (jspmLoader.link(source, {}) || jspmLoader._link(source, {})).imports;
        if (imports) {
          for (var j = 0; j < imports.length; j++) {
            if (imports[j].indexOf('!') != -1) {
              // plugins get installed
              var pluginName = imports[j].substr(imports[j].indexOf('!') + 1);
              pluginName = pluginName || imports[j].substr(imports[j].lastIndexOf('.') + 1, imports[j].length - imports[j].lastIndexOf('.') - 2);
              if (dependencies.indexOf(pluginName) == -1)
                dependencies.push(pluginName);
              imports[j] = imports[j].substr(0, imports[j].indexOf('!'));
            }
            if (imports[j].substr(0, 1) != '.') {
              var importName;
              var location;
              if (imports[j].indexOf(':') != -1)
                location = imports[j].split(':')[0];
              if (!location)
                importName = imports[j].split('/')[0];
              else if (location == 'github')
                importName = imports[j].split('/').splice(0, 2).join('/');
              else
                importName = imports[j];

              if (dependencies.indexOf(importName) == -1)
                dependencies.push(importName);
            }
          }
        }

        // save back source
        (changed ? fs.writeFile : function(fileName, source, callback) {
          callback();
        })(fileName, source, function(err) {
          if (err)
            return errback(err);

          processed++;

          if (processed == files.length)
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

var curSpawns = 0;
var maxSpawns = 10;
var spawnQueue = [];
jspmUtil.spawnCompiler = function(name, source, sourceMap, options, file, originalFile, callback) {
  if (curSpawns == maxSpawns) {
    spawnQueue.push([name, source, sourceMap, options, file, originalFile, callback]);
    return;
  }
  curSpawns++;
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
    curSpawns--;
    if (curSpawns < maxSpawns) {
      var next = spawnQueue.pop();
      if (next)
        jspmUtil.spawnCompiler.apply(null, next);
    }
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

jspmUtil.compile = function(repoPath, basePath, baseURL, buildOptions, callback) {

  buildOptions = buildOptions || {};

  if (!buildOptions.traceur && !buildOptions.transpile && !buildOptions.uglify)
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
        errors += err + '\n';
        // revert to original
        return fs.rename(originalFile, file, function() {
          fileComplete(null, file);
        });
      }
      completed++;
      if (completed == files.length) {
        if (errors) {
          fs.writeFile(repoPath + path.sep + 'jspm-build.log', errors, function() {
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
          (buildOptions.transpile ? jspmUtil.transpile : function(source, sourceMap, fileName, originalFileName, callback) {
            callback(null, source, sourceMap);
          })(source, sourceMap, fileName, originalFileName, function(err, source, sourceMap) {

            if (err)
              return fileComplete(err, file, originalFile);

            // explicitly write in CJS requires before minification
            var cjsStatement;
            if (cjsStatement = source.match(amdCJSRegEx)) {
              var requires = ['require', 'exports', 'module'];
              var match;
              while (match = cjsRequireRegEx.exec(source))
                requires.push(match[2] || match[3]);

              source = source.replace(cjsStatement[0], cjsStatement[0].replace(/define\s*\(/, 'define(' + JSON.stringify(requires) + ', '));
            }

            // save the source as the original source at this point
            // this makes source map support 'sort of' work
            fs.writeFile(originalFile, source, function(err) {
              if (err)
                return fileComplete(err, file, originalFile);

              // 5. uglify
              (buildOptions.uglify ? jspmUtil.spawnCompiler : function(name, source, sourceMap, options, fileName, originalFileName, callback) {
                callback(null, source, sourceMap);
              })('uglify', source, null, buildOptions.uglify || {}, fileName, originalFileName, function(err, source, sourceMap) {
                if (err)
                  return fileComplete(err, file, originalFile);

                // if the first line is not a comment
                // add one extra line at the top, and include this in the source map
                if (source && !source.match(firstLineCommentRegEx)) {
                  source = '\n' + source;
                  var m = JSON.parse(sourceMap);
                  m.mappings = ';' + m.mappings;
                  sourceMap = JSON.stringify(m);
                }

                // 6. save the file and final source map
                fs.writeFile(file, source
                  + (sourceMap ? '\n//# sourceMappingURL=' + (baseURL || '') + path.relative(basePath, file) + '.map' : ''), function(err) {
                  if (err)
                    return fileComplete(err, file, originalFile);

                  fs.writeFile(file + '.map', sourceMap, function(err) {
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
    var exactVersion = semver.valid(v);

    if (exactVersion && !exactVersion.match(jspmUtil.exactVersionRegEx))
      exactVersion = false;

    var curMap = { version: exactVersion || v, hash: versions[v] };

    if (exactVersion) {
      // add the exact version to the version map
      versionMap[exactVersion] = curMap;
      
      // set latest version if it is
      if (!versionMap.latest)
        versionMap.latest = curMap;
      if (semver.gt(exactVersion, versionMap.latest.version))
        versionMap.latest = curMap;

      // set minor version if it is
      var minorVersion = exactVersion.split('.').splice(0, 2).join('.');
      if (!versionMap[minorVersion]) {
        versionMap[minorVersion] = curMap;
        latestMinorVersions.push(exactVersion);
      }
      if (!semver.valid(versionMap[minorVersion].version) || semver.gt(exactVersion, versionMap[minorVersion].version)) {
        // bump off the last latest minor listed and replace with this
        var oldMinorIndex = latestMinorVersions.indexOf(versionMap[minorVersion].version);
        latestMinorVersions.splice(oldMinorIndex, 1);
        latestMinorVersions.push(exactVersion);

        versionMap[minorVersion] = curMap;                
      }
    }
    else {
      // add the tag version to the version map
      versionMap[v] = curMap;
    }
  }

  // if latest still not set then use 'master' tag
  if (!versionMap.latest && versionMap.master)
    versionMap.latest = { version: 'master', hash: versionMap.master.hash };

  // set the latest meta
  versionMap[versionMap.latest.version].isLatest = true;

  // set the latest minor meta
  for (var i = 0; i < latestMinorVersions.length; i++)
    versionMap[latestMinorVersions[i]].isLatestMinor = true;

  return versionMap;
}

module.exports = jspmUtil;
