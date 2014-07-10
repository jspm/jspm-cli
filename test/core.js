var fs = require('fs');

suite('Basic Core Tests', function() {

  var actualPath = "build.js";

  test('basic bundle test', function(done) {
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

  // test('simple bundle minus test', function(done) {
  //     var example_args = ['bundle', 'fixtures/js/final', '-', 'jquery', 'build.js'];
  //     var expectedPath = "../fixtures/expected/minus.js";
  //     project(function() {
  //         project.registry['react'] = 'npm:react';
  //         project.registry['jquery'] = 'github:components/jquery';
  //         project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
  //         project.versions['npm:react'] = { '0.10.0': 'asdz' };
  //         jspm.bundle(example_args).then(function() {
  //             assert(fs.existsSync(actualPath));
  //             assert(fs.existsSync(expectedPath));
  //             var actualBuildFile = fs.readFileSync(actualPath);
  //             var expectedBuildFile = fs.readFileSync(expectedPath);
  //             assert.equal(actualBuildFile.toString(), expectedBuildFile.toString());
  //             done();
  //         }).catch(done);
  //     });
  // });
});
