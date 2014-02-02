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
var fs = require('graceful-fs');
var glob = require('glob');
var rimraf = require('rimraf');
var traceur = require('traceur');
var uglify = require('uglify-js');
var config = require('./config');
var path = require('path');

var build = module.exports;

traceur.options.sourceMaps = true;
traceur.options.modules = 'amd';

// convert a Node function into a promise
// asp(mkdirp)(dirname).then(...)
var asp = function(fn) {
  return function() {
    var self = this;
    var args = Array.prototype.splice.call(arguments, 0);
    return new Promise(function(resolve, reject) {
      args.push(function(err, val) {
        if (err)
          return reject(err);
        resolve(val);
      });
      fn.apply(self, args);
    });    
  }
}


exports.buildPackage = function(dir, pjson) {

  return build.filterIgnoreAndFiles(dir, pjson.ignore, pjson.files)

  // check if directories.dist exists
  .then(function() {
    if (!pjson.directories || !pjson.directories.dist)
      return;
    return asp(fs.stat)(pjson.directories.dist);
  })
  .then(function(stats) {
    return stats && stats.isDirectory();
  }, function(e) {
    return false;
  })
  .then(function(isDist) {

    // dist -> use this dir and do nothing further
    if (isDist)
      return build.collapseLibDir(dir, pjson.directories.dist);

    // lib -> collapse
    return (pjson.directories && pjson.directories.lib ? build.collapseLibDir(dir, pjson.directories.lib) : Promise.resolve())

    // finally, build
    .then(function() {
      if (pjson.format || pjson.shim || pjson.buildConfig || (pjson.registry && pjson.dependencies) || pjson.map)
        return build.compileDir(dir, {
          format: pjson.format,
          shim: pjson.shim,
          dependencies: pjson.dependencies, // dependencies already parsed into jspm-compatible
          removeJSExtensions: typeof pjson.registry == 'string' && pjson.registry.toLowerCase() == 'npm',
          map: pjson.map,
          transpile: pjson.buildConfig && pjson.buildConfig.transpile,
          minify: pjson.buildConfig && (pjson.buildConfig.uglify || pjson.buildConfig.minify)
        });
    });
  });
}

function inDir(fileName, dir) {
  return fileName.substr(0, dir.length) == dir && fileName.substr(dir.length, 1) == path.sep;
}

exports.filterIgnoreAndFiles = function(dir, ignore, files) {

  if (!ignore || !files)
    return Promise.resolve();
  
  return asp(glob)(dir + path.sep + '**' + path.sep + '*')
  .then(function(allFiles) {
    var removeFiles = [];
  
    allFiles.forEach(function(file) {
      var fileName = path.resolve(dir, file);

      // if files, remove all files except those in the files list
      if (files && !files.some(function(keepFile) {
        if (keepFile.substr(0, 2) == './')
          keepFile = keepFile.substr(2);
        // this file is in a keep dir, or a keep file, don't exclude
        if (inDir(fileName, keepFile) || fileName == keepFile)
          return true;
      }))
        return removeFiles.push(fileName);

      // if ignore, ensure removed
      if (ignore && ignore.some(function(ignoreFile) {
        if (ignoreFile.substr(0, 2) == './')
          ignoreFile = ignoreFile.substr(2);
        // this file is in an ignore dir or an ignore file, ignore
        if (inDir(fileName, ignoreFile) || fileName == ignoreFile)
          return true;
      }))
        removeFiles.push(fileName);
    });

    // do removal
    return Promise.all(removeFiles.map(function(removeFile) {
      return asp(fs.unlink)(path.resolve(dir, removeFile));
    }));
  });
}


exports.collapseLibDir = function(dir, subDir) {
  if (subDir.substr(subDir.length - 1, 1) == '/')
    subDir = subDir.substr(0, subDir.length - 1);

  var tmpDir = path.resolve(dir, '..', '.tmp-' + subDir.split('/').pop());
  
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
      if (matchParts[i].indexOf('*') == -1) {
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
    curMatchLength = match.length;
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
var amdRegEx = /(?:^\s*|[}{\(\);,\n\?\&]\s*)define\s*\(\s*("[^"]+"\s*,|'[^']+'\s*,\s*)?(\[(\s*("[^"]+"|'[^']+')\s*,)*(\s*("[^"]+"|'[^']+')\s*)?\]|function\s*|{|[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*\))/;
var amdDefineRegEx = /(?:^\s*|[}{\(\);,\n\?\&]\s*)define\s*\(\s*("[^"]+"\s*,|'[^']+'\s*,\s*)?(\[(\s*("[^"]+"|'[^']+')\s*,)*(\s*("[^"]+"|'[^']+')\s*)?\])?/g;
var cjsRequireRegEx = /(?:^\s*|[}{\(\);,\n=:\?\&]\s*)require\s*\(\s*("([^"]+)"|'([^']+)')\s*\)/g;
var cjsExportsRegEx = /(?:^\s*|[}{\(\);,\n=:\?\&]\s*|module\.)(exports\s*\[\s*('[^']+'|"[^"]+")\s*\]|\exports\s*\.\s*[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*|exports\s*\=)/;

/*
  options.format
  options.shim
  options.dependencies
  options.map
  options.removeJSExtensions
  options.transpile
  options.minify
*/
exports.compileDir = function(dir, options) {
  dir = path.resolve(dir);

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

      if (curDep && curDep != '*')
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
      
      return asp(fs.readFile)(file)
      .then(function(source) {
        source += '';
        
        return Promise.resolve()
        // add shim config if necessary
        .then(function() {
          if (!options.shim)
            return;

          for (var s in options.shim) {
            if (!matchWithWildcard(s, relFile))
              continue;

            var curShim = options.shim[s];
            if (curShim instanceof Array)
              curShim = { deps: curShim };

            // NB backwards-compatible with shim.imports
            curShim.deps = curShim.deps || curShim.imports;

            var depStr = '"global";' + nl;
            if (curShim.deps)
              for (var i = 0; i < curShim.deps.length; i++)
                depStr += '"import ' + curShim.deps[i] + '";' + nl;

            if (curShim.exports)
              depStr += '"export ' + shimDeps.exports + '";' + nl;

            changed = true;
            source = depStr + source;
            return;
          }
        })

        // add any format hint if provided
        // only add format hint if detection would fail
        // also set the format here if not set
        .then(function() {
          cjsExportsRegEx.lastIndex = 0;
          cjsRequireRegEx.lastIndex = 0;
          if (source.match(es6RegEx)) {
            format = format || 'es6';
            if (format == 'es6')
              return;
          }
          else if (source.match(amdRegEx)) {
            format = format || 'amd';
            if (format == 'amd')
              return;
          }
          else if (cjsRequireRegEx.exec(source) || cjsExportsRegEx.exec(source)) {
            format = format || 'cjs';
            if (format == 'cjs')
              return;
          }
          else {
            format = format || 'global';
            if (format == 'global')
              return;
          }

          changed = true;
          source = '"' + format + '";' + nl + source;
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
            source = source.replace(cjsRequireRegEx, function(statement, str, singleString, doubleString) {
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
          if (changed)
            return asp(fs.writeFile)(file, source);
        })

        // transpile
        .then(function() {
          if (!options.transpile)
            return;

          try {
            var reporter = new traceur.util.ErrorReporter();
            reporter.reportMessageInternal = function(location, kind, format, args) {
              throw path.relative(dir, location.toString()) + ': ' + kind;
            }

            var parser = new traceur.syntax.Parser(reporter, new traceur.syntax.SourceFile(relFile, source));

            var transformer = new traceur.codegeneration.FromOptionsTransformer(reporter);
            var tree = parser.parseModule();
            tree = transformer.transform(tree);

            // convert back to a source string
            var sourceMapGenerator = new traceur.outputgeneration.SourceMapGenerator({ file: relFile.replace(/\.js$/, '.src.js') });
            var opt = { sourceMapGenerator: sourceMapGenerator };

            source = traceur.outputgeneration.TreeWriter.write(tree, opt);
            sourceMap = opt.sourceMap;
          }
          catch(e) {
            // an error in one compiled file doesn't stop all compilation
            if (!e.stack)
              compileErrors += e + '\n';
            else
              compileErrors += relFile + ': Unable to transpile ES6\n';
          }
        })

        // minify
        .then(function() {
          if (!options.minify)
            return;

          try {
            var ast = uglify.parse(source, { filename: relFile.replace(/\.js$/, '.src.js') });
            
            ast.figure_out_scope();

            ast = ast.transform(uglify.Compressor({ warnings: false }));

            ast.figure_out_scope();
            ast.compute_char_frequency();
            ast.mangle_names();

            var source_map = uglify.SourceMap({
              file: relFile,
              orig: sourceMap
            });

            source = ast.print_to_string({
              comments: function(node, comment) {
                return comment.line == 1 && comment.col == 0;
              }
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

          // write .js as the current source
          .then(function() {
            return asp(fs.writeFile)(file, source);
          })

          // write the source map to .js.map
          .then(function() {
            return asp(fs.writeFile)(file + '.map', sourceMap);
          });
        })
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












