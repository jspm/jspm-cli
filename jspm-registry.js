var https = require('https');

var registryDownloader = function() {}

registryDownloader.prototype = {
  degree: 1,
  getVersions: function(repo, callback, errback) {
    var resData = [];
    https.get({
      hostname: 'registry.jspm.io',
      path: '/' + repo,
      headers: { accept: 'application/json' },
      rejectUnauthorized: false
    }, function(res) {
      res.on('data', function(chunk) {
        resData.push(chunk);
      });
      res.on('end', function() {
        var result;
        try {
          result = JSON.parse(resData.join(''));
          if (result.name)
            callback(null, result);
          else
            callback();
        }
        catch(e) {
          errback();
        }
      });
      res.on('error', errback);
    });
  }
};

module.exports = registryDownloader;