import d3 from 'd3';

export function style_test(done) {
  document.querySelector('#sandbox').innerHTML = '<p>d3</p>';
  d3.selectAll("p").style("color", "red");
  done();
}