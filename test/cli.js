var fs = require('fs');

suite('Basic Project Creation', function() {

  /* test('Init', function(done) {
    project(function() {
      project.assertLog('ok', 'Verified package.json at %1%\nVerified config file at %2%');
      jspm.init().then(function() {
        assert(fs.existsSync('package.json'));
        assert(fs.existsSync('config.js'));
        project.assertLogsCalled();
        done();
      }, done);

    });
  });

  test('Direct Install', function(done) {
    project(function() {
      project.registry['jquery'] = 'github:components/jquery';
      project.versions['github:components/jquery'] = { '1.0.0': 'asdf' };
      // project.showLogs = true;
      // project.showInputs = true;

      project.assertLog('info', 'Checking versions for `1`');
      project.assertLog('info', 'Downloading `1`');
      project.assertLog('warn', 'No main entry point found for `1`');
      project.assertLog('ok');

      jspm.install('jquery').then(function() {
        project.assertLogsCalled();
        assert(fs.existsSync('package.json'));
        assert(fs.existsSync('config.js'));
        done();
      }, done);
    });
  });

  test('Pre-Cached Install', function(done) {
    project.assertLog('info', 'Checking versions for `1`');
    project.assertLog('ok', 'Already up to date - %1% (1.0.0) as `2`');

    jspm.install('jquery').then(function() {
      project.assertLogsCalled();
      done();
    }, done);
  });

  test('Forced install over cached', function(done) {
    project.showLogs = true;
    project.showInputs = true;

    jspm.install('jquery', { force: true }).then(function() {
      done();
    }, done);
  }) */

});
