const cliRun = require('../lib/cli.js').default;
const assert = require('assert');
const { JSPM_CACHE_DIR } = require('../lib/utils/common');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');

const projectPath = path.resolve('test/fixtures/install-basic');
const jspmPackagesPath = path.join(projectPath, 'jspm_packages');

function readLockfile () {
  return JSON.parse(fs.readFileSync(path.join(projectPath, 'jspm.json')));
}
function readPjson () {
  return JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json')));
}

suite('jspm install', () => {
  let curJob;
  rimraf.sync('projectPath');

  test('jquery', async () => {
    await curJob;
    curJob = cliRun(projectPath, 'install', ['jquery@3.2.1']);
    await curJob;
    assert.equal(fs.realpathSync(path.join(jspmPackagesPath, 'npm/jquery@3.2.1')), path.join(JSPM_CACHE_DIR, 'packages/d776f51a907487985c9cddf4495a1b962207a51c8363a068d19650e2b5e4d287'));
    const lock = readLockfile();
    const pjson = readPjson();
    assert.equal(lock.resolve['jquery'], 'npm:jquery@3.2.1');
    assert.ok(lock.dependencies['npm:jquery@3.2.1']);
    assert.equal(lock.dependencies['npm:jquery@3.2.1'].resolve, undefined);
    assert.equal(lock.dependencies['npm:jquery@3.2.1'].source, 'https://registry.npmjs.org/jquery/-/jquery-3.2.1.tgz#5c4d9de652af6cd0a770154a631bba12b015c787');
    assert.equal(pjson.dependencies['jquery'], '3.2.1');
  });

  test('lodash', async () => {
    await curJob;
    curJob = cliRun(projectPath, 'install', ['lodash@4.17.4']);
    await curJob;
    assert.equal(fs.realpathSync(path.join(jspmPackagesPath, 'npm/lodash@4.17.4')), path.join(JSPM_CACHE_DIR, 'packages/787d655d1f11092371160584df7a9592feef6c3ddd0cc4d2b415a3773fef3812'));
    const lock = readLockfile();
    const pjson = readPjson();
    assert.equal(lock.resolve['lodash'], 'npm:lodash@4.17.4');
    assert.ok(lock.dependencies['npm:lodash@4.17.4']);
    assert.equal(lock.dependencies['npm:lodash@4.17.4'].resolve, undefined);
    assert.equal(lock.dependencies['npm:lodash@4.17.4'].source, 'https://registry.npmjs.org/lodash/-/lodash-4.17.4.tgz#78203a4d1c328ae1d86dca6460e369b57f4055ae');
    assert.equal(pjson.dependencies['lodash'], '4.17.4');
  });

  test('chalk', async () => {
    await curJob;
    curJob = cliRun(projectPath, 'install', ['chalk']);
    await curJob;
  });

  test('babel-core', async () => {
    await curJob;
    curJob = cliRun(projectPath, 'install', ['babel-core']);
    await curJob;
  });

  test('GitHub install', async () => {
    await curJob;
    curJob = cliRun(projectPath, 'install', ['github:guybedford/require-css', '--dev']);
    await curJob;
  });

  test('Resource install', async () => {
    await curJob;
    curJob = cliRun(projectPath, 'install', ['custom=git://github.com/guybedford/require-css', '--dev']);
    await curJob;
  });

  test('lock install', async () => {
    await curJob;
    curJob = cliRun(projectPath, 'install', []);
    await curJob;
    const lock = readLockfile();
    assert.equal(lock.dependencies['npm:lodash@4.17.4'].source, 'https://registry.npmjs.org/lodash/-/lodash-4.17.4.tgz#78203a4d1c328ae1d86dca6460e369b57f4055ae');
    assert.equal(lock.dependencies['npm:require-css@0.1.10'].source, 'git+ssh://github.com/guybedford/require-css');
  });

  test('linking', async () => {
    await curJob;
    curJob = cliRun(projectPath, 'link', ['.']);
    await curJob;
  });

  test('Override nulling', async () => {
    await curJob;
    curJob = cliRun(projectPath, 'install', ['mkdirp']);
    await curJob;
    const pjson = readPjson();
    assert.equal(pjson.dependencies['mkdirp'], '~0.5.1');
    assert.ok(!pjson.overrides);
  });

  test('alias', async () => {
    await curJob;
    curJob = cliRun(projectPath, 'install', ['locash=lodash@4.17.4']);
    await curJob;
    assert.equal(fs.realpathSync(path.join(jspmPackagesPath, 'npm/lodash@4.17.4')), path.join(JSPM_CACHE_DIR, 'packages/787d655d1f11092371160584df7a9592feef6c3ddd0cc4d2b415a3773fef3812'));
    const lock = readLockfile();
    const pjson = readPjson();
    assert.equal(lock.resolve['locash'], 'npm:lodash@4.17.4');
    assert.ok(lock.dependencies['npm:lodash@4.17.4']);
    assert.equal(lock.dependencies['npm:lodash@4.17.4'].resolve, undefined);
    assert.equal(lock.dependencies['npm:lodash@4.17.4'].source, 'https://registry.npmjs.org/lodash/-/lodash-4.17.4.tgz#78203a4d1c328ae1d86dca6460e369b57f4055ae');
    assert.equal(pjson.dependencies['locash'], 'lodash@4.17.4');
  });

  test('alias with version', async () => {
    await curJob;
    curJob = cliRun(projectPath, 'install', ['lodash@4=lodash@4.17.4']);
    await curJob;
    assert.equal(fs.realpathSync(path.join(jspmPackagesPath, 'npm/lodash@4.17.4')), path.join(JSPM_CACHE_DIR, 'packages/787d655d1f11092371160584df7a9592feef6c3ddd0cc4d2b415a3773fef3812'));
    const lock = readLockfile();
    const pjson = readPjson();
    assert.equal(lock.resolve['lodash@4'], 'npm:lodash@4.17.4');
    assert.ok(lock.dependencies['npm:lodash@4.17.4']);
    assert.equal(lock.dependencies['npm:lodash@4.17.4'].resolve, undefined);
    assert.equal(lock.dependencies['npm:lodash@4.17.4'].source, 'https://registry.npmjs.org/lodash/-/lodash-4.17.4.tgz#78203a4d1c328ae1d86dca6460e369b57f4055ae');
    assert.equal(pjson.dependencies['lodash@4'], 'lodash@4.17.4');
  });
});
