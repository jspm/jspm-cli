const assert = require('assert');
const Cache = require('../lib/utils/cache').default;

suite('Simple locking', () => {
  const core = new Cache(__dirname + '/core');

  test('Lock', async () => {
    console.log('1');
    let step = 0;
    console.log('2');
    let unlock = await core.lock('test', 1000);
    console.log('3');
    let unlock2Promise = core.lock('test', 1000);
    unlock2Promise.catch(() => {});
    console.log('4');
    let ps = [];
    for (let i = 0; i < 10; i++) {
      const promise = (async () => {
        console.log('5' + i);
        await core.getUnlocked('test');
        console.log('6' + i);
        return step++;
      })();
      promise.catch(() => {});
      ps.push(promise);
    }
    console.log('7');

    let unlock3Promise = core.lock('test', 1000);
    unlock3Promise.catch(() => {});
    console.log('8');

    assert.equal(step++, 0);

    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(step++, 1);
    console.log('9');

    unlock()
    .catch(() => {});

    let unlock2 = await unlock2Promise;
    console.log('10');

    assert.equal(step++, 2);
    await new Promise(resolve => setTimeout(resolve, 10));
    console.log('11');
    unlock2()
    .catch(() => {});

    let unlock3 = await unlock3Promise;
    console.log('12');
    await unlock3();

    await Promise.all(ps);
    console.log('13');

    assert.equal(step++, 13);

    await core.getUnlocked('test');
    console.log('14');
  });

  test('Set unlock', async () => {
    let step = 0;

    let unlock = await core.lock('test2', 1);

    let lt2 = core.getUnlocked('test2', 1000)
    .then(() => {
      assert.equal(++step > 0 && step < 3, true);
    }, () => {});

    await core.setUnlock('test2', 'asdf');
    assert.equal(++step > 0 && step < 3, true);

    await lt2;

    assert.equal(++step, 3);
  });
});
