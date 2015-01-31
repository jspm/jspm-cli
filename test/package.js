var package = require('../lib/package');

suite('Process Dependencies', function() {
  var processDeps = package.processDeps;

  function serialize(packages) {
    var out = {};
    Object.keys(packages).forEach(function(p) {
      out[p] = packages[p].exactName;
    });
    return out;
  }

  test('Dependencies need a registry', function() {
    assert.deepEqual(processDeps({ 'jquery': '1' }), {});
  });

  test('Target without endpoint and version is a version', function() {
    assert.deepEqual(serialize(processDeps({ 'jquery': '1' }, 'custom')), { jquery: 'custom:jquery@1' });
  });

  test('Target with just a version', function() {
    assert.deepEqual(serialize(processDeps({ 'jquery': '1@1' }, 'custom')), { jquery: 'custom:1@1' });
  });

  test('Target with just an endpoint', function() {
    assert.deepEqual(serialize(processDeps({ 'jquery': 'github:components/jquery' }, 'custom')), { jquery: 'github:components/jquery' });
  });

  test('Target with an endpoint and version', function() {
    assert.deepEqual(serialize(processDeps({ 'jquery': 'github:components/jquery@1' }, 'custom')), { jquery: 'github:components/jquery@1' });
  });

  test('Exact name target with just a version', function() {
    assert.deepEqual(serialize(processDeps({ 'github:components/jquery': '1' }, 'custom')), { 'github:components/jquery': 'github:components/jquery@1' });
  });

  test('Exact name target with a version', function() {
    assert.deepEqual(serialize(processDeps({ 'github:components/jquery@0': '1@1' }, 'custom')), { 'github:components/jquery@0': 'custom:1@1' });
  });

  test('Exact name target with an endpoint', function() {
    assert.deepEqual(serialize(processDeps({ 'github:components/jquery': '1:1' }, 'custom')), { 'github:components/jquery': '1:1' });
  });

  test('Scoped package', function() {
    assert.deepEqual(serialize(processDeps({ 'test': '@scoped/package' }, 'npm')), { 'test': 'npm:@scoped/package' });
  });

  test('Scoped package to version', function() {
    assert.deepEqual(serialize(processDeps({ '@scoped/package': '1.2.3' }, 'npm')), { '@scoped/package': 'npm:@scoped/package@1.2.3' });
  });

  test('Scoped package with version', function() {
    assert.deepEqual(serialize(processDeps({ 'test': '@scoped/package@1.2.3' }, 'npm')), { 'test': 'npm:@scoped/package@1.2.3' });
  });

  test('Scoped package with endpoint', function() {
    assert.deepEqual(serialize(processDeps({ 'test': 'npm:@scoped/package@1.2.3' }, 'custom')), { 'test': 'npm:@scoped/package@1.2.3' });
  });
});


