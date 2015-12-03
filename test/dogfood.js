var api = require('../api');

api.setPackagePath('testlibs');

var dfApi;

suite('API tests', function() {

  before(function(done) {
    api.setPackagePath('testlibs');

    // import jspm as a jspm dependency itself
    return api.import('jspm')
    .then(function(dogFoodApi) {
      dfApi = dogFoodApi;

      dfApi.setPackagePath('testlibs');
    })
    .then(done, done);
  });

  test('version', function() {
    assert(dfApi.version.match(/\d+\.\d+\.\d+(-[^\.]+)?/));
  });

  test('Normalize', function(done) {
    var loader = new dfApi.Loader();

    return loader.normalize('jquery')
    .then(function(normalized) {
      assert(normalized === loader.baseURL + 'jspm_packages/github/components/jquery@2.1.4/jquery.js');
      done();
    })
    .catch(done);
  });

  test('Build', function(done) {
    var builder = new dfApi.Builder();

    return builder.bundle('jquery')
    .then(function(output) {
      assert(output.source);
      done();
    })
    .catch(done);
  });
});