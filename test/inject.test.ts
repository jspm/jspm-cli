import fs from 'fs/promises'
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

{
  /* output html file */
  await inject('test/fixtures/index.html', ['react'], {
    map: 'test/importmap.json',
    output: 'test/fixtures/index.injected.html',
  })
  const html = await fs.readFile('test/fixtures/index.injected.html', 'utf-8')
  assert.ok(
    html.includes('"react":'),
  )
}

{
  /* inject file that does not exist */
  try {
    await fs.rm('test/fixtures/index.404.html')
  }
  catch {}

  await inject('test/fixtures/index.404.html', ['react'], {
    map: 'test/importmap.json',
  })
  const html = await fs.readFile('test/fixtures/index.404.html', 'utf-8')
  assert.ok(
    html.includes('"react":'),
  )
  try {
    await fs.rm('test/fixtures/index.404.html')
  }
  catch {}
}
