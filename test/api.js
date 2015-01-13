var api = require('../api');

api.setPackagePath('testlibs');

suite('API Calls', function() {
  test('Normalize', function(done) {
    api.normalize('jquery').then(function(normalized) {
      assert(normalized == 'github:components/jquery@2.1.3');
      done();
    }, done);
  });

  test('Import', function(done) {
    api.install('text', '^0.0.2')
    .then(function() {
      api.import('text').then(function(text) {
        assert(text.translate);
        done();
      }, done);
    }, done);
  });
});


