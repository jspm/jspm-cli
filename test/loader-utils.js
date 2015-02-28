/* global suite, test, assert */

var extractObj = require('../lib/config/utils').extractObj;

suite('Loader util', function() {
  suite('extractObj', function () {
    test('copy strings and arrays as is', function() {
      assert.deepEqual(extractObj({
        str:'yes',
        arr: [{wow_:true}]
      }), {
        str:'yes',
        arr: [{wow_:true}]
      });
    });

    test('skip booleans', function() {
      assert.deepEqual(extractObj({read:true}), {});
    });

    test('call write method on objects', function() {
      var called = false;
      var obj = { k: { write: function() { called=true; } } };
      extractObj(obj);
      assert.ok(called);
    });

    test('filters private fields', function() {
      assert.deepEqual(extractObj({read_:'yes'}), {});
    });

    test('copy fields from host object', function() {
      assert.deepEqual(extractObj({}, {host:'yes'}), {host:'yes'});
      assert.deepEqual(extractObj({}, {host_:'yes'}), {host_:'yes'});
    });

    test('traverse object', function() {
      assert.deepEqual(extractObj({field:{obj:'yes'}}), {field:{obj:'yes'}});
      assert.deepEqual(extractObj({field:{obj_:'yes'}}), {field:{}});
    });
  });
});
