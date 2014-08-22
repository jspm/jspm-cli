var config = require('../lib/config');

suite('Configuration Dependency Parsing', function() {

  test('NPM 1', function() {
    var deps = config.parseDependencies({
      three: '0.x.x'
    }, 'npm');
    assert.equal(deps['three'], 'npm:three@0');

    deps = config.parseDependencies({
      three: '0.0.x'
    }, 'npm');
    assert.equal(deps['three'], 'npm:three@0.0');

    deps = config.parseDependencies({
      react: '>=0.9'
    }, 'npm');
    assert.equal(deps['react'], 'npm:react@0')

    deps = config.parseDependencies({
      inherits: '^2.0.1'
    }, 'npm');
    assert.equal(deps['inherits'], 'npm:inherits@^2.0.1');

    deps = config.parseDependencies({
      'base-64': '^0.0.4'
    }, 'npm');
    assert.equal(deps['base-64'], 'npm:base-64@0.0');
  });
  
});
