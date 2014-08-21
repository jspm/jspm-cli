var $ = require('jquery');

exports['simple test'] = function(done) {
  $('#sandbox').html('jquery');
  done();
}