import assert from 'assert'
import extract from '../src/extract'

{
  /* basic extract */
  const map = await extract(['react'], {
    stdout: true,
    map: 'test/importmap.json',
  })
  assert.strictEqual(Object.keys(map.imports).length, 1)
}
