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

var traceur = require('traceur');
var inData = [];
process.stdin.on('data', function(data) {
  inData.push(data);
});
process.stdin.on('end', function(data) {
  inData.push(data || '');
  try {
    var o = JSON.parse(inData.join(''));
  }
  catch(e) {
    process.stdout.write(JSON.stringify({ err: 'Bad input.' }));
    return process.exit(0);
  }

  /*
    o.source
    o.options
    o.file
    o.originalFile
  */
  var project = new traceur.semantics.symbols.Project(o.file);
    
  traceur.options = o.options;

  traceur.options.sourceMaps = true;
  traceur.options.modules = 'parse';

  var reporter = new traceur.util.ErrorReporter();
  reporter.reportMessageInternal = function(location, kind, format, args) {
    process.stdout.write(JSON.stringify({ err: kind + '\n' + o.file + location }));
    process.exit(0);
  }

  var sourceFile = new traceur.syntax.SourceFile(o.file, o.source);
  project.addFile(sourceFile);
  var res = traceur.codegeneration.Compiler.compile(reporter, project, false);

  var sourceMapGenerator = new traceur.outputgeneration.SourceMapGenerator({ file: o.originalFile });
  var opt = { sourceMapGenerator: sourceMapGenerator };

  source = traceur.outputgeneration.ProjectWriter.write(res, opt);

  process.stdout.write(JSON.stringify({
    source: source,
    sourceMap: opt.sourceMap
  }));
});
process.stdin.resume();