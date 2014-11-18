var api = require('../api');

api.setPackagePath('testlibs');

suite('API Calls', function() {
  test('Normalize', function(done) {
    api.normalize('jquery').then(function(normalized) {
      assert(normalized == 'github:components/jquery@2.1.1');
      done();
    }, done);
  });
});


