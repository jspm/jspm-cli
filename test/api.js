var api = require('../api');

api.setPackagePath('testlibs');

suite('API Calls', function() {
  test('Normalize', function(done) {
    api.normalize('jquery').then(function(normalized) {
      assert(normalized === System.baseURL + 'jspm_packages/github/components/jquery@2.1.3.js');
      done();
    })
    .catch(done);
  });

  test('Import', function(done) {
    api.dlLoader()
    .then(function() {
      return api.install('text', '^0.0.2');
    })
    .then(function() {
      return api.import('text').then(function(text) {
        assert(text.translate);
        done();
      });
    })
    .catch(done);
  });
});
