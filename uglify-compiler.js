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

var uglifyJS = require('uglify-js');
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
    return process.exit(1);
  }

  /*
    o.source
    o.sourceMap
    o.options
    o.file
    o.originalFile
  */
  try {
    var result = uglifyJS.minify(o.source, {
      fileName: o.originalFile,
      inSourceMap: o.sourceMap,
      outSourceMap: o.file + '.map',
      compress: o.options,
      output: {
        comments: function(node, comment) {
          if (comment.line == 1 && comment.col == 0)
            return true;
          else
            return false;
        }
      },
      fromString: true
    });
    process.stdout.write(JSON.stringify({
      source: result.code,
      sourceMap: result.map
    }));
  }
  catch(e) {
    process.stdout.write(JSON.stringify({ err: e + '' }));
    process.stdout.end();
  }
});
process.stdin.resume();