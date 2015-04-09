var semver = require('../lib/semver');

suite('Semver Major and Minor Ranges', function() {

  test('Range test 1', function() {
    assert.equal(semver.match('0.0.1', '0.0.1'), true);
    assert.equal(semver.match('0.0.1', '0.0.0'), false);
    assert.equal(semver.match('0.0.1', '0.0.2'), false);
    assert.equal(semver.match('0.0.1', '0.0.1-betaasdf-asdf'), false);
  });
  test('Range test 2', function() {
    assert.equal(semver.match('0.1', '0.1.1'), true);
    assert.equal(semver.match('0.1', '0.1.4'), true);
    assert.equal(semver.match('0.1', '0.1.23423-sdf'), false);
    assert.equal(semver.match('0.1', '0.1'), false);
    assert.equal(semver.match('0.1', '1.1.1'), false);
    assert.equal(semver.match('0.1', '0.0.1'), false);
  });
  test('Range test 3', function() {
    assert.equal(semver.match('0', '0.0.1'), true);
    assert.equal(semver.match('0', '0.1.1'), true);
    assert.equal(semver.match('0', '0.1.1-beta'), false);
    assert.equal(semver.match('0', '1.1.1-beta'), false);
  });
  test('Range test 4', function() {
    assert.equal(semver.match('1', '1.5'), false);
    assert.equal(semver.match('1', '1.5.2'), true);
    assert.equal(semver.match('1', '1.0.0'), true);
    assert.equal(semver.match('1', '1.5.3-beta1'), false);
    assert.equal(semver.match('1', '2.0.0-beta1'), false);
    assert.equal(semver.match('1', '0.1.1'), false);
  });
  test('Range test 5', function() {
    assert.equal(semver.match('1.2', '1.2.0'), true);
    assert.equal(semver.match('1.2', '1.2.1'), true);
    assert.equal(semver.match('1.2', '1.2.1-beta'), false);
    assert.equal(semver.match('2.0', '2.1.0'), false);
  });
  test('Range test 6', function() {
    assert.equal(semver.match('4.3.2', '4.3.2-beta'), false);
    assert.equal(semver.match('4.3.2', '4.3.2'), true);
    assert.equal(semver.match('4.3.2', '4.3.3'), false);
  });
  test('Range test 7', function() {
    assert.equal(semver.match('4.3.2-beta4', '4.3.2-beta4'), true);
    assert.equal(semver.match('4.3.2-beta4', '4.3.2'), false);
    assert.equal(semver.match('4.3.2-beta4', 'asdfa'), false);
  });
  test('Range test 8', function() {
    assert.equal(semver.match('ksdufh8234-', 'asdfa'), false);
    assert.equal(semver.match('ksdufh8234-', 'ksdufh8234-'), true);
  });
  test('Range test 9', function() {
    assert.equal(semver.compare('0.2.0', 'master'), 1);
    assert.equal(semver.compare('wip/here/some-thing', '0.3.0-alpha'), -1);
    assert.equal(semver.compare('1.2.a', '0.0.1'), -1);
    assert.equal(semver.compare('1.2.3-beta', '1.2.3-alpha'), 1);
    assert.equal(semver.compare('1.2.3-beta.1', '1.2.3-beta.11'), -1);
    assert.equal(semver.compare('1.2.3-beta.1', '1.2.3-beta.11'), -1);
    assert.equal(semver.compare('1.2.3-beta.2', '1.2.3-beta.1'), 1);
    assert.equal(semver.compare('1.2.3', '1.2.3-beta.1'), 1);
  });
  test('Range test 10', function() {
    assert.equal(semver.compare('1.0.0-alpha', '1.0.0-alpha.1'), -1);
    assert.equal(semver.compare('1.0.0-alpha.1', '1.0.0-alpha.beta'), -1);
    assert.equal(semver.compare('1.0.0-alpha.beta', '1.0.0-beta'), -1);
    assert.equal(semver.compare('1.0.0-beta', '1.0.0-beta.2'), -1);
    assert.equal(semver.compare('1.0.0-beta.2', '1.0.0-beta.11'), -1);
    assert.equal(semver.compare('1.0.0-beta.11', '1.0.0-rc.1'), -1);
    assert.equal(semver.compare('1.0.0-rc.1', '1.0.0'), -1);
  });
});

suite('Semver Compare', function() {

  test('Compare 1', function() {
    assert.equal(semver.compare('1', '2'), -1);
    assert.equal(semver.compare('1.4.0', '1'), 1);
    assert.equal(semver.compare('1.0.1', '1.0.11'), -1);
    assert.equal(semver.compare('1.0.3', '1.2.11'), -1);
    assert.equal(semver.compare('1.2.11', '1.2.1'), 1);
    assert.equal(semver.compare('1.2.10', '1.2.1'), 1);
  });

  test('Compare 2', function() {
    assert.equal(semver.compare('2.0', '2.1.0'), -1);
  });

  test('Semver sort', function() {
    var versions = ['1.0.3', '1.0.4', '1.0.5', '1.0.6', '1.0.7', '1.0.8', '1.2.0', '1.2.1', '1.2.10', '1.2.11', '1.2.12', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.2.6', '1.2.7', '1.2.8', '1.2.9'];
    versions.sort(semver.compare);
    assert.equal(versions.pop(), '1.2.12');
  });

  test('Compare with build numbers', function() {
    assert.equal(semver.compare('0.2.0-build.2+sha.c4e21ef', '0.2.0-build.1+sha.9db70d3'), 1);
  });

});


suite('Semver Compatibility Ranges', function() {

  test('Basic compatibility', function() {
    // project.showLogs = true;
    // assert.equal(semver.match('^1.5.2', '1.4.0'), false);
    assert.equal(semver.match('^1', '1.4.0'), true);
    assert.equal(semver.match('^0.1', '0.1.0'), true);
    assert.equal(semver.match('^0.1', '0.2.0'), false);
    assert.equal(semver.match('^1.1', '1.2.0'), true);
    assert.equal(semver.match('^1.1', '1.1.0'), true);
    assert.equal(semver.match('^0.0.2', '1.0.2'), false);
    assert.equal(semver.match('^0.0.1', '0.0.1'), true);
    assert.equal(semver.match('^0.0.1', '0.0.2'), false);
    assert.equal(semver.match('^0.0.1', '1.0.2'), false);
    assert.equal(semver.match('^0.0.1', '1.0.1'), false);
    assert.equal(semver.match('^0.1.0', '0.1.0'), true);
    assert.equal(semver.match('^0.1.0', '0.2.0'), false);
    assert.equal(semver.match('^0.1.0', '1.1.0'), false);
    assert.equal(semver.match('1.0.0-beta.13', '1.0.0-beta.5b'), false);
  });

  test('Semver compatibility', function() {
    assert.equal(semver.match('^1.1.12', '1.1.12'), true);
    assert.equal(semver.match('^1.1.12', '1.1.11'), false);
    assert.equal(semver.match('^1.1.12', '1.1.345'), true);
    assert.equal(semver.match('^1.1.12', '1.10.345'), true);
    assert.equal(semver.match('^1.1.12', '2.10.345'), false);
  });

  test('Prerelease ranges', function() {
    assert.equal(semver.match('^1.0.4-alpha.1', '1.0.4-alpha.1'), true);
    assert.equal(semver.match('^1.0.4-alpha.1', '1.0.4-alpha.2'), true);
    assert.equal(semver.match('^1.0.4-alpha.1', '1.0.4-beta'), true);
    assert.equal(semver.match('^1.0.4-alpha.1', '1.0.4-beta.10'), true);
    assert.equal(semver.match('^1.0.4-alpha.1', '1.0.4'), true);
  });

});

suite('Fuzzy Compatibility Ranges', function() {

  test('Basic compatibility', function() {
    // project.showLogs = true;
    // assert.equal(semver.match('^1.5.2', '1.4.0'), false);
    assert.equal(semver.match('~0', '0.1.0'), true);
    assert.equal(semver.match('~0', '1.2.0'), false);
    assert.equal(semver.match('~1', '1.2.0'), true);
    assert.equal(semver.match('~1', '2.4.0'), false);
    assert.equal(semver.match('~0.1', '0.1.0'), true);
    assert.equal(semver.match('~0.1', '0.2.0'), false);
    assert.equal(semver.match('~1.1', '1.2.0'), false);
    assert.equal(semver.match('~1.1', '1.1.0'), true);
    assert.equal(semver.match('~0.0.2', '1.0.2'), false);
    assert.equal(semver.match('~0.0.1', '0.0.1'), true);
    assert.equal(semver.match('~0.0.1', '0.0.2'), true);
    assert.equal(semver.match('~0.0.1', '1.0.2'), false);
    assert.equal(semver.match('~0.0.1', '1.0.1'), false);
    assert.equal(semver.match('~0.1.0', '0.1.0'), true);
    assert.equal(semver.match('~0.1.0', '0.2.0'), false);
    assert.equal(semver.match('~0.1.0', '1.1.0'), false);
  });

  test('Semver compatibility', function() {
    assert.equal(semver.match('~1.1.12', '1.1.12'), true);
    assert.equal(semver.match('~1.1.12', '1.1.11'), false);
    assert.equal(semver.match('~1.1.12', '1.1.345'), true);
    assert.equal(semver.match('~1.1.12', '1.10.345'), false);
    assert.equal(semver.match('~1.1.12', '2.10.345'), false);
  });

  test('Prerelease ranges', function() {
    assert.equal(semver.match('~1.0.4-alpha.1', '1.0.4-alpha.1'), true);
    assert.equal(semver.match('~1.0.4-alpha.1', '1.0.4-alpha.2'), true);
    assert.equal(semver.match('~1.0.4-alpha.1', '1.0.4-beta'), true);
    assert.equal(semver.match('~1.0.4-alpha.1', '1.0.4-beta.10'), true);
    assert.equal(semver.match('~1.0.4-alpha.1', '1.0.4'), true);
  });

});
