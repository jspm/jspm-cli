import assert from 'assert'

import traceInstall from '../src/traceInstall'

{
  /* basic traceInstall */
  const map = await traceInstall(['./test/fixtures/a.js'], {
    stdout: true,
    map: 'test/importmap.json',
  })
  assert.ok(typeof map.imports['react-dom'] === 'string')
}
