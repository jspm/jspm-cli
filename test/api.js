var api = require('../api');
var fs = require('fs');
var common = require('../lib/common');
var path = require('path');

api.setPackagePath('testlibs');

suite('API Calls', function() {
  test('version', function() {
    assert(api.version.match(/\d+\.\d+\.\d+(-[^\.]+)?/));
  });

  test('Normalize', function(done) {
    return api.install('jquery', '2.1.4')
    .then(function() {
      return api.normalize('jquery');
    })
    .then(function(normalized) {
      assert(normalized === 'file://' + path.resolve('testlibs') + '/jspm_packages/github/components/jquery@2.1.4/jquery.js');
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

  test('Overrides', function(done) {
    api.dlLoader()
      .then(function() {
        return api.install('ember', '1.13.2');
      })
      .then(function() {
        return api.normalize('ember').then(function(normalized) {
          assert(normalized === System.baseURL + 'jspm_packages/github/components/ember@1.13.2/ember.prod.js');
          done();
        });
      })
      .catch(done);
  });

});
