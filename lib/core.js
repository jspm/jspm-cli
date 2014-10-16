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

var Promise = require('rsvp').Promise;

var path = require('path');
var semver = require('./semver');
var nodeSemver = require('semver');
var ui = require('./ui');
var config = require('./config');

var pkg = require('./package');
var build = require('./build');
var Package = pkg.Package;

var request = require('request');

var fs = require('graceful-fs');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var ncp = require('ncp');

var link = require('./link');

var asp = require('rsvp').denodeify;

var systemBuilder = require('systemjs-builder');

var core = module.exports;

// convert a Node function into a promise

var uninstall = exports.uninstall = function(name) {
  var removed = false;
  return config.load()
  .then(function() {
    if (name instanceof Array) {
      for (var i = 0; i < name.length; i++) {
        var deprecated = removePackage(name[i]);
        removed = removed || !!deprecated;
      }
    }
    else {
      var deprecated = removePackage(name);
      removed = removed || !!deprecated;
    }

    // log deprecations
    for (var i = 0; i < deprecated.length; i++)
      ui.log('info', 'Deprecated `' + deprecated[i] + '`');
  })
  .then(function() {
    return config.save()
    .then(function() {
      return removed;
    });
  });
}

// attempt to deprecate a given dependency name and range
// in turn checks if any of its dependencies should also be deprecated
// assumes that the dependency is not in baseMap, and its parent map is removed (if not can't be deprecated)
// returns true or false whether it did something
function deprecate(name, versionRange) {
  var deprecated = [];
  var orphanDeps = [];

  var versionList = config.versions[name] || [];
  for (var i = 0; i < versionList.length; i++) {
    // only do deprecation on versions within the range we're removing
    if (!semver.match(versionRange, versionList[i]))
      continue;

    // get critical ranges for each version
    var ranges = getCriticalRanges(name, versionList[i]);

    if (ranges.length)
      continue;

    // whoever has no critical ranges now gets deprecated
    var deprecateName = name + '@' + versionList[i];
    deprecated.push(deprecateName);
    var deps = config.depMap[deprecateName];
    for (var d in deps)
      orphanDeps.push(deps[d]);

    // retain depMap, since we may still install this dependency again and want to retain dependency info
    // delete config.depMap[deprecateName];
    versionList.splice(i--, 1);
  }

  for (var i = 0; i < orphanDeps.length; i++)
    deprecate(orphanDeps[i].name, orphanDeps[i].version);

  return deprecated;
}

// removes from config.baseMap, pruning orphaned dependencies
// also removes from config.dependencies
function removePackage(name) {
  var removed = false;

  // remove from config.dependencies
  if (config.dependencies[name] && (removed = true))
    delete config.dependencies[name];

  if (!config.baseMap[name])
    return removed;

  var removeName = config.baseMap[name].name;
  var removeVersion = config.baseMap[name].version;

  // now remove it
  delete config.baseMap[name];

  // deprecate the given dependency (and any sub dependencies)
  return deprecate(removeName, removeVersion, false);
}


/* 
  config.baseMap = {
    jquery: new Package('npm:thing@1.2')
  };
  config.depMap = {
    'npm:thing@1.2.1': {
      dep: new Package('github:some/dep@2.3')
    }
  };
  config.versions = {
    'npm:thing': ['1.2.1', '3.3.3'],
    'github:some/dep': ['2.3.4']
  };
  config.dependencies = {
    'thing': 'npm:thing@1.2',
    'some': '@2.3'
  };
*/

/*
  Given a package and version, find all the ranges that this version matches
  Then for each of those ranges, check them against the other versions of this package
  The ranges that are only satisfied by this version are the critical ranges

  We run the entire algorithm on the dep tree after removing the dependency, excludeName

*/
function getCriticalRanges(name, version) {
  var versionList = config.versions[name];
  var ranges = [];

  // get all ranges for this version
  for (var d in config.depMap) {
    var curDepMap = config.depMap[d];
    for (var n in curDepMap) {
      var module = curDepMap[n];
      if (module.name != name)
        continue;
      if (ranges.indexOf(module.version) == -1)
        ranges.push(module.version);
    }
  }
  for (var n in config.baseMap) {
    var module = config.baseMap[n];
    if (module.name != name)
      continue;
    if (ranges.indexOf(module.version) == -1)
      ranges.push(module.version);
  }

  // filter to ranges that don't have another version match
  return ranges.filter(function(range) {

    for (var i = 0; i < versionList.length; i++) {
      if (versionList[i] == version)
        continue;

      if (semver.match(range, versionList[i]))
        return false;
    }

    return true;
  });
}

// Primary install function, forms of arguments are documented in first four comments
// options.force
// options.primary
// options.inject
// options.parent (for setting secondary depmaps)
// options.link means symlink linked versions in ranges to jspm_packages where available
// options.seen is a list of parent dependencies to allow completion return during circular installs
var downloads = {};
var install = exports.install = function(name, target, options) {
  if (!name)
    return Promise.resolve();
  var args = arguments;
  if (!config.loaded)
    return config.load().then(function() {
      return install.apply(this, args);
    });

  // install('jquery')
  if (arguments.length == 1) {
    options = {};
    target = '';
  }

  // install(true, options) - from package.json
  if (name === true) {
    if (target === undefined && options === undefined) {
      options = {};
      target = '';
    }
    name = config.dependencies;
  }
  
  // install('jquery', options)
  if (!options && typeof target == 'object') {
    options = target;
    target = '';
  }

  // install({ jquery: '1.5' }, options)
  if (typeof name == 'object')
    return Promise.all(Object.keys(name).map(function(d) {
      return install(d, name[d], options);
    }));

  // set default options
  if (!('primary' in options))
    options.primary = true;

  if (!(target instanceof Package)) {
    // convert shortcut version-only form
    if (target.indexOf('@') == -1 && target.indexOf(':') == -1)
      target = name + '@' + (target == '*' || !target ? '' : target);

    target = new Package(target);
  }

  // our lookup match - general information
  // extra info - lookup.fresh (added by download)
  var lookup;
  var initialTarget = target;

  // when installing over an existing dep, need to check against the old config
  // to be sure we're not overriding something important
  var oldDep, oldMap, oldVersions;

  var isExisting;

  // --- version stuffs ---
  return pkg.locate(target)

  // if not a primary install, and we have something that satisfies this already, then use that
  // otherwise do the full lookup
  .then(function(located) {
    target = located;

    if (options.primary)
      return;

    var versionList = config.versions[target.name];
    if (!versionList)
      return;

    versionList.sort(semver.compare);

    // if not primary, and there is an existing compatible match, use it rather
    if (!options.force)
      for (var i = versionList.length - 1; i >= 0; i--) {
        var curVersion = versionList[i];
        if (!semver.match(target.version, versionList[i]))
          continue;

        var _lookup = new Package(target.exactName);

        _lookup.setVersion(curVersion);

        return _lookup;
      }
  })

  .then(function(_lookup) {
    if (!options.link)
      return pkg.lookup(_lookup || target);
    else
      return link.lookup(_lookup || target);
  })

  .then(function(_lookup) {
    lookup = _lookup;

    if (!options.primary)
      return;

    // store these, as about to be removed
    oldDep = config.dependencies[name];
    oldMap = config.baseMap[name];
    oldVersions = oldMap && config.versions[oldMap.name];

    // prune out the old name from the tree if there is one
    // acts only on config
    return removePackage(name);
  })
  .then(function(deprecated) {
    // about to modify oldVersions potentially
    oldVersions = (oldVersions || []).concat([]);

    deprecated = deprecated || [];
    var versionList = config.versions[lookup.name] || [];

    // check to see if any old versions of this package can be replaced for all dependencies by this lookup version
    var useExisting = false;
    check: for (var i = 0; i < versionList.length; i++) {
      var curVersion = versionList[i];

      // find the critical ranges this version is in (the ranges only it can support)
      var ranges = getCriticalRanges(target.name, curVersion);

      // if this version satisfies all of the ranges, then we can replace with this version
      for (var j = 0; j < ranges.length; j++) {
        if (!semver.match(ranges[j], lookup.version))
          continue check;
      }

      // if the version is not equal to our target, deprecate the old version
      if (lookup.version != curVersion) {
        var oldName = lookup.name + '@' + curVersion;

        if (ranges.length) {
          useExisting = true;
          ui.log('info', (nodeSemver.gt(lookup.version, curVersion) ? 'Upgrading' : 'Downgrading') + ' `' + oldName + '` to `' + lookup.version + '`');
        }
        else {
          // wasn't critical anyway - just remove
          deprecated.push(oldName);
        }
        
        // remove all traces, but leave the package in the file system for cache value
        delete config.depMap[oldName];
        versionList.splice(i--, 1);
      }
    }

    // otherwise see if this target is supported by any of the existing dependencies
    // if so, change lookup to the existing dependency, and note if it is actually a change
    // this is the same check we did for secondary above, but we do it here after trying an upgrade for primary versions
    if (!useExisting)
      for (var i = versionList.length - 1; i >= 0; i--) {
        var curVersion = versionList[i];
        if (target.version && !semver.match(target.version, curVersion))
          continue;

        useExisting = true;

        if (lookup.version != curVersion) {
          ui.log('info', 'Using existing version `' + lookup.name + '@' + curVersion + '`, even though the latest is `' + lookup.version + '` as the tree can\'t be upgraded without forking');
          delete lookup.hash;
          lookup.setVersion(curVersion);
        }

        break;
      }

    // now log deprecations (as we're about to ask a question)
    for (var i = 0; i < deprecated.length; i++) {
      if (deprecated[i] != lookup.exactName)
        ui.log('info', 'Deprecating `' + deprecated[i] + '`');
    }

    // we let this all the way down here as deprecation logging was only just above
    if (!versionList || !versionList.length)
      return;

    // if the fork version was actually already in our list of versions previously, then don't ask again
    if (oldVersions.indexOf(lookup.version) != -1)
      useExisting = true;

    // finally, we are now forking, so note the fork and ask for confirmation
    // disabled - fork prompts == annoying
    if (!useExisting)
      ui.log('info', '%Forking% `' + lookup.name + '` to use versions `' + versionList.concat([lookup.version]).join('`, `') + '`');
      /* return options.force ? Promise.resolve(true) : ui.confirm('`' + lookup.name + '` already has version' + (versionList.length > 1 ? 's `' : ' `') + versionList.join('`, `') + 
        '` installed, which can\'t upgrade to `' + lookup.version + '`. Are you sure you want to install a version fork?', true)
      .then(function(confirm) {
        if (!confirm)
          throw 'Operation cancelled';
      }) */
  })

  // ensure we're happy overriding any map or dependencies
  // then write in our new config.baseMap and config.dependencies
  .then(function() {
    // set dependency version range to semver-compatible when none provided
    if (!target.version) {
      if (lookup.version.match(semver.semverRegEx))
        target.setVersion('^' + lookup.version);
      else
        target.setVersion(lookup.version);
    }

    return Promise.resolve()
    .then(function() {
      // now check we are happy to override dep (primary)
      if (!oldDep)
        return;

      // fill in the oldDep endpoint if it matches our target for replacement prompts
      if (!oldDep.endpoint && !initialTarget.endpoint && oldDep.name == initialTarget.name) {
        var v = oldDep.version;
        oldDep = new Package(target.name);
        oldDep.setVersion(v);
      }

      if (oldDep.exactName == target.exactName)
        return;

      return options.force ? Promise.resolve(true) : ui.confirm('%' + name + '% installed as `' + oldDep.exactName + '`, are you sure you want to install this to `' + target.exactName + '`?', true)
      .then(function(confirm) {
        if (!confirm)
          throw 'Operation cancelled';
      })
    })
    .then(function() {
      // check we are happy to override map (primary)
      if (!oldMap)
        return;

      if (oldMap.exactName == target.exactName)
        return;

      if (oldDep && oldMap.exactName == oldDep.exactName)
        return;

      return options.force ? Promise.resolve(true) : ui.confirm('%' + name + '% is configured to `' + oldMap.exactName + '`, are you sure you want to change this to `' + target.exactName + '`?', true)
      .then(function(confirm) {
        if (!confirm)
          throw 'Operation cancelled';
      });
    })
    .then(function() {
      // if secondary, add the parent map
      if (options.primary || !options.parent)
        return;

      // add deps into our depMap, asking about changes where necessary
      var depMap = config.depMap[options.parent] = config.depMap[options.parent] || {};

      if (!depMap[name] || depMap[name].exactName == target.exactName) {
        depMap[name] = target;
        return;
      }

      // overriding previous dependency - ask
      if (options.force)
        return;

      return ui.confirm('`' + options.parent + '` currently has dependency %' + name + '% set to `' + depMap[name].exactName + '`, but the upgrade expects `' + target.exactName + '`. Update?', true)
      .then(function(confirm) {
        if (confirm)
          depMap[name] = target;
      });
    })
    .then(function() {
      // add the version
      var versionList = config.versions[lookup.name] = config.versions[lookup.name] || [];
      if (versionList.indexOf(lookup.version) == -1)
        versionList.push(lookup.version);

      // only add as a base-level dependency name if primary
      if (options.primary) {
        config.dependencies[name] = target;
        config.baseMap[name] = target;
      }
    })
    
  })

  // --- download ---
  .then(function() {
    if (options.link)
      return link.symlink(lookup, config.jspmPackages, options);

    // if we've already seen this dependency, then circular, so we can skip
    options.seen = options.seen && options.seen.concat([]) || [];
    if (options.seen.indexOf(lookup.exactName) != -1) {
      return;
    }
    options.seen.push(lookup.exactName);

    return Promise.resolve()
    .then(function() {
      if (downloads[lookup.exactName]) {
        isExisting = true;
        return downloads[lookup.exactName].then(function(depMap) {});
      }

      return downloads[lookup.exactName] = pkg.download(lookup, config.jspmPackages, options, function preload(deps) {
        // preload!
        deps.forEach(function(dep) {
          install(dep, {
            force: options.force,
            inject: options.inject,
            link: false, // link is not recursive
            primary: false
          });
        });
      });
    })
    .then(function(depMap) {
      // if we already have a depMap for this dependency, use that rather
      if (!options.force && depMap && config.depMap[lookup.exactName]) {

        // we copy any deps from depMap not in the existing dep map
        // main reason for this is to support "nodelibs", which is
        // a hidden dependency to avoid configuration clutter
        // there is probably a better way
        var curDepMap = {};
        for (var d in config.depMap[lookup.exactName]) {
          curDepMap[d] = config.depMap[lookup.exactName][d].exactName;
        }

        for (var d in depMap) {
          if (!curDepMap[d])
            curDepMap[d] = depMap[d];
        }

        depMap = curDepMap;
      }

      // non-primary installs report completion before their dependencies
      // gives a nicer viewing experience
      if (!options.primary && !isExisting) {
        ui.log('ok', getInstallVerb(lookup.fresh, options) + ' `' + target.exactName + '` (' + lookup.version + ')');
      }

      return depMap ? install(depMap, {
        force: options.force,
        inject: options.inject,
        link: false,
        primary: false,
        parent: lookup.exactName, // parent means configure the depMap
        seen: options.seen
      }) : Promise.resolve();
    });

    
  })

  // save the changes only for primary installs once we're sure the full tree has worked out
  .then(function() {
    if (!options.primary)
      return;

    return config.save();
  })

  .then(function() {
    if (options.primary && !isExisting)
      ui.log('ok', getInstallVerb(lookup.fresh, options) + ' %' + name + '% as `' + target.exactName + '` (' + lookup.version + ')');
  });
}

function getInstallVerb(fresh, options) {
  var verb;
  if (!fresh) {
    if (options.inject)
      return 'Injected';
    else if (!options.link)
      return 'Installed';
    else
      return 'Linked';
  }
  else {
    if (!options.link)
      return 'Up to date -';
    else
      return 'Already linked -';
  }
}

function logTree(tree, branch, depth, seen) {
  seen = seen || [];
  var padding = '';
  for (var i = 0; i < depth; i++)
    padding += '  ';

  seen.push(branch);
  var output = [padding + '+-' + branch];
  if (!tree[branch])
    output.push(padding + '(missing)');
  else
    for (var i = 0; i < tree[branch].length; i++) {
      var leaf = tree[branch][i];
      // show leaf
      if (seen.indexOf(leaf) != -1) {
        output.push(padding + '(repeated)');
      }
      else {
        output.push(logTree(tree, leaf, depth + 1, seen));
      }
    }
  return output.join('\n');
}

exports.build = function() {
  var pjson;
  var savePjson = false;

  return config.load()
  .then(function() {
    return asp(fs.readFile)(path.resolve(config.dir, 'package.json'));
  })
  .then(function(_pjson) {
    pjson = JSON.parse(_pjson);
  })
  .then(function() {
    pjson.buildConfig = pjson.buildConfig || {};
    if (pjson.buildConfig.transpileES6 === undefined) {
      savePjson = true;
      return ui.input('Transpile ES6?', true);
    }
  })
  .then(function(doTranspile) {
    if (doTranspile)
      pjson.buildConfig.transpileES6 = true;
    
    if (!pjson.buildConfig || pjson.buildConfig.minify === undefined) {
      savePjson = true;
      return ui.input('Minify?', true);
    }
  })
  .then(function(doMinify) {
    if (doMinify)
      pjson.buildConfig.minify = true;

    if (savePjson)
      return asp(fs.writeFile)(path.resolve(config.dir, 'package.json'), JSON.stringify(pjson, null, 2));
  })
  .then(function() {
    return asp(rimraf)(config.dist);
  })
  .then(function() {
    return asp(ncp)(config.lib, config.dist);
  })
  .then(function() {
    return build.compileDir(config.dist, {
      format: pjson.format,
      shim: pjson.shim,
      // dependencies: pjson.dependencies && config.parseDependencies(pjson.dependencies, pjson.registry),
      map: pjson.map,
      transpile: pjson.buildConfig.transpileES6,
      minify: pjson.buildConfig.minify,
      removeJSExtensions: pjson.useJSExtensions
    });
  })
  .then(function(compileErrors) {
    if (compileErrors)
      ui.log('warn', 'Compile Errors:\n' + compileErrors);
    else
      ui.log('ok', 'Build Completed');
  }, function(err) {
    ui.log('err', err.stack || err);
  });
}

exports.setMode = function(modes) {
  if (!(modes instanceof Array))
    modes = [modes];

  var msg = '';
  var jspmPackages;

  return config.load()
  .then(function() {
    var jspmPackages = path.relative(config.baseDir, config.jspmPackages);
    if (modes.indexOf('local') == -1)
      return true;
    
    // set local
    Object.keys(config.globalConfig.endpoints).forEach(function(e) {
      config.paths[e + ':*'] = jspmPackages + '/' + e + '/*.js';
    });

    msg += 'Loader set to local library sources\n';
  })
  .then(function(unmatched) {
    if (modes.indexOf('remote') == -1)
      return unmatched;

    // set remote
    Object.keys(config.globalConfig.endpoints).forEach(function(e) {
      config.paths[e + ':*'] = 'https://' + e + '.jspm.io/*.js';
    });

    msg += 'Loader set to CDN library sources\n';
  })
  .then(function(unmatched) {
    if (modes.indexOf('production') == -1)
      return unmatched;

    // set production
    config.name = config.name || 'app';
    config.paths[config.name + '/*'] = (path.relative(config.baseDir, config.dist) || '.') + '/*.js';
    msg += 'Local package URL set to %' + path.relative(config.baseDir, config.dist) + '%.';
  })
  .then(function(unmatched) {
    if (modes.indexOf('dev') == -1)
      return unmatched;

    // set dev
    config.name = config.name || 'app';
    config.paths[config.name + '/*'] = (path.relative(config.baseDir, config.lib) || '.') + '/*.js';
    msg += 'Local package URL set to %' + (path.relative(config.baseDir, config.lib) || '/') + '%.';
  })
  .then(function(unmatched) {
    if (unmatched)
      return ui.log('warn', 'Invalid mode');

    return config.save()
    .then(function() {
      return msg;
    });
  });
}

// attempts to deprecate everything
// resulting in a pruning operation!
exports.prune = function() {
  return config.load()
  .then(function() {
    var deprecated;
    for (var dep in config.depMap) {
      // attempt to deprecate everything!
      for (var subdep in config.depMap[dep])
        if ((deprecated = deprecate(subdep.name, subdep.version)).length)
          ui.log('info', 'Deprecated `' + deprecated.join('`, `') + '`');
    }
  })
  .then(config.save)
  .then(function() {
    ui.log('ok', 'Pruned');
  })
  .catch(function(err) {
    ui.log('err', err.stack || err);
  });
}

// checks if we need to download the loader files
// if so, it does
exports.checkDlLoader = function() {
  return config.load()
  .then(function() {
    return asp(fs.readdir)(config.jspmPackages)
  })
  .catch(function(err) {
    if (err.code === 'ENOENT')
      return [];
    throw err;
  })
  .then(function(files) {
    var found = 0;
    files.forEach(function(file) {
      if (file.match(/^system|es6-module-loader/))
        found++;
    });
    if (found < 2)
      return exports.dlLoader();
  });
}

var ghh = 'https://raw.githubusercontent.com';
var loaderVersions = ['0.9', '0.9', '0.0.66'];

function doLoaderDownload(files) {
  return Promise.all(Object.keys(files).map(function(url) {
    var filename = files[url];
    return asp(request)({
      method: 'get',
      url: ghh + url,
      headers: {
        'user-agent': 'jspm'
      }
    })
    .then(function(res) {
      if (res.statusCode != 200)
        throw 'Request error ' + res.statusCode + ' for ' + ghh + url;

      var source = res.body;

      if (filename == 'traceur.js') {
        source = source.replace('traceur.min.map', 'traceur.js.map');
      }
      else if (filename == 'traceur.js.map') {
        source = source.replace('"traceur.js"', '"traceur.src.js"').replace('"traceur.min.js"', '"traceur.js"');
      }
      else if (filename == 'traceur-runtime.js') {
        source = source.replace('traceur-runtime.min.map', 'traceur-runtime.js.map');
      }
      else if (filename == 'traceur-runtime.js.map') {
        source = source.replace('"traceur-runtime.js"', '"traceur-runtime.src.js"').replace('"traceur-runtime.min.js"', '"traceur-runtime.js"');
      }

      return asp(fs.writeFile)(path.resolve(config.jspmPackages, filename), source);
    })
    .then(function() {
      ui.log('info', '  `' + path.basename(filename) + '`');
    });
  }));
}

exports.dlLoader = function(unminified, edge) {
  var min1 = unminified ? '.src' : '';
  var min2 = unminified ? '' : '.min';

  return config.load()
  .then(function() {
    ui.log('info', 'Downloading loader files to %' + path.relative(config.dir, config.jspmPackages) + '%');
    return asp(mkdirp)(config.jspmPackages);
  })
  .then(function() {
    // delete old versions
    return asp(fs.readdir)(config.jspmPackages)
  })
  .then(function(files) {
    return Promise.all(files.filter(function(file) {
      return file.match(/^(system-csp|system|es6-module-loader|traceur|traceur-runtime)/);
    }).map(function(file) {
      return asp(fs.unlink)(path.resolve(config.jspmPackages, file));
    }));
  })
  .then(function() {
    return Promise.all([
      pkg.lookup(new Package('github:ModuleLoader/es6-module-loader@' + (!edge ? loaderVersions[0] : 'master')))
      .then(function(lookup) {
        var downloadFiles = {};
        downloadFiles['/ModuleLoader/es6-module-loader/' + (edge ? '' : 'v') + lookup.version + '/dist/es6-module-loader' + min1 + '.js'] = 'es6-module-loader.js';
        if (!unminified) {
          downloadFiles['/ModuleLoader/es6-module-loader/' + (edge ? '' : 'v') + lookup.version + '/dist/es6-module-loader.src.js'] = 'es6-module-loader.src.js';
          downloadFiles['/ModuleLoader/es6-module-loader/' + (edge ? '' : 'v') + lookup.version + '/dist/es6-module-loader.js.map'] = 'es6-module-loader.js.map';
        }
        return doLoaderDownload(downloadFiles);
      }),

      pkg.lookup(new Package('github:systemjs/systemjs@' + (!edge ? loaderVersions[1] : 'master')))
      .then(function(lookup) {
        var downloadFiles = {};
        downloadFiles['/systemjs/systemjs/' + lookup.version + '/dist/system' + min1 + '.js'] = 'system.js';
        if (!unminified) {
          downloadFiles['/systemjs/systemjs/' + lookup.version + '/dist/system.src.js'] = 'system.src.js';
          downloadFiles['/systemjs/systemjs/' + lookup.version + '/dist/system.js.map'] = 'system.js.map';
        }
        return doLoaderDownload(downloadFiles);
      }),

      pkg.lookup(new Package('github:jmcriffey/bower-traceur@' + (!edge ? loaderVersions[2] : 'master')))
      .then(function(lookup) {
        var downloadFiles = {};
        downloadFiles['/jmcriffey/bower-traceur/' + lookup.version + '/traceur' + min2 + '.js'] = 'traceur.js';
        downloadFiles['/jmcriffey/bower-traceur-runtime/' + lookup.version + '/traceur-runtime' + min2 + '.js'] = 'traceur-runtime.js';
        if (!unminified) {
          downloadFiles['/jmcriffey/bower-traceur/' + lookup.version + '/traceur.js'] = 'traceur.src.js';
          downloadFiles['/jmcriffey/bower-traceur/' + lookup.version + '/traceur.min.map'] = 'traceur.js.map';
          downloadFiles['/jmcriffey/bower-traceur-runtime/' + lookup.version + '/traceur-runtime.js'] = 'traceur-runtime.src.js';
          downloadFiles['/jmcriffey/bower-traceur-runtime/' + lookup.version + '/traceur-runtime.min.map'] = 'traceur-runtime.js.map';
        }
        return doLoaderDownload(downloadFiles);
      })
    ]);
  })
  .then(function() {
    ui.log('ok', 'Loader files downloaded successfully');
  }, function(err) {
    ui.log('err', 'Error downloading loader files \n' + (err.stack || err));
  });
}

exports.clean = function clean() {
  // ensure baseMap and dependencies match
  // ensure every baseMap target has a matching version
  // ensure every baseMap target version has a depMap
  // ensure all of these depMap items have a corresponding version
  // etc, basically ensure integrity of the whole tree, removing unused versions at the end
  // finally delete all folders in jspm_packages not matching something we had in this verified tree
}

exports.init = function init() {
  return config.load()
  .then(function() {
    var modes = ['local'];
    if (config.name)
      modes.push('dev');
    return core.setMode(modes);
  })
  .then(function() {
    ui.log('ok', 'Verified package.json at %' + path.relative(process.cwd(), path.resolve(config.dir, 'package.json')) + '%\nVerified config file at %' + path.relative(process.cwd(), config.configFile) + '%');
  })
  .catch(function(err) {
    ui.log('err', err.stack || err);
  });
}
