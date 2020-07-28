#!/bin/env node

import { fork } from 'child_process';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { resolve, relative, dirname } from 'path';
import glob from 'glob';
import { strictEqual, ok } from 'assert';

const stopOnError = process.env.STOP;
const only = process.env.ONLY;
const stdio = process.env.STDIO;
const concurrency = process.env.SERIAL ? 1 : Number(process.env.CONCURRENCY || process.env.C || 8);

class Pool {
  constructor (POOL_SIZE) {
    this.POOL_SIZE = POOL_SIZE;
    this.opCnt = 0;
    this.cbs = [];
  }
  async queue () {
    if (++this.opCnt > this.POOL_SIZE)
      await new Promise(resolve => this.cbs.push(resolve));
  }
  pop () {
    this.opCnt--;
    const cb = this.cbs.pop();
    if (cb) cb();
  }
}

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
  const testBase = resolve(fileURLToPath(import.meta.url) + '/../');
  const tests = glob.sync(testBase + '/**/*.test.js');
  const pool = new Pool(concurrency);
  await Promise.all(tests.map(async test => {
    await pool.queue();
    try {
      const relTest = relative(testBase, test);
      if (only && relTest !== only)
        return;
      const { code, stream } = await forked(test, [], dirname(test), true);
      if (code !== 0 || stdio) {
        for (const { err, data } of stream) {
          if (err) process.stderr.write(data);
          else process.stdout.write(data);
        }
      }
      output({ name: relTest, status: code === 0 ? 'OK' : 'FAIL' });
      if (code === 0 && stopOnError)
        process.exit(1);
    }
    finally {
      pool.pop();
    }
  }));
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
const winNewlineRegEx = /\r\n/g;
export function looseEqual (test, pattern) {
  if (typeof test === 'string' && typeof pattern === 'string') {
    test = test.replace(winNewlineRegEx, '\n');
    pattern = pattern.replace(winNewlineRegEx, '\n');
  }
  if (pattern.indexOf('*') !== -1) {
    const parts = pattern.split('*');
    let curPos = 0, i = 0;
    while (i < parts.length) {
      strictEqual(test.slice(curPos, curPos + parts[i].length), parts[i]);
      curPos += parts[i].length;
      if (++i === parts.length && curPos === test.length)
        break;
      const nextCurPos = test.indexOf(parts[i], curPos);
      if (nextCurPos === -1) {
        strictEqual(test.slice(curPos), parts[i] ? '*' + parts[i] : '');
        break;
      }
      curPos = nextCurPos;
    }
  }
  else {
    strictEqual(test, pattern);
  }
}
export { forked }
