import assert from 'assert'
import inject from '../src/inject'

{
  /* basic inject */
  const map = await inject('test/fixtures/index.html', ['react'], {
    stdout: true,
    map: 'test/importmap.json',
  })
  assert.ok(
    map.includes('"react":'),
  )
}
