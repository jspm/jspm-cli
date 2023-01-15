import assert from 'assert'

import link from '../src/link'

{
  /* basic link */
  const map = await link(['./test/fixtures/a.js'], {
    stdout: true,
    map: 'test/importmap.json',
  })
  assert.ok(typeof map.imports['react-dom'] === 'string')
}
