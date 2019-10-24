const cliRun = require('../lib/cli.js').default;
const path = require('path');

const projectPath = path.resolve('test/fixtures/trace');

suite('Import Maps', () => {
  test('Dynamic import trace', async () => {
    await cliRun(projectPath, 'trace', ['./test/fixtures/trace/test.js']);
  });
});
