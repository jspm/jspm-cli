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
var asp = require('rsvp').denodeify;
var fs = require('graceful-fs');
var glob = require('glob');
var rimraf = require('rimraf');
var traceur = require('traceur');
var uglify = require('uglify-js');
var config = require('./config');
var path = require('path');
var minimatch = require('minimatch');

var build = module.exports;

exports.buildPackage = function(dir, pjson) {

  return build.filterIgnoreAndFiles(dir, pjson.ignore, pjson.files)

  // check if directories.dist exists
  // if so collapse and do nothing further
  .then(function() {
    if (!pjson.directories || !pjson.directories.dist)
      return;
    
    return asp(fs.stat)(path.resolve(dir, pjson.directories.dist))
    .then(function(stats) {
      return stats && stats.isDirectory();
    }, function(e) {
      return false;
    })
    .then(function(dist) {
      if (dist)
        return build.collapseLibDir(dir, pjson.directories.dist).then(function() { return true; });
    })
  })

  // check if directories.lib exists, if so collapse
  .then(function(dist) {
    if (dist)
      return true;

    if (!pjson.directories || !pjson.directories.lib)
      return;

    return asp(fs.stat)(path.resolve(dir, pjson.directories.lib))
    .then(function(stats) {
      return stats && stats.isDirectory();
    }, function(e) {
      return false;
    })
    .then(function(dist) {
      if (dist)
        return build.collapseLibDir(dir, pjson.directories.lib)
    });
  })

  // finally, build
  .then(function(hasDist) {
    if (pjson.format || pjson.shim || pjson.buildConfig || (pjson.registry && pjson.dependencies) || pjson.map)
      return build.compileDir(dir, {
        format: pjson.format,
        shim: pjson.shim,
        dependencies: pjson.dependencies, // dependencies already parsed into jspm-compatible
        removeJSExtensions: pjson.useJSExtensions,
        map: pjson.map,
        transpile: !hasDist && pjson.buildConfig && pjson.buildConfig.transpile,
        minify: !hasDist && pjson.buildConfig && (pjson.buildConfig.uglify || pjson.buildConfig.minify)
      });
  });
}

function inDir(fileName, dir, sep) {
  return fileName.substr(0, dir.length) == dir && (sep === false || fileName.substr(dir.length - 1, 1) == path.sep);
}

exports.filterIgnoreAndFiles = function(dir, ignore, files) {

  if (!ignore && !files)
    return Promise.resolve();
  
  return asp(glob)(dir + path.sep + '**' + path.sep + '*')
  .then(function(allFiles) {
    var removeFiles = [];
  
    allFiles.forEach(function(file) {
      var fileName = path.relative(dir, file);

      // if files, remove all files except those in the files list
      if (files && !files.some(function(keepFile) {
        if (keepFile.substr(0, 2) == './')
          keepFile = keepFile.substr(2);

        // this file is in a keep dir, or a keep file, don't exclude
        if (inDir(fileName, keepFile, false) || minimatch(fileName, keepFile))
          return true;
      }))
        return removeFiles.push(fileName);

      // if ignore, ensure removed
      if (ignore && ignore.some(function(ignoreFile) {
        if (ignoreFile.substr(0, 2) == './')
          ignoreFile = ignoreFile.substr(2);
        // this file is in an ignore dir or an ignore file, ignore
        if (inDir(fileName, ignoreFile) || minimatch(fileName, ignoreFile))
          return true;
      }))
        removeFiles.push(fileName);
    });

    // do removal
    return Promise.all(removeFiles.map(function(removeFile) {
      return asp(fs.unlink)(path.resolve(dir, removeFile)).catch(function(e) {
        if (e.code == 'EPERM' || e.code == 'EISDIR')
          return;
        throw e;
      });
    }));
  });
}


exports.collapseLibDir = function(dir, subDir) {
  if (subDir.substr(subDir.length - 1, 1) == '/')
    subDir = subDir.substr(0, subDir.length - 1);

  var tmpDir = path.resolve(dir, '..', '.tmp-' + dir.split(path.sep).pop());
  
  // move subDir to tmpDir
  return asp(fs.rename)(dir + path.sep + subDir, tmpDir)

  // remove everything in dir
  .then(function() {
    return asp(rimraf)(dir);
  })

  // move subDir to dir
  .then(function() {
    return asp(fs.rename)(tmpDir, dir);
  });
}


function matchWithWildcard(matches, name) {
  var curMatch;
  var curMatchLength;
  
  main:
  for (var p in matches) {
    var matchParts = p.split('/');
    var nameParts = name.split('/');
    if (matchParts.length != nameParts.length)
      continue;

    var match;

    for (var i = 0; i < matchParts.length; i++) {
      // do wildcard matching on individual parts if necessary
      if (matchParts[i].indexOf('*') != -1) {
        if (!(match = nameParts[i].match(new RegExp(matchParts[i].replace(/([^*\w])/g, '\\$1').replace(/(\*)/g, '(.*)')))));
          continue main;
      }
      else if (nameParts[i] != matchParts[i])
        continue main;  
    }
  
    // least wildcards in match wins
    if (p.length >= curMatchLength)
      continue;

    curMatch = p;
    curMatchLength = matchParts.length;
  }
  return curMatch;
}
// return the number of prefix parts (separated by '/') matching the name
// eg prefixMatchLength('jquery/some/thing', 'jquery') -> 1
function prefixMatchLength(name, prefix) {
  var prefixParts = prefix.split('/');
  var nameParts = name.split('/');
  if (prefixParts.length > nameParts.length)
    return 0;
  for (var i = 0; i < prefixParts.length; i++)
    if (nameParts[i] != prefixParts[i])
      return 0;
  return prefixParts.length;
}

// while doing map, we also remove ".js" extensions where necessary
function applyMap(_name, map, baseFile, removeJSExtensions) {
  var name = _name;
  if (removeJSExtensions) {
    if (name.substr(0, 2) == './' || name.split('/').length > 1) {
      if (name.substr(name.length - 3, 3) == '.js')
        name = name.substr(0, name.length - 3);
      if (name.substr(name.length - 5, 5) == '.json')
        name = name + '!';
    }
  }

  for (var m in map) {
    var matchLength = prefixMatchLength(name, m);
    if (!matchLength)
      continue;

    var subPath = name.split('/').splice(matchLength).join('/');

    var toMap = map[m];

    if (toMap.substr(0, 2) == './') {
      // add .js in case of matching directory name
      toMap = path.relative(path.dirname(baseFile), toMap.substr(2) + '.js');
      if (toMap.substr(0, 1) != '.')
        toMap = './' + toMap;
      // remove .js
      toMap = toMap.substr(0, toMap.length - 3);
    }

    return toMap + (subPath ? '/' + subPath : '');
  }

  // just removed extension -> still did something
  if (name != _name)
    return name;
}

// NB keep these up to date with SystemJS
var es6RegEx = /(?:^\s*|[}{\(\);,\n]\s*)(import\s+['"]|(import|module)\s+[^"'\(\)\n;]+\s+from\s+['"]|export\s+(\*|\{|default|function|var|const|let|[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*))/;
var es6DepRegEx = /(^|\}|\s)(from|import)\s*("([^"]+)"|'([^']+)')/g;
var amdRegEx = /(?:^|[^$_a-zA-Z\xA0-\uFFFF.])define\s*\(\s*("[^"]+"\s*,\s*|'[^']+'\s*,\s*)?\s*(\[(\s*(("[^"]+"|'[^']+')\s*,|\/\/.*\r?\n|\/\*(.|\s)*?\*\/))*(\s*("[^"]+"|'[^']+')\s*,?)?(\s*(\/\/.*\r?\n|\/\*(.|\s)*?\*\/))*\s*\]|function\s*|{|[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*\))/;
var amdDefineRegEx = /(?:^|[^$_a-zA-Z\xA0-\uFFFF.])define\s*\(\s*("[^"]+"\s*,|'[^']+'\s*,\s*)?(\[(\s*("[^"]+"|'[^']+')\s*,)*(\s*("[^"]+"|'[^']+')\s*)?\])?/g;
var cjsRequireRegEx = /(?:^|[^$_a-zA-Z\xA0-\uFFFF.])require\s*\(\s*("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')\s*\)/g;
var cjsExportsRegEx = /(?:^|[^$_a-zA-Z\xA0-\uFFFF.]|module\.)(exports\s*\[['"]|\exports\s*\.)|(?:^|[^$_a-zA-Z\xA0-\uFFFF.])module\.exports\s*\=/;

var metaRegEx = /^(\s*\/\*.*\*\/|\s*\/\/[^\n]*|\s*"[^"]+"\s*;?|\s*'[^']+'\s*;?)+/;
var metaPartRegEx = /\/\*.*\*\/|\/\/[^\n]*|"[^"]+"\s*;?|'[^']+'\s*;?/g;

  // var commentRegEx = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg;
var initialCommentRegEx = /^\s*(\/\*|\/\/)/;

/*
  options.format
  options.shim
  options.dependencies
  options.map
  options.removeJSExtensions
  options.transpile
  options.minify
  options.sourceURLBase
*/
exports.compileDir = function(dir, options) {
  dir = path.resolve(dir);

  options.sourceURLBase = options.sourceURLBase || '';

  // store a list of compile errors
  var compileErrors = '';

  // create the map config
  // convert jspm options.dependencies into a requirable form
  // and combine them into a new map object
  var map = {};
  if (options.map)
    for (var m in options.map)
      map[m] = options.map[m];

  if (options.dependencies) {
    for (var d in options.dependencies) {
      // custom map overrides dependency map
      if (map[d])
        continue;

      var curDep = options.dependencies[d];
      if (curDep.indexOf(':') != -1 || curDep.indexOf('@') != -1)
        map[d] = curDep;

      else if (curDep && curDep != '*')
        map[d] = d + '@' + curDep;
      else
        map[d] = d;
    }
  }

  var nl = '\n';

  // glob each ".js" file
  return asp(glob)(dir + path.sep + '**' + path.sep + '*.js')

  .then(function(files) {

    return Promise.all(files.map(function(file) {

      var changed = false;

      var sourceMap;

      var format;
      if (options.format && typeof options.format == 'string')
        format = options.format.toLowerCase();

      var relFile = path.relative(dir, file);
      var relModule = relFile.substr(0, relFile.length - 3);

      // first check if a symlink
      return asp(fs.lstat)(file)
      .then(function(stats) {
        if (stats.isSymbolicLink())
          return;

        return asp(fs.readFile)(file)
        .then(function(source) {
          source += '';
          
          return Promise.resolve()
          // add shim config if necessary
          .then(function() {
            if (!options.shim)
              return;

            var match;

            if (!(match = matchWithWildcard(options.shim, relModule)))
              return;

            var curShim = options.shim[match];
            if (curShim instanceof Array)
              curShim = { deps: curShim };

            // NB backwards-compatible with shim.imports
            curShim.deps = curShim.deps || curShim.imports;

            if (typeof curShim.deps == 'string')
              curShim.deps = [curShim.deps];

            var depStr = '"format global";' + nl;
            if (curShim.deps)
              for (var i = 0; i < curShim.deps.length; i++)
                depStr += '"deps ' + curShim.deps[i] + '";' + nl;

            if (curShim.exports)
              depStr += '"exports ' + curShim.exports + '";' + nl;

            changed = true;
            source = depStr + source;

            return true;
          })

          // add any format hint if provided
          // only add format hint if detection would fail
          // also set the format here if not set
          // NB all regexs should apply after removing comments
          // also ideally format injection should be post-minification
          // in case of minification quirks
          .then(function(shimmed) {
            // don't add format if already shimmed!
            if (shimmed)
              return;

            // first checkout if we have format meta
            var meta = source.match(metaRegEx);
            var metadata = {};
            if (meta) {
              var metaParts = meta[0].match(metaPartRegEx);
              for (var i = 0; i < metaParts.length; i++) {
                var len = metaParts[i].length;

                var firstChar = metaParts[i].substr(0, 1);
                if (metaParts[i].substr(len - 1, 1) == ';')
                  len--;
              
                if (firstChar != '"' && firstChar != "'")
                  continue;

                var metaString = metaParts[i].substr(1, metaParts[i].length - 3);

                var metaName = metaString.substr(0, metaString.indexOf(' '));
                if (metaName) {
                  var metaValue = metaString.substr(metaName.length + 1, metaString.length - metaName.length - 1);

                  if (metadata[metaName] instanceof Array)
                    metadata[metaName].push(metaValue);
                  else
                    metadata[metaName] = metaValue;
                }
              }
            }

            if (metadata.format)
              return;

            cjsExportsRegEx.lastIndex = 0;
            cjsRequireRegEx.lastIndex = 0;
            if (source.match(es6RegEx)) {
              format = format || 'es6';
            }
            else if (source.match(amdRegEx)) {
              format = format || 'amd';
            }
            else if (cjsRequireRegEx.exec(source) || cjsExportsRegEx.exec(source)) {
              format = format || 'cjs';
            }
            else {
              format = format || 'global';
            }

            changed = true;
            source = '"format ' + format + '";' + nl + source;
          })

          // apply map config
          .then(function() {

            // ES6
            if (format == 'es6') {
              source = source.replace(es6DepRegEx, function(statement, start, type, str, singleString, doubleString) {
                var name = singleString || doubleString;
                var mapped = applyMap(name, map, relFile, options.removeJSExtensions);

                if (!mapped)
                  return statement;

                changed = true;
                return statement.replace(new RegExp('"' + name + '"|\'' + name + '\'', 'g'), '\'' + mapped + '\'');
              });
            }

            // AMD
            else if (format == 'amd') {
              amdDefineRegEx.lastIndex = 0;
              var defineStatement = amdDefineRegEx.exec(source);
              if (defineStatement) {
                if (!defineStatement[2])
                  return;
                
                var depArray = eval(defineStatement[2]);
                depArray.map(function(name) {
                  var mapped = applyMap(name, map, relFile, options.removeJSExtensions);
                  if (!mapped)
                    return name;

                  changed = true;
                  return mapped;
                });

                if (changed)
                  source = source.replace(defineStatement[2], JSON.stringify(depArray));
              }
            }

            // CommonJS
            else if (format == 'cjs') {
              source = source.replace(cjsRequireRegEx, function(statement, singleString, doubleString) {
                var name = singleString || doubleString;
                var mapped = applyMap(name, map, relFile, options.removeJSExtensions);

                if (!mapped)
                  return statement;

                changed = true;
                return statement.replace(new RegExp('"' + name + '"|\'' + name + '\'', 'g'), '\'' + mapped + '\'');
              });
            }

            // Global? (including shim?)
            else {
            }
          })

          
          // if changed, save these meta-updates into the original file
          .then(function() {

            // ensure there is a comment at the beginning of the file
            // this is necessary to protect the source map when wrapping
            if (!source.match(initialCommentRegEx)) {
              source = '\/* *\/ \n' + source;
              changed = true;
            }

            if (changed)
              return asp(fs.writeFile)(file, source);
          })

          // transpile
          .then(function() {
            if (!options.transpile)
              return;

            traceur.options.sourceMaps = true;
            traceur.options.modules = 'instantiate';

            try {
              var compiler = new traceur.Compiler({
                moduleName: '',
                modules: 'instantiate'
              });

              source = compiler.compile(source, relFile, path.basename(relFile.replace(/\.js$/, '.src.js')));
              sourceMap = compiler.getSourceMap();
            }
            catch(e) {
              // an error in one compiled file doesn't stop all compilation

              if (!e.stack)
                compileErrors +=  + '\n';
              else
                compileErrors += e.stack + '\n' + relFile + ': Unable to transpile ES6\n';
            }
          })

          // minify
          .then(function() {
            if (!options.minify)
              return;

            try {
              var ast = uglify.parse(source, { filename: path.basename(relFile.replace(/\.js$/, '.src.js')) });
              
              ast.figure_out_scope();

              ast = ast.transform(uglify.Compressor({ warnings: false }));

              ast.figure_out_scope();
              ast.compute_char_frequency();
              ast.mangle_names({
                except: ['require']
              });

              var source_map = uglify.SourceMap({
                file: path.basename(relFile),
                orig: sourceMap
              });

              source = ast.print_to_string({
                ascii_only: true, // for some reason non-ascii broke esprima
                comments: function(node, comment) {
                  return comment.line == 1 && comment.col == 0;
                },
                source_map: source_map
              });
              sourceMap = source_map.toString();
            }
            catch(e) {
              // an error in one compiled file doesn't stop all compilation
              compileErrors += relFile + ': Unable to minify file\n';
            }
          })

          // finally, if compiled, rename to the new file with source maps
          .then(function() {
            if (!options.minify && !options.transpile)
              return;

            // rename the original with meta changes to .src.js
            return asp(fs.rename)(file, file.replace(/\.js$/, '.src.js'))

            // write .js as the current source, with a source map comment
            .then(function() {
              return asp(fs.writeFile)(file, source + '\n//# sourceMappingURL=' + relFile.split('/').pop() + '.map');
            })

            // write the source map to .js.map
            .then(function() {
              return asp(fs.writeFile)(file + '.map', sourceMap);
            });
          })
        });
      }, function(e) {
        // rethrow an error that wasn't a file read error
        if (e.code == 'EISDIR')
          return;
        else
          throw e;
      });
    }))
  })

  // output of compile promise is any compile errors
  .then(function() {
    return compileErrors;
  });
}












