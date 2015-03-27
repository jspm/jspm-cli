/* global suite, test, assert */

var extractObj = require('../lib/config/utils').extractObj;

suite('Loader util', function() {
  suite('extractObj', function () {
    test('copy strings and arrays as is', function() {
      assert.deepEqual(extractObj({
        str:'yes',
        arr: [{__wow:true}]
      }), {
        str:'yes',
        arr: [{__wow:true}]
      });
    });

    test('include booleans', function() {
      assert.deepEqual(extractObj({read:true}), {read:true});
    });

    test('call write method on objects', function() {
      var called = false;
      var obj = { k: { write: function() { called=true; } } };
      extractObj(obj);
      assert.ok(called);
    });

    test('filters private fields', function() {
      assert.deepEqual(extractObj({__read:'yes'}), {});
    });

    test('copy fields from host object', function() {
      assert.deepEqual(extractObj({}, {host:'yes'}), {host:'yes'});
      assert.deepEqual(extractObj({}, {__host:'yes'}), {__host:'yes'});
    });

    test('traverse object', function() {
      assert.deepEqual(extractObj({field:{obj:'yes'}}), {field:{obj:'yes'}});
      assert.deepEqual(extractObj({field:{__obj:'yes'}}), {field:{}});
    });
  });
});
