var PackageJSON = require('../lib/config/package');
var fs = require('fs');
var mkdirp = require('mkdirp');
var path = require('path');

suite('package.json', function() {

  var inputs = fs.readdirSync('./test/fixtures/pjson/initial');

  mkdirp.sync('./test/outputs/pjson');

  inputs.forEach(function(input) {
    test(input.replace(/\.json$/, ''), function(done) {
      var test = new PackageJSON(path.resolve('./test/fixtures/pjson/initial/' + input));
      return Promise.resolve(test.read())
      .then(function() {
        test.fileName = './test/outputs/pjson/' + input;
        return test.write();
      })
      .then(function() {
        var expected = fs.readFileSync('./test/fixtures/pjson/expected/' + input).toString();
        var actual = fs.readFileSync('./test/outputs/pjson/' + input).toString();
        try {
          assert.equal(actual, expected);
        }
        catch(e) {
          e.showDiff = true;
          throw e;
        }
      })
      .then(done, done);
    });
  });
});
