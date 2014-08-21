var $ = require('bootstrap');
require('bootstrap/css/bootstrap.css!');
var template = require('./bootstrap.html!text');

exports['modal test'] = function(done) {
  $("#sandbox").html(template);
  $('#myModal').on('shown.bs.modal', function() {
    done();
  });
  $('#sandbox .btn').click();
  done();
}