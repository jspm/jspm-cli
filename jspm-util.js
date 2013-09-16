var semver = require('semver');
var fs = require('fs');
var path = require('path');
var glob = require('glob');
var rimraf = require('rimraf');
var jspmLoader = require('jspm-loader');
var uglifyJS = require('uglify-js');
var https = require('https');

var jspmUtil = {};

jspmUtil.exactVersionRegEx = /^(\d+)(\.\d+)(\.\d+)?$/;

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

jspmUtil.extend = function(objA, objB) {
  for (var p in objB)
    if (typeof objA[p] == 'object')
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
    for (var i = 0; i < files.length; i++) {
      fs.readFile(files[i], function(err, source) {
        if (err)
          return errback(err);

        source += '';

        // apply dependency map
        for (var name in packageOptions.dependencyMap) {
          var mapped = packageOptions.dependencyMap[name];
          source.replace(new RegExp('"' + name + '"|\'' + name + '\'', 'g'), mapped);
        }

        // parse out external dependencies
        var imports = (jspmLoader.link(source, {}) || jspmLoader._link(source, {})).imports;
        for (var j = 0; j < imports.length; j++)
          if (imports[j].substr(0, 1) != '.')
            if (dependencies.indexOf(imports[j]) == -1)
              dependencies.push(imports[j]);

        processed++;

        if (processed == files.length)
          callback(dependencies);
      });
    }

    if (!files.length)
      callback(dependencies);
  });
}
jspmUtil.compile = function(repoPath, buildOptions, callback, errback) {
  // NB add source map support at file.map
  glob(repoPath + '/**/*.js', function(err, files) {
    if (err)
      return errback(err);
    
    var completed = 0;
    var error = false;
    for (var i = 0; i < files.length; i++) (function(file) {
      // avoid symlink loops
      var exists = fs.existsSync(file + '.original');
      if (exists) {
        completed ++;
        if (completed == files.length)
          callback();
        return;
      }
      fs.renameSync(file, file + '.original');

      process.nextTick(function() {
        try {
          var cwd = process.cwd();
          process.chdir(repoPath);
          var result = uglifyJS.minify(path.relative(repoPath, file) + '.original', {
            outSourceMap: path.relative(repoPath, file) + '.map',
            compress: buildOptions && buildOptions.uglifyjs
          });
          process.chdir(cwd);
        }
        catch(e) {
          error || errback(e);
          return error = true;
        }
        result.code += '//@sourceMappingURL=' + path.relative(repoPath, file) + '.map';
        fs.writeFile(file, result.code, function(err) {
          if (err) {
            error || errback(err);
            return error = true;
          }
          fs.writeFile(file + '.map', result.map, function(err) {
            if (err)
              return errback(err);
            completed++;

            if (completed == files.length)
              callback();
          });
        });
      });
    })(files[i]);

    if (files.length == 0)
      callback();
  });
}

jspmUtil.getMain = function(repoPath, packageOptions) {
  var main = packageOptions.browserMain || packageOptions.main;

  if (main) {
    if (main.substr(0, 2) == './')
      main = main.substr(2);
    if (main.substr(main.length - 3, 3) == '.js')
      main = main.substr(0, main.length - 3);
    if (fs.existsSync(repoPath + main + '.js'))
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