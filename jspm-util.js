var semver = require('semver');
var fs = require('fs');
var path = require('path');
var glob = require('glob');
var rimraf = require('rimraf');
var jspmLoader = require('jspm-loader');
var https = require('https');
var Transpiler = require('es6-module-transpiler').Compiler;
var spawn = require('child_process').spawn;

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
        return callback(resData.join('') || 'Invalid registry response.');
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
    collapseDir = packageOptions.directories.build || packageOptions.directories.lib;

    if (packageOptions.directories.build)
      isBuilt = true;
  }

  if (!collapseDir)
    return callback(isBuilt);

  // move lib dir into temporary path
  var tmpPath = path.resolve(repoPath, '../.tmp-' + repoPath.split('/').pop());
  fs.rename(repoPath + '/' + collapseDir, tmpPath, function(err) {
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
  glob(repoPath + '/**/*.js', function(err, files) {
    if (err)
      return errback(err);

    var processed = 0;
    var dependencies = [];
    for (var i = 0; i < files.length; i++) (function(fileName) {
      readFile(fileName, function(err, source) {
        if (err)
          return errback(err);

        source += '';

        // apply dependency shim
        var localPath = path.relative(repoPath, fileName);
        for (var name in packageOptions.dependencyShim) {
          var relName = name.substr(0, 2) == './' ? name.substr(2) : name;
          if (relName.substr(relName.length - 3, 3) != '.js')
            relName += '.js';
          if (relName == localPath) {
            // do dep shim
            var shimDeps = packageOptions.dependencyShim[name];
            if (typeof shimDeps == 'string')
              shimDeps = [shimDeps];

            var depStrs = '';
            for (var i = 0; i < shimDeps.length; i++)
              depStrs += '"import ' + shimDeps[i] + '";\n';
            
            source = depStrs + source;            
          }
        }

        // apply dependency map
        for (var name in packageOptions.dependencyMap) {
          var mapped = packageOptions.dependencyMap[name];
          name = name.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
          source = source.replace(new RegExp('"' + name + '"|\'' + name + '\'', 'g'), '\'' + mapped + '\'');
        }

        // parse out external dependencies
        if (packageOptions.config && packageOptions.config.traceDependencies) {
          var imports = (jspmLoader.link(source, {}) || jspmLoader._link(source, {})).imports;
          if (imports) {
            for (var j = 0; j < imports.length; j++)
              if (imports[j].substr(0, 1) != '.')
                if (dependencies.indexOf(imports[j]) == -1)
                  dependencies.push(imports[j]);
          }
        }

        // save back source
        fs.writeFile(fileName, source, function(err) {
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
    }
    catch(e) {
      return callback(e);
    }
    callback(null, output);
  });
}

jspmUtil.spawnCompiler = function(name, source, sourceMap, options, file, originalFile, callback) {
  var child = spawn('node', [path.resolve(__dirname, name + '-compiler.js')], {
    cwd: __dirname,
    timeout: 120
  });
  child.stderr.on('data', function(stderr) {
    callback(stderr + '');
  });
  child.stdout.on('data', function(stdout) {
    try {
      var output = JSON.parse(stdout)
    }
    catch(e) {
      return callback('Invalid output.');
    }

    callback(null, output.source, output.sourceMap);
  });
  child.stdin.write(JSON.stringify({
    source: source,
    sourceMap: sourceMap,
    options: options,
    file: file,
    originalFile: originalFile
  }));
  child.stdin.end();
}

jspmUtil.compile = function(repoPath, basePath, baseURL, buildOptions, callback) {

  buildOptions = buildOptions || {};

  if (buildOptions.uglify === false)
    return callback();

  glob(repoPath + '/**/*.js', function(err, files) {
    if (err)
      return callback(err);
    
    var completed = 0;
    var errors = '';

    var fileComplete = function(err, file, originalFile) {
      if (err) {
        if (!errors)
          errors += file;
        errors += err + '\n';
        // revert to original
        return fs.rename(originalFile, file, function() {
          fileComplete(null, file);
        });
      }
      completed++;
      if (completed == files.length) {
        if (errors) {
          fs.writeFile(repoPath + '/jspm-build.log', file + '\n' + errors, function() {
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

            // 5. uglify
            (buildOptions.uglify !== false ? jspmUtil.spawnCompiler : function(name, source, sourceMap, options, fileName, originalFileName, callback) {
              callback(null, source, sourceMap);
            })('uglify', source, sourceMap, buildOptions.uglify || {}, fileName, originalFileName, function(err, source, sourceMap) {
              if (err)
                return fileComplete(err, file, originalFile);

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

    })(files[i]);

    if (files.length == 0)
      callback();
  });
}

jspmUtil.getMain = function(repoPath, packageOptions) {
  var main = packageOptions.main;

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