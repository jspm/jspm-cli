var fs = require('fs');
var path = require('path');

var GlobalConfig = require('../lib/config/global-config').constructor;

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

    for (var i = 0; i < 20; i++)
      new GlobalConfig(fakeHomePath);

    // make sure that it is still our original file, and that
    // hasn't been overwritten with the jspm default config
    var actual = fs.readFileSync(fakeConfigFile).toString().replace(/\r/g, '');
    var expected = fs.readFileSync(combinedConfigFile).toString().replace(/\n$/, '');

    assert.equal(actual.trim(), expected.trim());
    done();
  });

  test('should create a new file if one does not exist', function (done) {
    fs.unlinkSync(fakeConfigFile);
    new GlobalConfig(fakeHomePath);
    var actual = fs.readFileSync(fakeConfigFile).toString().replace(/\r/g, '');
    var expected = fs.readFileSync(defaultConfigFile).toString().replace(/\n$/, '');

    assert.equal(actual.trim(), expected.trim());
    done();
  });

  test('should create the directory if it does not exist', function (done) {
    fs.unlinkSync(fakeConfigFile);
    fs.rmdir(path.join(fakeHomePath, '.jspm'));

    new GlobalConfig(fakeHomePath);
    var actual = fs.readFileSync(fakeConfigFile).toString().replace(/\r/g, '');
    var expected = fs.readFileSync(defaultConfigFile).toString().replace(/\n$/, '');

    assert.equal(actual.trim(), expected.trim());
    done();
  });

  test('should set a non-string value', function (done) {
    resetConfigFile();
    var globalConfig = new GlobalConfig(fakeHomePath);
    globalConfig.config.strictSSL = false;
    globalConfig.save();
    var actual = JSON.parse(fs.readFileSync(fakeConfigFile).toString());
    assert.equal(actual.strictSSL, false);
    done();
  });

  test('should set a number value', function (done) {
    resetConfigFile();
    var globalConfig = new GlobalConfig(fakeHomePath);
    globalConfig.config.registries.github.maxRepoSize = 10;
    globalConfig.save();
    var actual = JSON.parse(fs.readFileSync(fakeConfigFile).toString());
    assert.equal(actual.registries.github.maxRepoSize, 10);
    done();
  });

  test('should set a string value', function (done) {
    resetConfigFile();
    var globalConfig = new GlobalConfig(fakeHomePath);
    globalConfig.config.defaultTranspiler = 'traceur';
    globalConfig.save();
    var actual = JSON.parse(fs.readFileSync(fakeConfigFile).toString());
    assert.equal(actual.defaultTranspiler, 'traceur');
    done();
  });

  after(resetConfigFile);

});

/**
 * rewrites our fake config file with the default JSON
 */
function resetConfigFile() {
  fs.writeFileSync(fakeConfigFile, JSON.stringify({
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
