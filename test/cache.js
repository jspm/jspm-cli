const assert = require('assert');
const Cache = require('../lib/utils/cache').default;

suite('Simple locking', () => {
  const core = new Cache(__dirname + '/core');

  test('Lock', async () => {
    let step = 0;

    let unlock = await core.lock('test', 1000);

    let unlock2Promise = core.lock('test', 1000);
    unlock2Promise.catch(() => {});

    let ps = [];
    for (let i = 0; i < 10; i++) {
      const promise = (async () => {
        await core.getUnlocked('test');
        return step++;
      })();
      promise.catch(() => {});
      ps.push(promise);
    }

    let unlock3Promise = core.lock('test', 1000);
    unlock3Promise.catch(() => {});

    assert.equal(step++, 0);

    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(step++, 1);

    unlock()
    .catch(() => {});

    let unlock2 = await unlock2Promise;

    assert.equal(step++, 2);
    await new Promise(resolve => setTimeout(resolve, 10));
    unlock2()
    .catch(() => {});

    let unlock3 = await unlock3Promise;
    await unlock3();

    await Promise.all(ps);

    assert.equal(step++, 13);

    await core.getUnlocked('test');
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
