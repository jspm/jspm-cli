#!/bin/env node

import { fork } from 'child_process';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { resolve, relative, dirname } from 'path';
import glob from 'glob';

const stopOnError = process.env.STOP;
const only = process.env.ONLY;
const stdio = process.env.STDIO;

async function forked (path, args = [], cwd, returnStream) {
  const ps = fork(path, args, { cwd, stdio: 'pipe', execArgv: ['--experimental-top-level-await', ...process.execArgv] });
  const stream = [];
  ps.stdout.on('data', data => stream.push({ err: false, data }));
  ps.stderr.on('data', data => stream.push({ err: true, data }));
  const code = await new Promise(resolve => ps.on('close', resolve));
  if (returnStream)
    return { code, stream };
  let stdout = '';
  let stderr = '';
  for (const { err, data } of stream) {
    if (err) stderr += data.toString();
    else stdout += data.toString();
  }
  return { code, stdout, stderr };
}

(async () => {
  if (fileURLToPath(import.meta.url) !== process.argv[1])
    return;
  const testBase = resolve(fileURLToPath(import.meta.url) + '/../tests');
  const tests = glob.sync(testBase + '/**/*.test.js');
  for (const test of tests) {
    const relTest = relative(testBase, test);
    if (only && relTest !== only)
      continue;
    const { code, stream } = await forked(test, [], dirname(test), true);
    if (code !== 0 || stdio) {
      for (const { err, data } of stream) {
        if (err) process.stderr.write(data);
        else process.stdout.write(data);
      }
    }
    output({ name: relTest, status: code === 0 ? 'OK' : 'FAIL' });
    if (code === 0 && stopOnError)
      return;
  }
})()
.catch(err => {
  console.error(err);
  process.exit(1);
});

function output (test) {
  if (test.status === 'OK')
    process.stdout.write(chalk.bold('.'));
  else
    process.stdout.write(chalk.red.bold('.'));
}

const pkgBase = resolve(fileURLToPath(import.meta.url) + '/../..');
export const jspm = (args, testUrl) => forked(pkgBase + '/dist/index.js', args, fileURLToPath(testUrl + '/../'));
export { forked }
