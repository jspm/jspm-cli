var api = require('../api');

api.setPackagePath('testlibs');
var builder = new api.Builder();

suite('Build API', function() {

  test('Simple build API call', function(done) {
    builder.bundle('[unit/build/*]')
    .then(function(output) {
      assert(output.source.match(/\s*System\.register/));
    })
    .then(done, done);
  });

});