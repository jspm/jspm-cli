var semver = require('../lib/semver');

suite('Semver Major and Minor Ranges', function() {

  test('Range test 1', function() {
    assert.equal(semver.match('0.0.1', '0.0.1'), true);
    assert.equal(semver.match('0.0.1', '0.0.0'), false);
    assert.equal(semver.match('0.0.1', '0.0.2'), false);
    assert.equal(semver.match('0.0.1', '0.0.1-betaasdf-asdf'), true);
  });
  test('Range test 2', function() {
    assert.equal(semver.match('0.1', '0.1.1'), true);
    assert.equal(semver.match('0.1', '0.1.4'), true);
    assert.equal(semver.match('0.1', '0.1.23423-sdf'), true);
    assert.equal(semver.match('0.1', '0.1'), true);
    assert.equal(semver.match('0.1', '1.1.1'), false);
    assert.equal(semver.match('0.1', '0.0.1'), false);
  });
  test('Range test 3', function() {
    assert.equal(semver.match('0', '0.0.1'), true);
    assert.equal(semver.match('0', '0.1.1'), true);
    assert.equal(semver.match('0', '0.1.1-beta'), true);
    assert.equal(semver.match('0', '1.1.1-beta'), false);
  });
  test('Range test 4', function() {
    assert.equal(semver.match('1', '1.5'), true);
    assert.equal(semver.match('1', '1.5.2'), true);
    assert.equal(semver.match('1', '1.0.0'), true);
    assert.equal(semver.match('1', '1.5.3-beta1'), true);
    assert.equal(semver.match('1', '2.0.0-beta1'), false);
    assert.equal(semver.match('1', '0.1.1'), false);
  });
  test('Range test 5', function() {
    assert.equal(semver.match('1.2', '1.2.0'), true);
    assert.equal(semver.match('1.2', '1.2.1'), true);
    assert.equal(semver.match('1.2', '1.2.1-beta'), true);
  });
  test('Range test 6', function() {
    assert.equal(semver.match('4.3.2', '4.3.2-beta'), true);
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
});

suite('Semver Compare', function() {

  test('Compare 1', function() {
    assert.equal(semver.compare('1', '2'), -1);
    assert.equal(semver.compare('1.4.0', '1'), -1);
    assert.equal(semver.compare('1.0.1', '1.0.11'), -1);
    assert.equal(semver.compare('1.0.3', '1.2.11'), -1);
    assert.equal(semver.compare('1.2.11', '1.2.1'), 1);
    assert.equal(semver.compare('1.2.10', '1.2.1'), 1);
  });

  test('Semver sort', function() {
    var versions = ['1.0.3', '1.0.4', '1.0.5', '1.0.6', '1.0.7', '1.0.8', '1.2.0', '1.2.1', '1.2.10', '1.2.11', '1.2.12', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.2.6', '1.2.7', '1.2.8', '1.2.9'];
    versions.sort(semver.compare);
    assert.equal(versions.pop(), '1.2.12');
  });

});


suite('Semver Compatibility Ranges', function() {
  
  test('Basic compatibility', function() {
    // project.showLogs = true;
    // assert.equal(semver.match('^1.5.2', '1.4.0'), false);
    assert.equal(semver.match('^1', '1.4.0'), true);
  });

  test('Semver compatibility', function() {
    assert.equal(semver.match('^1.1.12', '1.1.12'), true);
    assert.equal(semver.match('^1.1.12', '1.1.11'), false);
    assert.equal(semver.match('^1.1.12', '1.1.345'), true);
    assert.equal(semver.match('^1.1.12', '1.10.345'), true);
    assert.equal(semver.match('^1.1.12', '2.10.345'), false);
  });

});
