import assert from 'assert'
import update from '../src/update'

{
  /* basic update */
  const map = await update(['react'], {
    stdout: true,
    map: 'test/importmap.json',
  })
  assert.ok(typeof map.imports.react === 'string')
  assert.notStrictEqual(
    map.imports.react,
    'https://ga.jspm.io/npm:react@17.0.1/dev.index.js',
  )
}
