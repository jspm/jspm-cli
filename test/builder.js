var api = require('../api');
var builder = new api.Builder();

api.setPackagePath('testlibs');

suite('Build API', function() {

  test('Simple build API call', function(done) {
    builder.build('[unit/build/*]')
    .then(function(output) {
      assert(output.source.match(/\s*System\.register/));
    })
    .then(done, done);
  });

});