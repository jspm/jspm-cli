var readPropertySetters = require('../lib/cli-utils').readPropertySetters;

suite('CLI Utils', function() {
  test('Simple property setters', function() {
    var outObj = readPropertySetters('asdf.asdf=3 p=1 test=false with spa cing', true);
    assert(outObj.asdf.asdf === 3);
    assert(outObj.p === 1);
    assert(outObj.test === 'false with spa cing');
  });

  test('Object syntax in setters', function() {
    var outObj = readPropertySetters('a=spaced thing  b={an:"object",thing:false}', true);
    assert(outObj.a === 'spaced thing');
    assert(outObj.b.an === 'object');
    assert(outObj.b.thing === false);
  });

  test('Dotted properties', function() {
    var outObj = readPropertySetters('dotted.property=5', false);
    assert(outObj['dotted.property'] === 5);
  });
});