var api = require('../api');

api.setPackagePath('test/fixtures/builder');

var builder = new api.Builder();

suite('Build API', function() {

  test('Simple build API call', function(done) {
    builder.build('test')
    .then(function(output) {
      assert(output.source.match(/\s*"format register";\s*/));
    })
    .then(done, done);
  });

});