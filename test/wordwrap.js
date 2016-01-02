var wordWrap = require('../lib/ui').wordWrap;

suite('Wordwrapping', function() {
  test('Basic tests', function() {
    assert(wordWrap('test here', 2, 10), '  test\n  ');
  });
});