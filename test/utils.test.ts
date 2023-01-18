import assert from 'assert'
import { spyOn } from 'tinyspy'
import install from '../src/install'
import { wrapCommandAndRemoveStack } from '../src/utils'

{
  let errorStr = ''
  spyOn(console, 'error', (err) => {
    errorStr = err
  })
  /* basic install 404 with wrapCommandAndRemoveStack should not throw with stack mesage */
  await wrapCommandAndRemoveStack(install)(['package-does-not-exist'], {
    env: 'development',
    stdout: true,
    map: 'test/importmap.json',
  })
  assert.ok(process.exitCode === 1)
  assert.ok(errorStr.includes('Unable to resolve npm:package-does-not-exist@ to a valid version imported from'))
  process.exitCode = 0
}
