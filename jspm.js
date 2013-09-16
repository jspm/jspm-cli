#!/usr/bin/env node
var mkdirp = require('mkdirp');
var fs = require('fs');
var path = require('path');
var semver = require('semver');
var rimraf = require('rimraf');
var https = require('https');

var jspmUtil = require('./jspm-util');

var registryDownloader = require('./jspm-registry');
var pluginDownloader = require('./jspm-plugin');


var getInput = function(message, disableOutput, callback) {
  if (typeof disableOutput == 'function') {
    callback = disableOutput;
    disableOutput = false;
  }
  process.stdout.write(message);
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
      return callback(input);
    }
    input += chunk;
  });
}
var getYesNo = function(message, callback) {
  getInput(message + ' (y/n): ', function(reply) {
    if (reply.match(/\b(no|n)\b/i))
      callback(false);
    else if (reply.match(/\b(yes|y\b)/i))
      callback(true);
    else
      getYesNo(message, callback);
  });
}

var cmdSettings = {
  force: false
};

var appConfig;
var configIndent = '';
var useSingleQuotes = true;

var installing = {};
var locations = {};
var versionCache = {};

var configRegEx = /^(\s*)jspm.config\((\{[\s\S]*\})\)/m;

var Installer = {
  saveConfigFile: function() {
    var configContent = JSON.stringify(appConfig, null, 2);
    if (useSingleQuotes)
      configContent = configContent.replace(/"/g, "'");
    configContent = configIndent + 'jspm.config(' + configContent.replace(/\n/g, '\n' + configIndent) + ')';
    try {
      if (fs.existsSync(cmdSettings.configFile))
        configContent = (fs.readFileSync(cmdSettings.configFile) + '').replace(configRegEx, configContent);
      else
        configContent += ';\n';
    }
    catch(e) {
      console.log('Unable to save configuration file. Ensure the config file contains a "jspm.config({...})" call.');
      return;
    }
    fs.writeFileSync(cmdSettings.configFile, configContent);
  },
  createAppConfig: function(callback) {
    getInput('File containing the jspm configuration (www/config.js): ', function(configFile) {
      configFile = configFile || 'www/config.js';
      getInput('Folder to download the jspm libraries (www/lib): ', function(libDir) {
        libDir = libDir || 'www/lib';
        var pjson;
        try {
          pjson = JSON.parse(fs.readFileSync('package.json'));
        }
        catch(e) {
          pjson = {};
        }

        pjson.jspmConfigFile = configFile;
        pjson.directories = pjson.directories || {};
        pjson.directories.jspmLib = libDir;

        fs.writeFileSync('package.json', JSON.stringify(pjson, null, 2));

        mkdirp.sync(path.dirname(configFile));
        mkdirp.sync(libDir);

        getYesNo('Install jspm loader at ' + libDir + '/loader.js?', function(confirm) {
          // install loader
          var files = ['loader.js', 'es6-module-loader.js', 'esprima-es6.min.js'];
          var done = 0;
          for (var i = 0; i < files.length; i++) (function(i) {
            https.get({
              hostname: 'jspm.io',
              path: '/' + files[i],
              rejectUnauthorized: false
            }, function(res) {
              console.log('Downloading ' + files[i]);
              res.pipe(fs.createWriteStream(libDir + '/' + files[i]))
              .on('end', function() {
                done++;
                if (done == files.length)
                  callback();
              })
              .on('error', function(err) {
                callback(err);
              });
            });
          })(i);
        });
      });
    });
  },
  getAppConfig: function(callback, noCreate) {
    if (appConfig)
      return;
    
    var pjson;
    try {
      pjson = JSON.parse(fs.readFileSync('package.json'));
    }
    catch(e) {
      if (!noCreate) {
        getYesNo('No package.json file found. Would you like to create one?', function(confirm) {
          if (confirm)
            Installer.createAppConfig(function() {
              Installer.getAppConfig(callback);
            });
          else
            Installer.getAppConfig(callback, true);
        });
        return;
      }
    }

    if (pjson) {
      if (pjson.jspmConfigFile)
        cmdSettings.configFile = cmdSettings.configFile || pjson.jspmConfigFile;
      if (pjson.directories && pjson.directories.jspmLib)
        cmdSettings.libDir = cmdSettings.libDir || pjson.directories.jspmLib;
    }

    cmdSettings.configFile = cmdSettings.configFile || 'www/config.js';
    cmdSettings.libDir = cmdSettings.libDir || 'www/lib';

    // load the config file
    var configSource;
    try {
      configSource = fs.readFileSync(cmdSettings.configFile) + '';
      appConfig = eval('(' + configSource.match(configRegEx)[2] + ')');
      configIndent = configSource.match(configRegEx)[1];
      useSingleQuotes = configSource.indexOf("'") != -1;
    }
    catch(e) {
      appConfig = {};
    }

    if (typeof appConfig.localLibs == 'undefined')
      appConfig.localLibs = path.relative(path.dirname(cmdSettings.configFile), cmdSettings.libDir);

    appConfig.map = appConfig.map || {};
    callback();
  },
  // get location downloader instance
  getLocation: function(target) {
    var locationName = target.indexOf(':') != -1 ? target.split(':')[0] : 'lib';

    if (locations[locationName])
      return locations[locationName];

    var locationDownloader;

    if (locationName == 'lib') {
      locationDownloader = registryDownloader;
    }
    else if (locationName == 'plugin') {
      locationDownloader = pluginDownloader;
    }
    else {
      try {
        locationDownloader = require('jspm-' + locationName);
      }
      catch (e) {
        return;
      }
    }

    // ensure the download dir and tmp dir exist
    var tmpDir = process.env.HOME + '/.jspm/tmp-' + locationName;
    var baseDir = cmdSettings.libDir + '/' + locationName;

    mkdirp.sync(tmpDir);
    mkdirp.sync(baseDir);

    locations[locationName] = new locationDownloader({
      tmpDir: tmpDir,
      log: false
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
  checkRepo: function(repo, lookup, initialTarget, location, packageOptions, callback, errback) {
    var baseName = location.name + ':' + repo;

    // force does a full download no matter what
    if (cmdSettings.force)
      return callback(false);

    // check if we have the initialVersion in the map config
    if (initialTarget && initialTarget.indexOf('@') == -1) {
      var exactName = baseName + '@' + lookup.version + Installer.getMain(baseName + '@' + lookup.version, location, packageOptions);
      if (!appConfig.map[initialTarget])
        appConfig.map[initialTarget] = exactName;

      if (appConfig.map[initialTarget] != exactName )
        getYesNo('Update latest ' + initialTarget + ' from ' + appConfig.map[initialTarget] + ' to ' + lookup.version + '?', function(confirm) {
          if (!confirm)
            return callback(true);
          Installer.checkRepo(repo, lookup, false, location, packageOptions, function(isFresh) {
            if (isFresh)
              appConfig.map[initialTarget] = exactName;
            callback(isFresh);
          }, errback);
        });
      else
        Installer.checkRepo(repo, lookup, false, location, packageOptions, callback, errback);
      return;
    }
    else if (initialTarget && initialTarget.substr(initialTarget.indexOf('@') + 1).split('.').length == 2) {
      var exactName = baseName + '@' + lookup.version + Installer.getMain(baseName + '@' + lookup.version, location, packageOptions);
      if (!appConfig.map[initialTarget])
        appConfig.map[initialTarget] = exactName;
      if (appConfig.map[initialTarget] != exactName) {
        getYesNo('Update latest ' + initialTarget + ' from ' + appConfig.map[initialTarget] + ' to ' + lookup.version + '?', function(confirm) {
          if (!confirm)
            return callback(true);
          Installer.checkRepo(repo, lookup, false, location, packageOptions, function(isFresh) {
            if (isFresh)
              appConfig.map[initialTarget] = exactName;
            callback(isFresh);
          }, errback);
        });
      }
      else
        Installer.checkRepo(repo, lookup, false, location, packageOptions, callback, errback);
      return;
    }

    // check if the exact repo is present and up to date
    try {
      var hash = fs.readFileSync(location.baseDir + '/' + repo + '@' + lookup.version + '/.jspm-hash');
    }
    catch(e) {
      return callback(false);
    }

    if (hash == lookup.hash)
      return callback(true);

    if (cmdSettings.force)
      return callback(false);

    getYesNo(baseName + '@' + lookup.version + ' is already installed, but has an update. Do you want to apply it?', function(confirm) {
      callback(!confirm);
    });

  },
  getMain: function(exactName, location, packageOptions) {
    var repoPath = location.baseDir + '/' + exactName.split(':')[1];
    if (!packageOptions) {
      try {
        packageOptions = JSON.parse(fs.readFileSync(repoPath));
      }
      catch(e) {
        packageOptions = {};
      }
    }

    var mainName = jspmUtil.getMain(repoPath, packageOptions);
    if (mainName)
      return '#' + mainName;
    else
      return '';
  },
  // also does processing
  // returns dependencies
  installRepo: function(repo, lookup, initialVersion, location, initialTarget, packageOptions, callback, errback) {

    var repoPath = path.resolve(location.baseDir + '/' + repo + '@' + lookup.version);
    var fullName = location.name + ':' + repo + '@' + lookup.version;

    rimraf(repoPath, function(err) {
      location.download(repo, lookup.version, lookup.hash, repoPath, function() {

        // read the package options
        var pjson;
        try {
          pjson = JSON.parse(fs.readFileSync(repoPath + '/package.json'));
        }
        catch(e) {}
        pjson = pjson || {};

        packageOptions = jspmUtil.extend(pjson, packageOptions);

        // collapse the lib directory if present
        jspmUtil.collapseLibDir(repoPath, packageOptions, function(isBuilt) {

          // replace in the dependencies
          jspmUtil.processDependencies(repoPath, packageOptions, function(dependencies) {

            // deal with unresolved dependencies
            for (var i = 0; i < dependencies.length; i++) {
              if (dependencies[i].indexOf(':') == -1) {
                // NB ask how to deal with unresolved dependency
                console.log('Ignoring unresolved dependency ' + dependencies[i]);
                dependencies.splice(i--, 1);
              }
            }

            // run compilation (including minify) if necessary
            (!isBuilt && jspmUtil.compile || function(repoPath, buildOptions, callback) { 
              callback();
            })(repoPath, packageOptions.config, function() {

              // get the main file
              var main = Installer.getMain(repoPath, packageOptions);

              // set up the version map
              appConfig.map[initialTarget] = fullName + Installer.getMain(fullName, location, packageOptions);

              // write to the .jspm-hash file in the folder
              try {
                fs.writeFileSync(repoPath + '/.jspm-hash', lookup.hash);
              }
              catch(e) {}

              // return the external dependency array
              callback(dependencies);

            }, errback);

          }, errback);

        }, errback);

      }, errback);

    }, errback);
  },
  install: function(target, initialTarget, packageOptions, callback) {
    if (arguments.length == 2) {
      callback = initialTarget;
      initialTarget = target;
    }

    if (target.indexOf(':') == -1)
      target = 'lib:' + target;
    
    // registry install
    if (target.substr(0, 4) == 'lib:') {
      console.log('Looking up ' + target);
      jspmUtil.registryLookup(target.substr(4), function(err, entry) {
        if (err)
          return callback('Error performing registry lookup for ' + target + '. \n' + err);
        Installer.install(entry.name, target, entry.packageOptions, callback);
      });
      return;
    }

    // get the location
    var location = Installer.getLocation(target);

    if (!location) {
      console.log('Install of ' + target + ' failed, location downloader not present. \nTry running `npm install -g jspm-' + target.substr(0, target.indexOf(':')) + '`.');
      return;
    }

    // get the repo name and version
    var repo = target.substr(target.indexOf(':') + 1);
    var version = repo.indexOf('@') == -1 ? '' : repo.substr(repo.indexOf('@') + 1);
    if (version)
      repo = repo.substr(0, repo.length - version.length - 1);

    console.log('Getting version list for ' + target);
    Installer.versionLookup(repo, version, location, function(lookup) {
      // lookup: isLatest, isLatestMinor, hash, exactVersion

      if (lookup.notfound) {
        return callback(repo + (version ? '@' + version : '') + ' not found!');
      }

      var fullName = location.name + ':' + repo + '@' + lookup.version;

      // if already installing, queue the callbacks
      if (installing[fullName])
        return installing[fullName].push(callback);
      installing[fullName] = [callback];

      // check that what is in the file system matches the lookup
      Installer.checkRepo(repo, lookup, initialTarget, location, packageOptions, function(isFresh) {

        if (isFresh) {
          console.log(fullName + ' already up to date.');
          return callback();
        }

        console.log('Downloading ' + fullName);
        Installer.installRepo(repo, lookup, version, location, initialTarget, packageOptions, function(dependencies) {

          if (dependencies.length == 0)
            for (var i = 0; i < installing[fullName].length; i++)
              installing[fullName][i](0);

          var error = false;
          var installed = 0;

          var checkComplete = function(err) {
            if (installed != dependencies.length)
              return;

            for (var i = 0; i < installing[fullName].length; i++)
              installing[fullName][i](err);

            delete installing[fullName];
          }

          for (var i = 0; i < dependencies.length; i++) (function(i) {
            Installer.install(dependencies[i], function(err) {
              console.log('Error installing ' + dependencies[i] + '\n' + err);
              installed++;
              checkComplete(err);
            });
          })(i);
          
        }, function(err) {
          callback('Error downloading repo ' + fullName + '\n' + err);
        });

      }, function(err) {
        callback('Error checking current repo ' + repo + '@' + lookup.version + '\n' + err);
      });
    }, function(err) {
      callback('Error looking up version for ' + repo + '\n' + err);
    });
  }
};





var args = process.argv.splice(2);

var showInstructions = function(arg) {
  if (arg && arg != '--help' && arg != '-h')
    console.log('Invalid argument ' + arg);
  console.log(
    '\n' +
    '    . ,-. ,-. ,-,-.   . ,-.\n' +
    '    | `-. | | | | |   | | |\n' +
    '    | `-\' |-\' \' \' \' . \' `-\'\n' +
    '   `\'     \'        \n\n' + 
    'jspm install \n' +
    '  install jquery                  Install the latest version of jquery \n' +
    '  install npm:underscore          Install the latest version of underscore on npm \n' +
    '  install jquery@1.1              Install the latest minor version of jquery \n' +
    '  install jquery@1.1.1            Install an exact version of jquery \n' +
    '  install packageA packageB       Install multiple packages \n' +
    '\n' +
    'jspm init                         Initialize the app configuration into package.json\n'
  );
}

if (args[0] == 'install') {
  var installTargets = [];
  for (var i = 1; i < args.length; i++) {
    if (args[i].substr(0, 2) == '--') {
      if (args[i].substr(0, 9) == '--config=')
        cmdSettings.configFile = args[i].substr(9);
      else if (args[i].substr(0, 6) == '--dir=')
        cmdSettings.libDir = args[i].substr(6);
      else {
        return showInstructions(args[i]);
      }
    }
    else if (args[i].substr(0, 1) == '-') {
      if (args[i].substr(0, 2) == '-f')
        cmdSettings.force = true;
      else {
        return showInstructions(args[i]);
      }
    }
    else
      installTargets.push(args[i]);
  }

  Installer.getAppConfig(function() {
    for (var i = 0; i < installTargets.length; i++) (function(i) {
      Installer.install(installTargets[i], function(err) {
        if (err)
          console.log('Error installing ' + installTargets[i] + '\n' + err);
        // save back the app config
        Installer.saveConfigFile();
        if (!err)
          console.log('Install complete.');
      });
    })(i);

  });
}
else if (args[0] == 'init') {
  Installer.createAppConfig(function() {
    Installer.getAppConfig(function() {
      Installer.saveConfigFile();
    });
  });
}
else if (args[0] == 'create') {
  if (args[1] == 'basic-page') {
    if (!args[2])
      return console.log('You must provide a file name to output.');
    var fileName = args[2];
    Installer.getAppConfig(function() {
      var basicPageTpl = fs.readFileSync(__dirname + '/basic-page.tpl') + '';
      getInput('Page title: ', function(title) {
        mkdirp.sync(path.dirname(fileName));
        fs.writeFileSync(fileName, 
          basicPageTpl
          .replace('{{title}}', title)
          .replace('{{loaderPath}}', path.relative(path.dirname(fileName), cmdSettings.libDir) + '/loader.js')
          .replace('{{configPath}}', path.relative(path.dirname(fileName), cmdSettings.configFile))
        );
      });
    });
  }
}
else if (args[0] == 'setmode') {
  if (args[1] == 'local') {
    Installer.getAppConfig(function() {
      appConfig.localLibs = path.relative(path.dirname(cmdSettings.configFile), cmdSettings.libDir);
      Installer.saveConfigFile();
    });
  }
  else if (args[1] == 'remote') {
    Installer.getAppConfig(function() {
      appConfig.localLibs = false;
      Installer.saveConfigFile();
    });
  }
  else
    console.log('Unknown mode ' + args[1]);
}
else {
  console.log('Unknown command ' + args[0]);
  showInstructions();
}

