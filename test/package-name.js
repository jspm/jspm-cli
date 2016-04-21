var PackageName = require('../lib/package-name.js');

suite('Package Name', function() {
  test('Basic Package Name', function() {
    var pkg = new PackageName('github:components/jquery@1.2.3');
    
    assert.equal(pkg.name, 'github:components/jquery');
    assert.equal(pkg.version, '1.2.3');
    assert.equal(pkg.registry, 'github');
    assert.equal(pkg.package, 'components/jquery');
    assert.equal(pkg.exactName, 'github:components/jquery@1.2.3');
    assert.equal(pkg.exactPackage, 'components/jquery@1.2.3');
    assert.equal(pkg.toString(), 'github:components/jquery@1.2.3');
  });

  test('Package name escaping', function() {
    // not already escaped
    var pkg = new PackageName('custom:dep@a/b');
    assert.equal(pkg.version, 'a/b');
    assert.equal(pkg.registry, 'custom');
    assert.equal(pkg.toString(), 'custom:dep@a%2Fb');

    // already escaped
    pkg = new PackageName('custom:dep@a%2Fb', true);
    assert.equal(pkg.version, 'a/b');
    assert.equal(pkg.registry, 'custom');
    assert.equal(pkg.toString(), 'custom:dep@a%2Fb');
  });

  test('Package name custom mappings', function() {
    // custom package subpaths treated as exceptions (not packages anymore -> no registry)
    var pkg = new PackageName('custom:pkg@v/subpath', true);
    assert.equal(pkg.registry, '');
    assert.equal(pkg.toString(), 'custom:pkg@v/subpath');

    // urls treated as custom paths too
    pkg = new PackageName('https://custom/path', true);
    assert.equal(pkg.registry, '');
    assert.equal(pkg.toString(), 'https://custom/path');

    // and plain maps with not :
    pkg = new PackageName('./custom/path/map@123', true);
    assert.equal(pkg.registry, '');
    assert.equal(pkg.version, undefined);
    assert.equal(pkg.toString(), './custom/path/map@123');
  });
});