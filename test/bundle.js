var fs = require('fs');

suite('Bundle Tests', function() {

  var actualPath = "build.js";

  test('basic bundle test', function(done) {
      var expectedPath = "../fixtures/expected/build.js";
      var exampleArgs = ['bundle', 'fixtures/js/final', 'build.js'];
      project(function() {
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          jspm.bundle(exampleArgs).then(function() {
              assert(fs.existsSync(actualPath));
              assert(fs.existsSync(expectedPath));
              var actualBuildFile = fs.readFileSync(actualPath);
              var expectedBuildFile = fs.readFileSync(expectedPath);
              assert.equal(actualBuildFile.toString(), expectedBuildFile.toString());
              done();
          }).catch(done);
      });
  });

  test('basic bundle subtract test', function(done) {
      var exampleArgs = ['bundle', 'fixtures/js/final', '-', 'jquery', 'build.js'];
      var expectedPath = "../fixtures/expected/minus.js";
      project(function() {
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          jspm.bundle(exampleArgs).then(function() {
              assert(fs.existsSync(actualPath));
              assert(fs.existsSync(expectedPath));
              var actualBuildFile = fs.readFileSync(actualPath);
              var expectedBuildFile = fs.readFileSync(expectedPath);
              assert.equal(actualBuildFile.toString(), expectedBuildFile.toString());
              done();
          }).catch(done);
      });
  });

  test('basic bundle add test', function(done) {
      var exampleArgs = ['bundle', 'fixtures/js/final', '+', 'ember', 'build.js'];
      var expectedPath = "../fixtures/expected/add.js";
      project(function() {
          project.registry['ember'] = 'github:ember';
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          project.versions['github:ember'] = { '1.5.1': 'mmmm' };
          jspm.bundle(exampleArgs).then(function() {
              assert(fs.existsSync(actualPath));
              assert(fs.existsSync(expectedPath));
              var actualBuildFile = fs.readFileSync(actualPath);
              var expectedBuildFile = fs.readFileSync(expectedPath);
              assert.equal(actualBuildFile.toString(), expectedBuildFile.toString());
              done();
          }).catch(done);
      });
  });

  test('basic bundle add and subtract test', function(done) {
      var exampleArgs = ['bundle', 'fixtures/js/final', '+', 'ember', '-', 'jquery', 'build.js'];
      var expectedPath = "../fixtures/expected/multiple.js";
      project(function() {
          project.registry['ember'] = 'github:ember';
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          project.versions['github:ember'] = { '1.5.1': 'mmmm' };
          jspm.bundle(exampleArgs).then(function() {
              assert(fs.existsSync(actualPath));
              assert(fs.existsSync(expectedPath));
              var actualBuildFile = fs.readFileSync(actualPath);
              var expectedBuildFile = fs.readFileSync(expectedPath);
              assert.equal(actualBuildFile.toString(), expectedBuildFile.toString());
              done();
          }).catch(done);
      });
  });

  test('basic bundle test (with no additional arguments)', function(done) {
      var exampleArgs = ['bundle'];
      var expectedPath = "../fixtures/expected/minus.js";
      project(function() {
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          jspm.bundle(exampleArgs).then(function() {
              project.assertLog('warn', 'No main entry point is provided, please specify the module to build');
              done();
          }).catch(done);
      });
  });

  test('basic bundle test (with only 1 argument)', function(done) {
      var exampleArgs = ['bundle', 'fixtures/js/final'];
      var expectedPath = "../fixtures/expected/minus.js";
      project(function() {
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          jspm.bundle(exampleArgs).then(function() {
              project.assertLog('warn', 'No filename provided, please specify the filename for the output file');
              done();
          }).catch(done);
      });
  });

  test('bundle test with incorrect arithmetic arguments (only operator)', function(done) {
      var exampleArgs = ['bundle', 'fixtures/js/final', '+'];
      var incorrectlyGeneratedFile = "+";
      project(function() {
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          jspm.bundle(exampleArgs).then(function() {
              assert(!fs.existsSync(incorrectlyGeneratedFile));
              project.assertLog('warn', 'Operator supplied without module name, please specify the module name after the operator');
              done();
          }).catch(done);
      });
  });

  test('bundle test with incorrect arithmetic arguments (no filename)', function(done) {
      var exampleArgs = ['bundle', 'fixtures/js/final', '+', 'ember'];
      var incorrectlyGeneratedFile = "ember";
      project(function() {
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          jspm.bundle(exampleArgs).then(function() {
              assert(!fs.existsSync(incorrectlyGeneratedFile));
              project.assertLog('warn', 'No filename provided, please specify the filename for the output file');
              done();
          }).catch(done);
      });
  });

  test('bundle test with incorrect arithmetic arguments (no moduleName for 2nd operation)', function(done) {
      var exampleArgs = ['bundle', 'fixtures/js/final', '+', 'ember', '-'];
      var incorrectlyGeneratedFile = "-";
      project(function() {
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          jspm.bundle(exampleArgs).then(function() {
              assert(!fs.existsSync(incorrectlyGeneratedFile));
              project.assertLog('warn', 'Operator supplied without module name, please specify the module name after the operator');
              done();
          }).catch(done);
      });
  });

});
