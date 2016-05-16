var readPropertySetters = require('../lib/cli-utils').readPropertySetters;

suite('CLI Utils', function() {
  test('Simple property setters', function() {
    var outObj = readPropertySetters('asdf.asdf=3 p=1 test=false with spa cing actual=false', true);
    assert(outObj.asdf.asdf === 3);
    assert(outObj.p === 1);
    assert(outObj.test === 'false with spa cing');
    assert(outObj.actual === false);
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

  test('Bracket object properties mixed with dots', function() {
    var outObj = readPropertySetters('dotted.property["x.y.z"] = 5 meta[lib/index.js].deps[]=./definitions/init', true);
    assert(outObj.dotted.property['x.y.z'] === 5);
    assert(outObj.meta['lib/index.js'].deps[0] == './definitions/init');
  });

  test('Arrays', function() {
    var outObj = readPropertySetters('a[] = 1,2,3 b=[\'1\',2,"3"] c[]=asdf asdf', true);
    assert(outObj.a instanceof Array);
    assert(outObj.a[0] === '1');
    assert(outObj.a[1] === '2');
    assert(outObj.b instanceof Array);
    assert(outObj.b[0] === '1');
    assert(outObj.b[1] === 2);
    assert(outObj.c[0] == 'asdf asdf');
  });
});