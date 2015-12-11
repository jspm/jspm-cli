var fs = require('fs');
var path = require('path');
var child_process = require('child_process');

var fakeHomePath = path.resolve('./test/fixtures/global-config/');
var fakeConfigFile = path.resolve(fakeHomePath, '.jspm/config');
var defaultConfigFile = path.resolve(fakeHomePath, 'expected/default.json');
var combinedConfigFile = path.resolve(fakeHomePath, 'expected/combined.json');

suite('global-config', function () {

  test('should be able to run concurrent processes', function (done) {
    resetConfigFile();
    // we'll fake the HOME path for these child processes,
    // so that global-config.js will look in ./fixtures/.jspm/config
    // instead of mucking with the real config file
    var original = fs.readFileSync(fakeConfigFile).toString();

    // we'll make 20 parallel processes
    var child = require.resolve('../lib/global-config');
    for (var i = 0; i < 20; i++) {
      child_process.spawn(process.execPath, [child], {env: {HOME: fakeHomePath}})
        .on('exit', onExit);
    }

    // we'll wait until all of the processes exit with this function. once
    // `exits` is `20`, we know all processes have exited, and we can assert
    var exits = 0;
    function onExit() {
      exits++;
      if (exits === 20) {
        // make sure that it is still our original file, and that
        // hasn't been overwritten with the jspm default config
        var actual = fs.readFileSync(fakeConfigFile).toString();
        var expected = fs.readFileSync(combinedConfigFile).toString().replace(/\n$/, '');

        assert.equal(actual, expected);
        done();
      }
    }

  });

  test('should create a new file if one does not exist', function (done) {
    fs.unlinkSync(fakeConfigFile);
    var child = require.resolve('../lib/global-config');
    child_process.spawn(process.execPath, [child], {env: {HOME: fakeHomePath}})
      .on('exit', function () {
        var actual = fs.readFileSync(fakeConfigFile).toString();
        var expected = fs.readFileSync(defaultConfigFile).toString().replace(/\n$/, '');

        assert.equal(actual, expected);
        done();
      });
  });

  test('should create the directory if it does not exist', function (done) {
    fs.unlinkSync(fakeConfigFile);
    fs.rmdir(path.join(fakeHomePath, '.jspm'));

    var child = require.resolve('../lib/global-config');
    child_process.spawn(process.execPath, [child], {env: {HOME: fakeHomePath}})
      .on('exit', function () {
        var actual = fs.readFileSync(fakeConfigFile).toString();
        var expected = fs.readFileSync(defaultConfigFile).toString().replace(/\n$/, '');

        assert.equal(actual, expected);
        done();
      });
  });

  after(resetConfigFile);

});

/**
 * rewrites our fake config file with the default JSON
 */
function resetConfigFile() {
  fs.writeFileSync(fakeConfigFile, JSON.stringify({
    defaultTranspiler: 'babel',
    defaultRegistry: 'jspm',
    strictSSL: true,
    registries: {
      test: {
        handler: 'dont-overwrite-me'
      },
      github: {
        auth: 'dont-overwrite-me'
      }
    }
  }, null, '  '));
}
