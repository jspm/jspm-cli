import childProcess = require('child_process');
import process = require('process');
import { isWindows } from './common';
import path = require('path');

const PATH = isWindows ? Object.keys(process.env).find(e => Boolean(e.match(/^PATH$/i))) || 'Path' : 'PATH';

export async function runCmd (script: string, cwd: string): Promise<number> {
  const env = {};
  
  const pathArr = [];
  pathArr.push(path.join(cwd, 'jspm_packages', '.bin'));
  pathArr.push(path.join(__dirname, 'node-gyp-bin'));
  pathArr.push(path.join(cwd, 'node_modules', '.bin'));
  pathArr.push(process.env[PATH]);

  env[PATH] = pathArr.join(process.platform === 'win32' ? ';' : ':');

  const sh = isWindows ? process.env.comspec || 'cmd' : 'sh';
  const shFlag = isWindows ? '/d /s /c' : '-c';
  const proc = childProcess.spawn(sh, [shFlag, script], { cwd, env, stdio: 'inherit', windowsVerbatimArguments: true });
  return new Promise<number>((resolve, reject) => proc.on('close', resolve).on('error', reject));
}