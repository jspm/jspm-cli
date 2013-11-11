#!/usr/bin/env node

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
var mkdirp = require('mkdirp');
var fs = require('fs');
var path = require('path');
var semver = require('semver');
var rimraf = require('rimraf');
var https = require('https');
var exec = require('child_process').exec;

var jspmUtil = require('./jspm-util');

var installing = {};
var locations = {};
var versionCache = {};
var downloadQueue = {};

// identity callback function, based on last argument being a callback
var ic = function() {
  arguments[arguments.length - 1]();
}
var ice = function() {
  arguments[arguments.length - 2]();
}

var Installer = {
  // get location downloader instance
  getLocation: function(target) {
    var locationName = target.indexOf(':') != -1 ? target.split(':')[0] : 'lib';

    if (locations[locationName])
      return locations[locationName];

    var locationDownloader;

    try {
      locationDownloader = require('jspm-' + locationName);
    }
    catch (e) {
      return;
    }

    // ensure the download dir and tmp dir exist
    var tmpDir = process.env.HOME + path.sep + '.jspm' + path.sep + 'tmp-' + locationName;
    var baseDir = Config.pjson.directories.jspm_packages + path.sep + locationName;

    mkdirp.sync(tmpDir);
    mkdirp.sync(baseDir);

    locations[locationName] = new locationDownloader({
      tmpDir: tmpDir,
      log: false,
      https: useHttps,
      cdn: false
    });

    locations[locationName].name = locationName;
    locations[locationName].baseDir = baseDir;

    return locations[locationName];
  },
  versionLookup: function(repo, version, location, callback, errback) {
    // returns { notfound, isLatest, isLatestMinor, hash, version }

    version = version || 'latest';

    if (versionCache[repo]) {
      if (versionCache[repo][version])
        return callback(versionCache[repo][version]);
      else
        return callback({ notfound: true });
    }

    location.getVersions(repo, function(versions, alias) {

      if (!versions)
        return callback({ notfound: true });

      var versionMap = jspmUtil.createVersionMap(versions);
      versionCache[repo] = versionMap;

      if (versionMap[version])
        callback(versionMap[version]);
      else
        callback({ notfound: true });

    }, errback);

  },
  // determines
  // 1. is the repo installed and fresh
  // 2. does the map config needing updating
  // callback(isFresh, updateMap)
  checkRepo: function(repo, lookup, initialTarget, location, callback, errback) {

    var baseName = location.name + ':' + repo;
    var exactName = baseName + '@' + lookup.version;

    // check map config
    var curName = Config.pjson.dependencyMap[initialTarget];

    // if it doesnt match, ask
    (curName && curName != exactName ? Input.confirm : function(q, callback) {
      callback(curName ? false : true, false);
    })('Update latest ^' + initialTarget + '^ from ^' + curName + '^ to ' + lookup.version + '?', function(updateMap) {

      // check freshness
      try {
        var hash = fs.readFileSync(location.baseDir + path.sep + repo + '@' + lookup.version + path.sep + '.jspm-hash');
      }
      catch(e) {
        return callback(false, updateMap);
      }

      if (hash == lookup.hash)
        return callback(true, updateMap);

      Input.confirm('^' + baseName + '@' + lookup.version + '^ is already installed, but has an update. Do you want to apply it?', function(confirm) {
        callback(!confirm, updateMap);
      });
    });

  },

  // implements a download with some basic queueing
  downloadRepo: function(location, repo, version, hash, path, callback) {
    var repoName = location.name + ':' + repo;
    if (downloadQueue[repoName]) {
      downloadQueue[repoName].push([version, hash, path, callback]);
      return;
    }
    else
      downloadQueue[repoName] = [[version, hash, path, callback]];

    var doNext = function() {
      var next = downloadQueue[repoName].shift();
      if (next)
        location.download(repo, next[0], next[1], next[2], function(packageOptions) {
          next[3](null, packageOptions);
          doNext();
        }, function(err) {
          next[3](err);
          doNext();
        });
      else
        delete downloadQueue[repoName];
    }
    doNext();
  },

  getPackageOptions: function(location, repo, version, callback) {

    var repoPath = path.resolve(location.baseDir + path.sep + repo + '@' + version);
    var fullName = location.name + ':' + repo + '@' + version;

    jspmUtil.getPackageJSON(repoPath, function(err, pjson) {

      if (err)
        return callback(err);

      // check for a package override
      Installer.checkPackageOverride(location, fullName, function(err, packageOptions) {
        if (err)
          return callback(err);

        pjson = pjson || {};
        packageOptions = jspmUtil.extend(pjson, packageOptions);
        try {
          fs.writeFileSync(path.resolve(repoPath, 'package.json'), JSON.stringify(pjson));
        }
        catch(e) {
          return callback('Unable to write package.json');
        }

        callback(null, packageOptions);

      });

    });

  },

  // also does processing
  // returns dependencies
  installRepo: function(repo, lookup, location, initialTarget, updateMap, callback, errback) {

    var repoPath = path.resolve(location.baseDir + path.sep + repo + '@' + lookup.version);
    var fullName = location.name + ':' + repo + '@' + lookup.version;

    rimraf(repoPath, function(err) {

      Installer.downloadRepo(location, repo, lookup.version, lookup.hash, repoPath, function(err, packageOptions) {

        if (err)
          return errback(err);

        if (packageOptions === false)
          packageOptions = {};

        (!packageOptions ? Installer.getPackageOptions : function(location, repo, version, callback) {
          callback(null, packageOptions);
        })(location, repo, lookup.version, function(err, packageOptions) {

          if (err)
            return errback(err);
          
          jspmUtil.applyIgnoreFiles(repoPath, packageOptions.files, packageOptions.ignore, function(err) {

            if (err)
              log(Msg.err('Error applying files and ignore. \n' + err));

            // collapse the lib directory if present
            jspmUtil.collapseLibDir(repoPath, packageOptions, function(isBuilt) {

              // process dependencies (apply dependency map, and return external dependencies)
              jspmUtil.processDependencies(repoPath, packageOptions, function(dependencies) {

                // run compilation (including minify) if necessary
                (!isBuilt ? jspmUtil.compile : ice)(repoPath, path.dirname(path.resolve(Config.pjsonDir, Config.pjson.configFile)), null, packageOptions.buildConfig, function(err) {

                  if (err)
                    log(Msg.err(err + ''));

                  // create the main entry point shortcut
                  Installer.createMain(repoPath, packageOptions.main, function(err) {

                    if (err)
                      log(Msg.warn('No main entry point created for ^' + fullName + '^'));

                    // ignore unresolved dependencies
                    /* for (var i = 0; i < dependencies.length; i++) {
                      if (dependencies[i].indexOf(':') == -1) {
                        log(Msg.warn('Ignoring unresolved external dependency ^' + dependencies[i] + '^'));
                        dependencies.splice(i--, 1);
                      }
                    } */

                    // set up the version map
                    if (updateMap && initialTarget != fullName) {
                      Config.pjson.dependencyMap[initialTarget] = fullName;
                    }

                    // write to the .jspm-hash file in the folder
                    // also save the overridden package.json
                    try {
                      fs.writeFileSync(path.resolve(repoPath, '.jspm-hash'), lookup.hash);
                      fs.writeFileSync(path.resolve(repoPath, 'package.json'), JSON.stringify(packageOptions, null, 2));
                    }
                    catch(e) {}

                    // return the external dependency array
                    callback(dependencies);

                  });

                }, errback);

              }, errback);

            }, errback);

          });

        });

      });

    }, errback);
  },

  // given a location, repo name and optional main, create the shortcut js file
  createMain: function(repoPath, main, callback) {
    main = jspmUtil.getMain(repoPath, main);

    if (!main)
      return callback(false);

    fs.writeFile(repoPath + '.js', 'export * from "./' + repoPath.split('/').pop() + '/' + main + '";', callback);
  },

  checkPackageOverride: function(location, fullName, callback) {
    log(Msg.info('Checking ^' + fullName + '^ for package.json override'));
    https.get({
      hostname: 'github.jspm.io',
      path: '/jspm/registry@master/package-overrides/' + fullName.replace(':', '/') + '.json',
      rejectUnauthorized: false
    }, function(res) {
      if (res.statusCode == 404) {
        res.socket.destroy();
        return callback(null, null);
      }

      if (res.statusCode != 200) {
        res.socket.destroy();
        return callback('Error checking for package.json override.');
      }

      var pjsonData = [];
      res.on('data', function(chunk) {
        pjsonData.push(chunk);
      });
      res.on('end', function() {
        try {
          var pjson = JSON.parse(pjsonData.join(''));
        }
        catch(e) {
          return callback('Unable to parse override package.json');
        }
        log(Msg.info('Applying override'));
        callback(null, pjson);
      });
      res.on('error', function(err) {
        callback('Error checking for package.json override.');
      });
    });
  },
  install: function(target, initialTarget, force, callback) {

    if (target instanceof Array) {
      var installed = 0;

      var checkComplete = function(err, fullName) {
        installed++;
        if (installed < target.length)
          return;

        callback(err);
      }

      for (var i = 0; i < target.length; i++)
        Installer.install(target[i], initialTarget && initialTarget[i], force, checkComplete);

      if (target.length == 0)
        checkComplete();
      return;
    }
    
    // registry install
    if (target.indexOf(':') == -1) {
      log(Msg.info('Looking up ^' + target + '^ in registry'));
      jspmUtil.registryLookup(target, function(err, entry) {
        if (err) {
          log(Msg.err('Error performing registry lookup for ^' + target + '^. \n' + err));
          return callback(err);
        }
        Installer.install(entry.name, initialTarget || target, force, callback);
      });
      return;
    }

    // get the location
    var location = Installer.getLocation(target);

    if (!location) {
      log(Msg.warn('Install of ^' + target + '^ failed, location downloader not present. \n'
        + 'Try running _npm install -g jspm-' + target.substr(0, target.indexOf(':')) + '%.'));
      return callback(true);
    }

    // get the repo name and version
    var repo = target.substr(target.indexOf(':') + 1);
    var version = repo.indexOf('@') == -1 ? '' : repo.substr(repo.indexOf('@') + 1);
    if (version)
      repo = repo.substr(0, repo.length - version.length - 1);

    log(Msg.info('Getting version list for ^' + target + '^'));
    Installer.versionLookup(repo, version, location, function(lookup) {
      // lookup: isLatest, isLatestMinor, hash, exactVersion

      if (lookup.notfound) {
        log(Msg.warn('^' + repo + (version ? '@' + version : '') + '^ not found!'))
        return callback(true);
      }

      var fullName = location.name + ':' + repo + '@' + lookup.version;

      // if already installing, queue the callbacks
      if (installing[fullName])
        return installing[fullName].push(callback);
      installing[fullName] = [callback];

      callback = function(err, fullName) {
        if (!err && fullName) {
          // find all references in the config
          var names = [];
          for (var m in Config.pjson.dependencyMap)
            if (Config.pjson.dependencyMap[m].substr(0, fullName.length) == fullName)
              names.push(m);

          log(Msg.ok('^' + fullName + '^ installed as %' + names.join('%, %') + '%'));
        }
        for (var i = 0; i < installing[fullName].length; i++)
          installing[fullName][i](err);
      };

      initialTarget = initialTarget || target;

      // check that what is in the file system matches the lookup
      (!force ? Installer.checkRepo : function(repo, lookup, initialTarget, location, callback) {
        callback(false, true);
      })(repo, lookup, initialTarget, location, function(isFresh, updateMap) {

        if (isFresh) {
          log(Msg.info('^' + fullName + '^ already up to date.'));
          if (!updateMap)
            return callback(null, fullName);
          Config.pjson.dependencyMap[initialTarget] = fullName;
          callback(null, fullName);
          return;
        }

        log(Msg.info('Downloading ^' + fullName + '^'));
        Installer.installRepo(repo, lookup, location, initialTarget, updateMap, function(dependencies) {
          // install dependencies if any
          Installer.install(dependencies || [], dependencies || [], false, function(err) {

            callback(err, fullName);
          });

        }, function(err) {
          log(Msg.err('Error downloading repo ^' + fullName + '^\n' + err));
          callback(err);
        });

      }, function(err) {
        log(Msg.err('Error checking current repo ^' + repo + '@' + lookup.version + '^\n' + err));
        callback(err);
      });

    }, function(err) {
      log(Msg.err('Error looking up version for ' + repo + '\n' + err));
      callback(err);
    });
  }
};


var configRegEx = /^(\s*)jspm.config\((\{[\s\S]*\})\)/m;

var Config = {
  pjson: null,
  pjsonDir: null,
  getConfig: function(checkDir, callback) {
    if (arguments.length == 1) {
      callback = checkDir;
      checkDir = process.cwd();
    }
    var pathArr = path.resolve(checkDir).split(path.sep);
    pathArr.pop();
    var nextDir = pathArr.join(path.sep);
    jspmUtil.getPackageJSON(checkDir, function(err, _pjson) {
      if (err) {
        log(Msg.err(err + ' at ' + checkDir + '/package.json'));
        return;
      }
      else if (!_pjson) {
        if (nextDir)
          Config.getConfig(nextDir, callback);
        else {
          Config.pjson = {};
          Config.verifyConfig(function() {
            callback(Config.pjson, Config.pjsonDir);
          });
        }
        return;
      }

      if (checkDir == process.cwd()) {
        Config.pjson = _pjson;
        Config.pjsonDir = process.cwd();
        Config.verifyConfig(function() {
          callback(Config.pjson, Config.pjsonDir);
        });
        return;
      }

      // if any of the package dirs are this dir, then we have the right package.json
      var dirList = [];
      if (_pjson.directories) {
        for (var d in _pjson.directories)
          dirList.push(_pjson.directories[d]);
      }
      if (_pjson.configFile)
        dirList.push(path.dirname(_pjson.configFile));
      if (_pjson.main)
        dirList.push(path.dirname(_pjson.main));

      for (var i = 0; i < dirList.length; i++) {
        if (jspmUtil.dirContains(path.resolve(checkDir, dirList[i]), process.cwd())) {
          Config.pjson = _pjson;
          Config.pjsonDir = checkDir;
          return Config.verifyConfig(function() {
            callback(Config.pjson, Config.pjsonDir);
          });
        }
      }

      Config.pjson = {};
      Config.verifyConfig(function() {
        callback(Config.pjson, Config.pjsonDir);
      });
    });
  },
  verifyConfig: function(callback) {
    if (Config.pjson.configFile === undefined) {
      Input.get('Enter config file location', 'config.js', function(input) {
        Config.pjson.configFile = input || 'config.js';
        return Config.verifyConfig(callback);
      });
      return;
    }
    else if (!Config.pjson.directories || !Config.pjson.directories.jspm_packages) {
      Input.get('Enter external library install location', 'jspm_packages', function(input) {
        Config.pjson.directories = Config.pjson.directories || {};
        Config.pjson.directories.jspm_packages = input || 'jspm_packages';
        return Config.verifyConfig(callback);
      });
      return;
    }
    else if (!Config.pjson.directories || !Config.pjson.directories.lib) {
      Input.get('Enter local application code location / baseURL', 'lib', function(input) {
        Config.pjson.directories = Config.pjson.directories || {};
        Config.pjson.directories.lib = input || 'lib';
        return Config.verifyConfig(callback);
      });
    }
    else {
      Config.pjson.dependencyMap = Config.pjson.dependencyMap || {};
      callback();
    }
  },
  savePackageJSON: function(callback) {
    if (!Config.pjsonDir) {
      Input.confirm('No package.json found, would you like to create one?', function(create) {
        if (!create)
          return;

        Config.pjsonDir = process.cwd();

        // NB prompt for standard fields here

        Config.savePackageJSON(callback);
      });
      return;
    }

    try {
      fs.writeFileSync(path.resolve(Config.pjsonDir, 'package.json'), JSON.stringify(Config.pjson, null, 2));
    }
    catch(e) {
      log(Msg.err('Unable to save package.json.'));
      callback();
      return;
    }
    log(Msg.info('package.json updated.'));
    callback();
  },
  saveConfig: function(isLocal, isBuild, callback) {
    // load the app config file
    var configPath = path.resolve(Config.pjsonDir || process.cwd(), Config.pjson.configFile);
    try {
      var configSource;
      if (fs.existsSync(configPath))
        configSource = fs.readFileSync(configPath) + '';
      configSource = configSource || 'jspm.config({});';
      var config = eval('(' + configSource.match(configRegEx)[2] + ')');
      configIndent = configSource.match(configRegEx)[1] || '';
      useSingleQuotes = configSource.indexOf("'") != -1;
    }
    catch(e) {
      log(Msg.err('Unable to load config file. Ensure it contains a _jspm.config({...})_ call.'));
      return;
    }

    if (!config.baseURL && Config.pjson.directories.lib)
      config.baseURL = Config.pjson.directories.lib;

    if (typeof isLocal == 'boolean') {
      if (isLocal && config.jspmPackages != Config.pjson.directories.jspm_packages) {
        log(Msg.ok('Loader set to local library sources'));
        config.jspmPackages = Config.pjson.directories.jspm_packages;
      }
      else if (!isLocal && config.jspmPackages !== false) {
        log(Msg.ok('Loader set to CDN library sources'));
        config.jspmPackages = false;
      }
    }

    if (typeof isBuild == 'boolean') {
      if (!isBuild && config.baseURL != Config.pjson.directories.lib) {
        log(Msg.ok('Loader baseURL set to _' + Config.pjson.directories.lib + '%.'));
        config.baseURL = Config.pjson.directories.lib;
      }
      else if (isBuild && config.baseURL != Config.pjson.directories.dist) {
        log(Msg.ok('Loader baseURL set to _' + Config.pjson.directories.dist + '%.'));
        config.baseURL = Config.pjson.directories.dist;
      }
    }

    // dependencyMap
    config.map = config.map || {};
    if (Config.pjson.dependencyMap)
      for (var m in Config.pjson.dependencyMap)
        config.map[m] = Config.pjson.dependencyMap[m];

    // and then save it back
    var configContent = JSON.stringify(config, null, 2);
    if (useSingleQuotes)
      configContent = configContent.replace(/"/g, "'");
    configContent = configIndent + 'jspm.config(' + configContent.replace(/\n/g, '\n' + configIndent) + ')';
    try {
      fs.writeFileSync(configPath, configSource.replace(configRegEx, configContent));
    }
    catch(e) {
      log(Msg.err('Unable to save config file.'));
    }
    log(Msg.info('Config file updated.'));

    Config.savePackageJSON(callback || function() {});
  }
};


var AppBuild = {
  build: function(outDir, callback) {
    callback = callback || function() {}

    AppBuild.getBuildConfig(outDir, function() {

      var inDir = path.resolve(Config.pjsonDir, Config.pjson.directories.lib);
      outDir = outDir || path.resolve(Config.pjsonDir, Config.pjson.directories.dist);

      jspmUtil.applyIgnoreFiles(inDir, Config.pjson.files, Config.pjson.ignore, function(err) {

        if (err)
          log(Msg.err('Error applying files and ignore. \n' + err));

        AppBuild.prepBuildDir(inDir, outDir, function(err) {
          if (err)
            return log(Msg.err('Unable to create production directory. \n' + err));

          // run compilation (including minify) if necessary
          jspmUtil.compile(outDir, path.dirname(path.resolve(Config.pjsonDir, Config.pjson.configFile)), null, Config.pjson.buildConfig, function(err) {
            if (err)
              log(Msg.err(err + ''));
            else
              log(Msg.ok('Build completed.'));
            callback();
          }, callback);
        });

      });
    });
  },
  prepBuildDir: function(inDir, outDir, callback) {
    inDir = path.resolve(inDir);
    outDir = path.resolve(outDir);

    if (inDir != outDir) {
      rimraf(outDir, function(err) {
        if (err)
          return callback(err);

        exec('cp -r ' + inDir + path.sep + ' ' + outDir + path.sep, {
          killSignal: 'SIGKILL',
          timeout: 120
        }, function(err, stdout, stderr) {
          if (err)
            return callback(stderr);

          callback();
        });
        
      });
      return;
    }
    callback();
  },
  getBuildConfig: function(outDir, callback) {
    Config.getConfig(function() {
      AppBuild.checkBuildConfig(outDir, callback);
    });
  },
  checkBuildConfig: function(outDir, callback, save) {
    if (!outDir && !Config.pjson.directories.dist) {
      Input.get('No package.json *directories.dist*. Please enter the build path', 'dist', function(buildDir) {
        Config.pjson.directories.dist = buildDir || 'dist';
        AppBuild.checkBuildConfig(outDir, callback, true);
      });
      return;
    }
    
    if (!Config.pjson.directories.lib) {
      Input.get('No package.json application path, *directories.lib*. Please enter the app path', 'app', function(appDir) {
        Config.pjson.directories.lib = appDir || 'app';
        AppBuild.checkBuildConfig(outDir, callback, true);
      });
      return;
    }

    if (!Config.pjson.buildConfig) {
      log(Msg.info('No build config found.'));
      Input.confirm('Uglify source files?', true, function(uglify) {
        Input.confirm('Convert ES6 module syntax to AMD (source maps not yet supported)?', false, function(transpile) {
          Input.confirm('Transpile ES6 language features to ES5?', false, function(traceur) {
            Config.pjson.buildConfig = {
              uglify: uglify,
              traceur: traceur,
              transpile: transpile
            };
            AppBuild.checkBuildConfig(outDir, callback, true);
          });
        });
      });
      return;
    }

    if (save)
      Config.saveConfig(null, true, callback);
    else
      callback();
  }
};


var JSPM = {
  install: function(packages, names, force) {
    Config.getConfig(function(config) {
      if (packages.length == 0) {
        packages = [];
        names = [];
        for (var m in Config.pjson.dependencyMap) {
          names.push(m);
          packages.push(Config.pjson.dependencyMap[m]);
        }
        JSPM.install(packages, names, force);
        return;
      }
      Installer.install(packages, names, force, function(err) {
        Config.saveConfig(true);
        if (err)
          log(Msg.warn('Install finished, with errors.'));
        else
          log(Msg.info('Install complete.'));
      });
    });
  },
  update: function(force) {
    // get list of all installed dependencyMap
    Config.getConfig(function(config) {
      var packages = [];
      var names = [];
      for (var m in Config.pjson.dependencyMap) {
        names.push(m);
        var version = m.split('@')[1];
        var package = Config.pjson.dependencyMap[m];
        if (!version) {
          // latest version
          packages.push(package.split('@')[0]);
        }
        else if (version.split('.').length == 2) {
          // minor version
          packages.push(package.split('@')[0] + '@' + version);
        }
        else {
          // exact version / tag
          packages.push(package.split('@')[0] + '@' + version);
        }
      }
      Installer.install(packages, names, force, function(err) {
        Config.saveConfig(true);
        if (err)
          log(Msg.warn('Update finished, with errors.'));
        else
          log(Msg.info('Update complete.'));
      });
    });
  },
  init: function() {
    Config.getConfig(function() {
      Config.saveConfig();
    });
  },
  downloadLoader: function() {
    Config.getConfig(function(pjson, dir) {
      log(Msg.info('Downloading loader files to %' + pjson.directories.jspm_packages + '%.'));
      dir = path.resolve(dir, pjson.directories.jspm_packages);
      mkdirp(dir, function(err) {
        if (err)
          return log(Msg.err('Unable to create directory _' + dir + '%.'));

        var files = ['loader.js', 'es6-module-loader.js', 'esprima-es6.min.js'];
        var done = 0;
        for (var i = 0; i < files.length; i++) (function(i) {
          https.get({
            hostname: 'jspm.io',
            path: '/' + files[i],
            rejectUnauthorized: false
          }, function(res) {
            res.pipe(fs.createWriteStream(path.resolve(dir, files[i]))
              .on('finish', function() {
                log(Msg.info('  ^' + files[i] + '^'));
                done++;
                if (done == files.length)
                  log(Msg.ok('Loader files downloaded successfully.'));
              })
              .on('error', function(err) {
                log(Msg.err('Write error \n' + err));
              })
            )
            .on('error', function(err) {
              log(Msg.err('Download error \n' + err));
            });
          });
        })(i);
      });
    });
  },
  setlocal: function(local) {
    Config.getConfig(function() {
      if (local)
        Config.saveConfig(true);
      else
        Config.saveConfig(false);
    });
  },
  setproduction: function(production) {
    Config.getConfig(function() {
      if (production && !Config.pjson.directories.dist) {
        Input.get('No package.json *directories.dist*. Please enter the build path', 'dist', function(buildDir) {
          Config.pjson.directories.bist = buildDir || 'dist';
          Config.saveConfig(null, production);
        });
        return;
      }
      Config.saveConfig(null, production);
    });
  },
  build: function(outDir) {
    AppBuild.build(outDir);
  },
  create: function(template, outFile) {
    if (args[1] == 'basic-page') {
      if (!args[2])
        return log('You must provide a file name to output.');
      Config.getConfig(function() {
        var basicPageTpl = fs.readFileSync(__dirname + '/basic-page.tpl') + '';
        Input.get('Page title', function(title) {
          mkdirp.sync(path.dirname(outFile));
          fs.writeFileSync(outFile, 
            basicPageTpl
            .replace('{{title}}', title)
            .replace('{{loaderPath}}', path.relative(path.dirname(outFile), Config.pjson.directories.jspm_packages) + '/loader.js')
            .replace('{{configPath}}', path.relative(path.dirname(outFile), Config.pjson.configFile))
          );
        });
      });
    }
  }
};


process.on('uncaughtException', function(err) {
  log(Msg.err(err.stack));
});


var Msg = {
  moduleMsg: function(msg, color) {
    return (color || '\033[0m')
      + msg
        .replace(/(\s|^)%([^%\n]+)%/g, '$1\033[1m$2\033[0m' + color || '')
        .replace(/(\s|^)\^([^\^\n]+)\^/g, '$1\033[36m$2\033[0m' + color || '')
        .replace(/\n\r?( {0,4}\w)/g, '\n     $1')
      + '\033[0m';
  },
  q: function(msg, opt) {
    return '' + Msg.moduleMsg(msg, '') + '\033[90m' + (opt ? ' (' + opt + ')' : '') + '\033[39m:\033[0m ';
  },
  err: function(msg) {
    return '\033[31m\033[1merr  \033[0m' + Msg.moduleMsg(msg, '\033[90m');
  },
  info: function(msg) {
    return '     ' + Msg.moduleMsg(msg, '\033[90m');
  },
  warn: function(msg) {
    return '\033[33m\033[1mwarn \033[0m' + Msg.moduleMsg(msg, '\033[90m');
  },
  ok: function(msg) {
    return '\033[32m\033[1mok   \033[0m' + Msg.moduleMsg(msg, '\033[90m');
  }
};

var logging = true;
var logBuffer = '';
var log = function(msg) {
  if (logging)
    return console.log(msg);

  logBuffer += msg + '\n';
}

var inputQueue = [];
var Input = {
  confirm: function(msg, def, callback) {
    if (arguments.length == 2) {
      callback = def;
      def = undefined;
    }

    var defText = 'y/n';
    if (def === true)
      defText = 'yes';
    else if (def === false)
      defText = 'no';

    Input.get(msg, defText, function(reply) {
      if (reply.match(/\b(no|n)\b/i))
        callback(false);
      else if (reply.match(/\b(yes|y\b)/i))
        callback(true);
      else if (def !== undefined)
        callback(def);
      else
        Input.confirm(msg, def, callback);
    });
  },
  get: function(msg, def, disableOutput, callback) {
    if (arguments.length == 2) {
      callback = def;
      def = undefined;
    }
    else if (arguments.length == 3) {
      callback = disableOutput;
      disableOutput = false;
    }
    if (!logging) {
      inputQueue.push([msg, def, disableOutput, callback]);
      return;
    }
    logging = false;
      
    process.stdout.write(Msg.q(msg, def));
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(disableOutput);
    var input = '';
    process.stdin.on('data', function(chunk) {
      var lastChar = chunk.substr(chunk.length -1, 1);
      if (lastChar == '\n' || lastChar == '\r' || lastChar == '\u0004') {
        process.stdin.setRawMode(false);
        if (disableOutput)
          process.stdout.write('\n');
        process.stdin.pause();
        process.stdin.removeAllListeners('data');
        input += chunk.substr(0, chunk.length - 1);

        // bump the input queue
        logging = true;
        process.stdout.write(logBuffer);
        logBuffer = '';
        var next = inputQueue.shift();
        if (next)
          Input.get.apply(null, next);

        return callback(input);
      }
      input += chunk;
    });
  }
};

var args = process.argv.splice(2);

var showInstructions = function(arg) {
  if (arg && arg != '--help' && arg != '-h')
    log('Invalid argument ' + arg);
  log('\n'
    + '  \033[47m\033[1m      \033[0m\n'
    + '  \033[47m\033[93m\033[1m jspm \033[0m\033[90m  '
    + 'Browser Package Management'
    + ' \033[0m\n'
    + '  \033[47m\033[1m      \033[0m\n'
    + '\n'
    + 'jspm install <name=package> [-f --force] \n'
    + '  install                         Install / update from package.json\n'
    + '  install jquery                  Install a package from the registry\n'
    + '  install npm:underscore          Install latest version from NPM\n'
    + '  install jquery@1.1              Install latest minor version\n'
    + '  install jquery@1.1.1            Install an exact version\n'
    + '  install jquery npm:underscore   Install multiple packages\n'
    + '  install myjquery=jquery@1.1.1   Install a package with a mapped name\n'
    + '\n'
    + 'jspm update [-f -force]           Check and update existing modules\n'
    + '\n'
    + 'jspm init                         Verify / create the configuration files\n'
    + '\n'
    + 'jspm dl-loader                    Download the jspm browser loader\n'
    + '\n'
    + 'jspm setmode <mode>\n'
    + '  setmode local                   Switch to locally downloaded libraries\n'
    + '  setmode remote                  Switch to CDN external package sources\n'
    + '  setmode dev                     Switch to the development baseURL\n'
    + '  setmode production              Switch to the production baseURL\n'
    + '\n'
    + 'jspm build [<outDir>]            Compile all resources\n'
    + '\n'
    + 'jspm create <template> <outfile>  Create a file from a template\n'
  );
}

var readOptions = function(args, options) {
  var argOptions = { args: [] };
  for (var i = 0; i < args.length; i++) {
    if (args[i].substr(0, 2) == '--') {
      for (var j = 0; j < options.length; j++)
        if (options[j] == args[i])
          argOptions[options[j].substr(2)] = true;
    }
    else if (args[i].substr(0, 1) == '-') {
      var opts = args[i].substr(1);
      for (var j = 0; j < opts.length; j++) {
        for (var k = 0; k < options.length; k++) {
          if (options[k].substr(2, 1) == opts[j])
            argOptions[options[k].substr(2)] = true;
        }
      }
    }
    else
      argOptions.args.push(args[i]);
  }
  return argOptions;
}

var useHttps = false;
if (args[0] == 'install') {
  var packages = [];
  var names = [];

  var options = readOptions(args, ['--force', '--https']);

  args = options.args;
  
  for (var i = 1; i < args.length; i++) {
    if (args[i].indexOf('=') == -1)
      packages.push(args[i]);
    else {
      packages.push(args[i].split('=')[1]);
      names.push(args[i].split('=')[0]);
    }
  }
  useHttps = options.https;
  JSPM.install(packages, names, options.force);
}
else if (args[0] == 'update') {
  var options = readOptions(args, ['--force', '--https']);

  useHttps = options.https;
  JSPM.update(options.force);
}
else if (args[0] == 'init') {
  JSPM.init();
}
else if (args[0] == 'dl-loader') {
  JSPM.downloadLoader();
}
else if (args[0] == 'create') {
  JSPM.create(args[1], args[2]);
}
else if (args[0] == 'setmode') {
  if (args[1] == 'local')
    JSPM.setlocal(true);
  else if (args[1] == 'remote')
    JSPM.setlocal(false);
  else if (args[1] == 'production')
    JSPM.setproduction(true);
  else if (args[1] == 'dev')
    JSPM.setproduction(false);
  else
    log('Invalid mode.');
}
else if (args[0] == 'build') {
  JSPM.build(args[1]);
}
else {
  if (args[0] && args[0] != '--help' && args[0] != '-h')
    log('Unknown command ' + args[0]);
  showInstructions();
}











