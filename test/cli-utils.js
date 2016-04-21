var readPropertySetters = require('../lib/cli-utils').readPropertySetters;

suite('CLI Utils', function() {
  test('Simple property setters', function() {
    var outObj = readPropertySetters('asdf.asdf=3 p=1 test=false with spa cing');
    assert(outObj.asdf.asdf === 3);
    assert(outObj.p === 1);
    assert(outObj.test === 'false with spa cing');
  });

  test('Object syntax in setters', function() {
    var outObj = readPropertySetters('a=spaced thing  b={an:"object",thing:false}');
    assert(outObj.a === 'spaced thing');
    assert(outObj.b.an === 'object');
    assert(outObj.b.thing === false);
  });
});