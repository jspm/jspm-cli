var fs = require('fs');

suite('Basic Core Tests', function() {

  var actualPath = "build.js";

  test('basic bundle test (without filename)', function(done) {
      var expectedPath = "../fixtures/expected/build.js";
      var example_args = ['bundle', 'fixtures/js/final'];
      project(function() {
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          jspm.bundle(example_args).then(function() {
              assert(fs.existsSync(actualPath));
              assert(fs.existsSync(expectedPath));
              var actualBuildFile = fs.readFileSync(actualPath);
              var expectedBuildFile = fs.readFileSync(expectedPath);
              assert.equal(actualBuildFile.toString(), expectedBuildFile.toString());
              done();
          }).catch(done);
      });
  });

  test('basic bundle test (with filename)', function(done) {
      var expectedPath = "../fixtures/expected/build.js";
      var example_args = ['bundle', 'fixtures/js/final', 'build.js'];
      project(function() {
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          jspm.bundle(example_args).then(function() {
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
      var example_args = ['bundle', 'fixtures/js/final', '-', 'jquery', 'build.js'];
      var expectedPath = "../fixtures/expected/minus.js";
      project(function() {
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          jspm.bundle(example_args).then(function() {
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
      var example_args = ['bundle', 'fixtures/js/final', '+', 'ember', 'build.js'];
      var expectedPath = "../fixtures/expected/add.js";
      project(function() {
          project.registry['ember'] = 'github:ember';
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          project.versions['github:ember'] = { '1.5.1': 'mmmm' };
          jspm.bundle(example_args).then(function() {
              assert(fs.existsSync(actualPath));
              assert(fs.existsSync(expectedPath));
              var actualBuildFile = fs.readFileSync(actualPath);
              var expectedBuildFile = fs.readFileSync(expectedPath);
              assert.equal(actualBuildFile.toString(), expectedBuildFile.toString());
              done();
          }).catch(done);
      });
  });

  test('basic bundle arithmetic test (with incorrect number of args)', function(done) {
      var example_args = ['bundle', 'fixtures/js/final', '-', 'jquery', 'build.js', 'more'];
      var expectedPath = "../fixtures/expected/minus.js";
      project(function() {
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          jspm.bundle(example_args).then(function() {
              project.assertLog('warn', 'Arithmetic only supports a single operation');
              done();
          }).catch(done);
      });
  });

  test('basic bundle arithmetic test (when the last arg is not a valid js file)', function(done) {
      var example_args = ['bundle', 'fixtures/js/final', '-', 'jquery', 'buil'];
      var expectedPath = "../fixtures/expected/minus.js";
      project(function() {
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          jspm.bundle(example_args).then(function() {
              project.assertLog('warn', 'The last argument must be a valid js filename');
              done();
          }).catch(done);
      });
  });

});
