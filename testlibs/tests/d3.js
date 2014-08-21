var d3 = require('d3');

exports['style test'] = function(done) {
  document.querySelector('#sandbox').innerHTML = '<p>d3</p>';
  d3.selectAll("p").style("color", "red");
  done();
}