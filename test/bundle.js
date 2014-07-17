var fs = require('fs');

suite('Bundle Tests', function() {

  var actualPath = "build.js";

  test('basic bundle test', function(done) {
      var expectedPath = "../fixtures/expected/build.js";
      var exampleArgs = 'bundle fixtures/js/final';
      project(function() {
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          jspm.bundle(exampleArgs, 'build.js').then(function() {
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
      var exampleArgs = 'bundle fixtures/js/final - jquery';
      var expectedPath = "../fixtures/expected/minus.js";
      project(function() {
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          jspm.bundle(exampleArgs, 'build.js').then(function() {
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
      var exampleArgs = 'bundle fixtures/js/final + ember';
      var expectedPath = "../fixtures/expected/add.js";
      project(function() {
          project.registry['ember'] = 'github:ember';
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          project.versions['github:ember'] = { '1.5.1': 'mmmm' };
          jspm.bundle(exampleArgs, 'build.js').then(function() {
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
      var exampleArgs = 'bundle fixtures/js/final + ember - jquery';
      var expectedPath = "../fixtures/expected/multiple.js";
      project(function() {
          project.registry['ember'] = 'github:ember';
          project.registry['react'] = 'npm:react';
          project.registry['jquery'] = 'github:components/jquery';
          project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
          project.versions['npm:react'] = { '0.10.0': 'asdz' };
          project.versions['github:ember'] = { '1.5.1': 'mmmm' };
          jspm.bundle(exampleArgs, 'build.js').then(function() {
              assert(fs.existsSync(actualPath));
              assert(fs.existsSync(expectedPath));
              var actualBuildFile = fs.readFileSync(actualPath);
              var expectedBuildFile = fs.readFileSync(expectedPath);
              assert.equal(actualBuildFile.toString(), expectedBuildFile.toString());
              done();
          }).catch(done);
      });
  });

});
