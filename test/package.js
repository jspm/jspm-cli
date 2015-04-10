var package = require('../lib/package');

suite('getVersionMatch', function() {
  suite('resolving latest', function() {
    test('Favours release over prerelease', function() {
      var versions = {
        'master': {},
        '2.0.0': {},
        '2.0.1-alpha.1': {},
        '2.0.1-alpha.2': {},
        'experimental': {}
      };
      assert.equal('2.0.0', package.getVersionMatch('', versions).version);
    });
    test('Resolves to prereleases if explictly marked stable', function() {
      var versions = {
        'master': {},
        '2.0.0': {},
        '2.0.1-alpha.1': {stable: true},
        '2.0.1-alpha.2': {},
        'experimental': {}
      };
      assert.equal('2.0.1-alpha.1', package.getVersionMatch('', versions).version);
    });
    test('Favours prerelease over master', function() {
      var versions = {
        'master': {},
        '2.0.1-alpha.1': {},
        '2.0.1-alpha.2': {},
        'experimental': {}
      };
      assert.equal('2.0.1-alpha.2', package.getVersionMatch('', versions).version);
    });
    test('Favours master over regular tags', function() {
      var versions = {
        'master': {},
        'experimental': {}
      };
      assert.equal('master', package.getVersionMatch('', versions).version);
    });
  });
});

suite('Process Dependencies', function() {
  var processDeps = package.processDeps;

  function serialize(packages) {
    var out = {};
    Object.keys(packages).forEach(function(p) {
      out[p] = packages[p].exactName;
    });
    return out;
  }

  test('Dependencies dont need a registry', function() {
    assert.deepEqual(serialize(processDeps({ 'jquery': '1' })), { 'jquery': 'jspm:jquery@1' });
  });

  test('No target', function() {
    assert.deepEqual(serialize(processDeps({ 'jquery': '' }, 'custom')), { jquery: 'custom:jquery' });
  });

  test('True target', function() {
    assert.deepEqual(serialize(processDeps({ 'jquery': true }, 'custom')), { jquery: 'custom:jquery' });
  });

  test('Wildcard version gets removed', function() {
    assert.deepEqual(serialize(processDeps({ 'jquery': '*' }, 'custom')), { jquery: 'custom:jquery' });
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

  test('Exact name target with just a version empty target', function() {
    assert.deepEqual(serialize(processDeps({ 'github:components/jquery': '' }, 'custom')), { 'github:components/jquery': 'github:components/jquery' });
  });

  test('Exact name target with a version', function() {
    assert.deepEqual(serialize(processDeps({ 'github:components/jquery@0': '1@1' }, 'custom')), { 'github:components/jquery@0': 'custom:1@1' });
  });

  test('Exact name with a version empty target', function() {
    assert.deepEqual(serialize(processDeps({ 'github:components/jquery@0': '' }, 'custom')), { 'github:components/jquery@0': 'github:components/jquery@0' });
  });

  test('Exact name with a true target', function() {
    assert.deepEqual(serialize(processDeps({ 'github:components/jquery@0': true }, 'custom')), { 'github:components/jquery@0': 'github:components/jquery@0' });
  });

  test('Exact name target with an endpoint', function() {
    assert.deepEqual(serialize(processDeps({ 'github:components/jquery': '1:1' }, 'custom')), { 'github:components/jquery': '1:1' });
  });

  test('Versioned name no target', function() {
    assert.deepEqual(serialize(processDeps({ 'jquery@5': true }, 'custom')), { 'jquery@5': 'custom:jquery@5' });
  });

  test('Versioned name wildcard target', function() {
    assert.deepEqual(serialize(processDeps({ 'jquery@5': '*' }, 'custom')), { 'jquery@5': 'custom:jquery@5' });
  });

  test('Wildcard versioned name', function() {
    assert.deepEqual(serialize(processDeps({ 'jquery@*': '*' }, 'custom')), { 'jquery@*': 'custom:jquery' });
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

  test('processDeps convergence', function() {
    assert.deepEqual(serialize(processDeps(processDeps({ 'test': '1.2.3' }, 'npm'), 'npm')), { 'test': 'npm:test@1.2.3' });
  });
});
