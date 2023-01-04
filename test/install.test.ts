import assert from 'assert'
import install from '../src/install'

{
  /* basic install */
  const map = await install(['react@17.0.1', 'react-dom@17.0.1'], {
    stdout: true,
    map: 'test/importmap.json',
  })
  assert.strictEqual(
    map.imports.react,
    'https://ga.jspm.io/npm:react@17.0.1/dev.index.js',
  )
}

{
  /* env */
  const map = await install(['react@17.0.1', 'react-dom@17.0.1'], {
    env: 'production',
    map: 'test/importmap.json',
    stdout: true,
  })
  assert.strictEqual(
    map.imports.react,
    'https://ga.jspm.io/npm:react@17.0.1/index.js',
  )
}

{
  /* reinstall */
  const map = await install([], {
    env: 'no-deno,production',
    map: 'test/importmap.json',
    stdout: true,
  })
  assert.ok(!map.imports.react.endsWith('/dev.index.js'))
}
