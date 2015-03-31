/* */
var build = require('../lib/build');
var asp = require('rsvp').denodeify;
var path = require('path');
var fs = require('fs');

/*
   options.format
   options.shim
   options.dependencies
   options.map
   options.removeJSExtensions
   options.transpile
   options.minify
   options.sourceURLBase
   options.alwaysIncludeFormat
*/

suite('compileDir', function() {
   /* copy the fixtures to 'output' dir so we can mangle them there */
   var ncp = require('ncp').ncp;
   ncp.limit = 16;
   ncp(path.join(__dirname, 'fixtures/compile/'), path.join(__dirname, './outputs/compile'), function (err) {
      if (err) return console.error(err);
      console.log('copied compileDir fixtures to output');
   });

   test('Allows shimming of commonjs modules and when shim is defined as array', function(done) {
      var inputDir = path.join(__dirname, 'outputs/compile/shim/cjs/');
      var outputFile = path.join(__dirname, 'outputs/compile/shim/cjs/entry.js');
      var options = {
         format: undefined,
         dependencies: undefined,
         shim: {
            'entry': [ 'cjs-dep' ]
         },
         map: undefined,
         removeJSExtensions: undefined,
         transpile: undefined,
         minify: undefined,
         sourceURLBase: inputDir,
         alwaysIncludeFormat: undefined
      };
      build.compileDir(inputDir, options)
         .then(function() {
            return asp(fs.readFile)(outputFile, 'utf8');
         })
         .then(function(source) {
            //console.log(source);
            assert(source.match(/\s*"format cjs";\s*/));
            assert(source.match(/\s*"deps cjs-dep";\s*/));
         })
         .then(done, done);
   });

   test('Forces format to global if shim export is configured', function(done) {
      var inputDir = path.join(__dirname, 'outputs/compile/shim/global/');
      var outputFile = path.join(__dirname, 'outputs/compile/shim/global/entry.js');
      var options = {
         format: undefined,
         dependencies: undefined,
         shim: {
            'entry': {
               deps: [ 'global-dep' ],
               exports: 'birmingham'
            }
         },
         map: undefined,
         removeJSExtensions: undefined,
         transpile: undefined,
         minify: undefined,
         sourceURLBase: inputDir,
         alwaysIncludeFormat: undefined
      };
      build.compileDir(inputDir, options)
         .then(function() {
            return asp(fs.readFile)(outputFile, 'utf8');
         })
         .then(function(source) {
            //console.log(source);
            assert(source.match(/\s*"format global";\s*/));
            assert(source.match(/\s*"exports birmingham";\s*/));
            assert(source.match(/\s*"deps global-dep";\s*/));
         })
         .then(done, done);
   });

   test('Does not process files in node_modules or jspm_packages (when linking)', function(done) {
      var inputDir = path.join(__dirname, 'outputs/compile/glob/cjs');
      var nodeFile = path.join(__dirname, 'outputs/compile/glob/cjs/node_modules/ignoreme.js');
      var jspmFile = path.join(__dirname, 'outputs/compile/glob/cjs/jspm_packages/ignoreme2.js');
      var entryFile = path.join(__dirname, 'outputs/compile/glob/cjs/entry.js');
      var options = {
         format: undefined,
         shim: undefined,
         dependencies: undefined,
         map: undefined,
         removeJSExtensions: undefined,
         transpile: undefined,
         minify: undefined,
         sourceURLBase: inputDir,
         alwaysIncludeFormat: undefined
      };
      build.compileDir(inputDir, options)
         .then(function() {
            return asp(fs.readFile)(nodeFile, 'utf8');
         })
         .then(function(source) {
            assert(source == 'var seeme = false;\nmodule.exports = seeme;');
         })
         .then(function() {
            return asp(fs.readFile)(jspmFile, 'utf8');
         })
         .then(function(source) {
            assert(source == 'window.seeme = false;');
         })
         .then(function() {
            return asp(fs.readFile)(entryFile, 'utf8');
         })
         .then(function(source) {
            assert(source.match(/\s*"format cjs";\s*/));
         })
         .then(done, done);
   });

   test('Shims files with non-js extensions', function(done) {
      var inputDir = path.join(__dirname, 'outputs/compile/shim/es6/');
      var outputFile = path.join(__dirname, 'outputs/compile/shim/es6/entry.es6');
      var options = {
         format: undefined,
         shim: {
            'entry.es6': [ 'entry.css' ]
         },
         dependencies: undefined,
         map: undefined,
         removeJSExtensions: undefined,
         transpile: undefined,
         minify: undefined,
         sourceURLBase: inputDir,
         alwaysIncludeFormat: undefined
      };
      build.compileDir(inputDir, options)
         .then(function() {
            return asp(fs.readFile)(outputFile, 'utf8');
         })
         .then(function(source) {
            //console.log(source);
            assert(source.match(/\s*"format es6";\s*/));
            assert(source.match(/\s*"deps entry.css";\s*/));
         })
         .then(done, done);
   });

   test('Detected format does not override specified format', function(done) {
      var inputDir = path.join(__dirname, 'outputs/compile/format/cjs');
      var outputFile = path.join(__dirname, 'outputs/compile/format/cjs/entry.js');
      var options = {
         format: 'global',
         shim: undefined,
         dependencies: undefined,
         map: undefined,
         removeJSExtensions: undefined,
         transpile: undefined,
         minify: undefined,
         sourceURLBase: undefined,
         alwaysIncludeFormat: undefined
      };
      build.compileDir(inputDir, options)
         .then(function() {
            return asp(fs.readFile)(outputFile, 'utf8');
         })
         .then(function(source) {
            //console.log(source);
            assert(source.match(/\s*"format global";\s*/));
         })
         .then(done, done);
   });
});
