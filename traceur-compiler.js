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

    /*
      o.source
      o.options
      o.file
      o.originalFile
    */

    traceur.options = o.options;
    traceur.options.sourceMaps = true;
    traceur.options.modules = 'parse';

    var reporter = new traceur.util.ErrorReporter();
    reporter.reportMessageInternal = function(location, kind, format, args) {
      process.stdout.write(JSON.stringify({ err: kind + '\n' + o.file + location }));
      process.exit(0);
    }

    var parser = new traceur.syntax.Parser(reporter, new traceur.syntax.SourceFile(o.file, o.source));
    var tree = parser.parseModule();

    var project = new traceur.semantics.symbols.Project(o.file);
    var transformer = new traceur.codegeneration.ProgramTransformer(reporter, project);
    tree = transformer.transform(tree);

    // generate source
    var sourceMapGenerator = new traceur.outputgeneration.SourceMapGenerator({ file: o.originalFile });
    var opt = { sourceMapGenerator: sourceMapGenerator };

    var source = traceur.outputgeneration.TreeWriter.write(tree, opt);

    process.stdout.write(JSON.stringify({
      source: source,
      sourceMap: opt.sourceMap
    }));
  }
  catch(e) {
    process.stdout.write(JSON.stringify({ err: e.toString() }));
    return process.exit(0);
  }
});
process.stdin.resume();