#!/usr/bin/env node
var traceur = require('traceur');
process.stdin.resume();
process.stdin.on('data', function(inData) {
  try {
    var o = JSON.parse(inData);
  }
  catch(e) {
    process.stderr.write('Invalid options data.');
    return process.exit(1);
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
    process.stderr.write(kind + '\n' + o.file + location);
    process.exit(1);
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
  process.exit(0);
});