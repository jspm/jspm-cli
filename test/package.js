var package = require('../lib/package');
var common = require('../lib/common');

suite('getVersionMatch', function() {
  suite('regular operation', function() {
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
    test('Favours prerelease over tags', function() {
      var versions = {
        '2.0.1-alpha.1': {},
        'super-cool': {stable: true},
        'sketchy': {}
      };
      assert.equal('2.0.1-alpha.1', package.getVersionMatch('', versions).version);
    });
    test('Favours master over regular tags', function() {
      var versions = {
        'master': {},
        'experimental': {}
      };
      assert.equal('master', package.getVersionMatch('', versions).version);
    });
    test('Favours stable tags over master', function() {
      var versions = {
        'master': {},
        'experimental': {stable: true},
        'alpha': {}
      };
      assert.equal('experimental', package.getVersionMatch('', versions).version);
    });
    test('Favours stable tags alphabetically', function() {
      var versions = {
        'a': {},
        'c': {stable: true},
        'b': {stable: true}
      };
      assert.equal('b', package.getVersionMatch('', versions).version);
    });
    test('Favours unstable tags alphabetically', function() {
      var versions = {
        'b': {},
        'a': {},
        'c': {}
      };
      assert.equal('a', package.getVersionMatch('', versions).version);
    });
    test('Satisfies range A', function() {
      var versions = {
        'master': {},
        '2.0.0': {},
        '2.0.1-alpha.1': {},
        '2.0.1-alpha.2': {},
        'experimental': {}
      };
      var opts = {latestVersion: 'master'};
      assert.equal('2.0.1-alpha.2', package.getVersionMatch('^2.0.1-0', versions, opts).version);
    });
    test('Satisfies range B', function() {
      var versions = {
        'master': {},
        '2.0.0': {},
        '2.0.1-alpha.1': {},
        '2.0.1-alpha.2': {},
        'experimental': {}
      };
      var opts = {latestVersion: 'master'};
      assert.equal(undefined, package.getVersionMatch('^2.0.1', versions, opts));
    });
    test('Favours latestVersion always if no range provided', function() {
      var versions = {
        'master': {},
        '2.0.0': {},
        '2.0.1-alpha.1': {},
        'schwarzwälder-kirschtorte': {stable: false}
      };
      var opts = {latestVersion: 'schwarzwälder-kirschtorte'};
      assert.equal('schwarzwälder-kirschtorte', package.getVersionMatch('', versions, opts).version);
    });
  });

  suite('--edge', function() {
    test('Favours semver releases on cardinality only', function() {
      var versions = {
        'master': {},
        '2.0.0': {},
        '2.0.1-alpha.1': {},
        '2.0.1-alpha.2': {},
        'experimental': {}
      };
      var opts = {edge: true};
      assert.equal('2.0.1-alpha.2', package.getVersionMatch('', versions, opts).version);
    });
    test('Resolves to prereleases regardless of explicit stable', function() {
      var versions = {
        'master': {},
        '2.0.0': {},
        '2.0.1-alpha.1': {stable: true},
        '2.0.1-alpha.2': {},
        'experimental': {}
      };
      var opts = {edge: true};
      assert.equal('2.0.1-alpha.2', package.getVersionMatch('', versions, opts).version);
    });
    test('Favours prerelease over master', function() {
      var versions = {
        'master': {},
        '2.0.1-alpha.1': {},
        '2.0.1-alpha.2': {},
        'experimental': {}
      };
      var opts = {edge: true};
      assert.equal('2.0.1-alpha.2', package.getVersionMatch('', versions, opts).version);
    });
    test('Favours prerelease over tags', function() {
      var versions = {
        '2.0.1-alpha.1': {},
        'super-cool': {stable: true},
        'sketchy': {}
      };
      var opts = {edge: true};
      assert.equal('2.0.1-alpha.1', package.getVersionMatch('', versions, opts).version);
    });
    test('Favours master over regular tags', function() {
      var versions = {
        'master': {},
        'experimental': {}
      };
      var opts = {edge: true};
      assert.equal('master', package.getVersionMatch('', versions, opts).version);
    });
    test('Favours master over other tags', function() {
      var versions = {
        'master': {},
        'experimental': {stable: true},
        'alpha': {}
      };
      var opts = {edge: true};
      assert.equal('master', package.getVersionMatch('', versions, opts).version);
    });
    test('Favours tags alphabetically A', function() {
      var versions = {
        'a': {},
        'c': {stable: true},
        'b': {stable: true}
      };
      var opts = {edge: true};
      assert.equal('a', package.getVersionMatch('', versions, opts).version);
    });
    test('Favours tags alphabetically B', function() {
      var versions = {
        'b': {},
        'a': {},
        'c': {}
      };
      var opts = {edge: true};
      assert.equal('a', package.getVersionMatch('', versions, opts).version);
    });
    test('Satisfies range A', function() {
      var versions = {
        'master': {},
        '2.0.0': {},
        '2.0.1-alpha.1': {},
        '2.0.1-alpha.2': {},
        'experimental': {}
      };
      var opts = {edge: true, latestVersion: 'master'};
      assert.equal('2.0.1-alpha.2', package.getVersionMatch('^2.0.1-0', versions, opts).version);
    });
    test('Satisfies range B', function() {
      var versions = {
        'master': {},
        '2.0.0': {},
        '2.0.1-alpha.1': {},
        '2.0.1-alpha.2': {},
        'experimental': {}
      };
      var opts = {edge: true, latestVersion: 'master'};
      assert.equal('2.0.1-alpha.2', package.getVersionMatch('^2.0.1', versions, opts).version);
    });
    test('Satisfies range C', function() {
      var versions = {
        'master': {},
        '2.0.0': {},
        '2.0.1': {},
        '2.0.2-alpha.1': {},
        'experimental': {}
      };
      var opts = {edge: true, latestVersion: 'master'};
      assert.equal('2.0.2-alpha.1', package.getVersionMatch('^2.0.1', versions, opts).version);
    });
    test('Satisfies range D', function() {
      var versions = {
        'master': {},
        '2.0.0': {},
        '2.0.1': {},
        '2.0.2-alpha.1': {},
        'experimental': {}
      };
      var opts = {edge: true, latestVersion: 'master'};
      assert.equal(undefined, package.getVersionMatch('^2.0.3', versions, opts));
    });
    test('Favours semver over latestVersion if no range provided', function() {
      var versions = {
        'master': {},
        '2.0.0': {},
        '2.0.1-alpha.1': {},
        'schwarzwälder-kirschtorte': {stable: false}
      };
      var opts = {edge: true, latestVersion: 'schwarzwälder-kirschtorte'};
      assert.equal('2.0.1-alpha.1', package.getVersionMatch('', versions, opts).version);
    });
    test('Favours latestVersion over exact if no range provided', function() {
      var versions = {
        'master': {},
        'schwarzwälder-kirschtorte': {stable: false}
      };
      var opts = {edge: true, latestVersion: 'schwarzwälder-kirschtorte'};
      assert.equal('schwarzwälder-kirschtorte', package.getVersionMatch('', versions, opts).version);
    });
  });
});

suite('Process Dependencies', function() {
  var processDeps = common.processDeps;

  function serialize(packages) {
    var out = {};
    Object.keys(packages).forEach(function(p) {
      out[p] = packages[p].exactName;
    });
    return out;
  }

  test('Escaping versions', function() {
    assert.deepEqual(serialize(processDeps({ 'jquery': 'some/version' }, 'jspm')), { 'jquery': 'jspm:jquery@some/version' });
  });

  test('No target', function() {
    assert.deepEqual(serialize(processDeps({ 'jquery': '' }, 'custom')), { jquery: 'custom:jquery' });
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

  test('Exact name target with a version', function() {
    assert.deepEqual(serialize(processDeps({ 'github:components/jquery@0': '1@1' }, 'custom')), { 'github:components/jquery@0': 'custom:1@1' });
  });

  test('Exact name target with an endpoint', function() {
    assert.deepEqual(serialize(processDeps({ 'github:components/jquery': '1:1' }, 'custom')), { 'github:components/jquery': '1:1' });
  });

  test('Versioned name no target', function() {
    assert.deepEqual(serialize(processDeps({ 'jquery@5': '' }, 'custom')), { 'jquery@5': 'custom:jquery@5' });
  });

  test('Versioned name wildcard target', function() {
    assert.deepEqual(serialize(processDeps({ 'jquery@5': '*' }, 'custom')), { 'jquery@5': 'custom:jquery@5' });
  });

  test('Scoped package', function() {
    assert.deepEqual(serialize(processDeps({ 'test': 'npm:@scoped/package' }, 'custom')), { 'test': 'npm:@scoped/package' });
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
