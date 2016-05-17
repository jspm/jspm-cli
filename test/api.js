var api = require('../api');
var fs = require('fs');
var common = require('../lib/common');
var path = require('path');

api.setPackagePath('testlibs');

suite('API tests', function() {

  test('version', function() {
    assert(api.version.match(/\d+\.\d+\.\d+(-[^\.]+)?/));
  });

  test('Normalize', function(done) {
    return api.normalize('jquery')
    .then(function(normalized) {
      assert(normalized === common.toFileURL(path.resolve('testlibs') + '/jspm_packages/github/components/jquery@2.1.4/jquery.js'));
    })
    .then(done, done);

  });

  test('Import', function(done) {
    api.dlLoader()
    .then(function() {
      return api.import('text').then(function(text) {
        assert(text.translate);
      });
    })
    .then(done, done);

  });

  test('Overrides', function(done) {
    var loader = new api.Loader();

    return api.normalize('ember')
    .then(function(normalized) {
      assert(normalized === loader.baseURL + 'jspm_packages/github/components/ember@1.13.2/ember.prod.js');
    })
    .then(done, done);
  });
});