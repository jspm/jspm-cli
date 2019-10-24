/*
 *   Copyright 2014-2019 Guy Bedford (http://guybedford.com)
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */
import fs = require('fs');
import execGit from '../utils/exec-git';
import { JspmUserError, highlight, bold } from '../utils/common';
import { Project } from '../project';

export function isGitRepo (gitPath: string) {
  return fs.existsSync(gitPath + '/.git');
}

// ensure that the repo at gitPath corresponds to the given remote and ref
// return false if not a git repo or if the expected remote is not origin
// force clears all local state otherwise and does a full checkout
export async function setGlobalHead (gitPath: string, remote: string, ref: string = 'master'): Promise<boolean> {
  const execOpts = {
    killSignal: 'SIGKILL',
    maxBuffer: 100 * 1024 * 1024,
    cwd: gitPath
  };
  const output = await execGit('status --porcelain', execOpts);
  if (output && output.toString().trim().length)
    return false;
  await execGit(`remote set-url origin ${remote.replace(/(['"()])/g, '\\\$1')}`, execOpts);
  await execGit(`fetch origin`, execOpts);
  await execGit(`checkout ${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
  const headRef = toRef(await getHead(gitPath))
  if (headRef === ref)
    return true;
  // determine if it is a branch or tag
  const refOutput = await execGit(`show-ref ${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
  if (refOutput && refOutput.toString().indexOf('refs/tags') !== -1) {
    // only way to ensure tag is recent is to delete it first!
    await execGit(`tag -d ${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
    await execGit(`fetch origin "+refs/tags/${ref.replace(/(['"()])/g, '\\\$1')}:refs/tags/${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
    await execGit(`reset --hard refs/tags/${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
  }
  else if (refOutput && refOutput.toString().indexOf('refs/heads') !== -1) {
    await execGit(`reset --hard origin/${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
  }
  else {
    await execGit(`reset --hard ${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
  }
  return true;
}

export async function checkCleanClone (pkgName: string, gitPath: string, remote: string, ref: string = 'master'): Promise<string | undefined> {
  const fixMsg = 'Use the -f flag to fix (local branches will be preserved).';
  const execOpts = {
    killSignal: 'SIGKILL',
    maxBuffer: 100 * 1024 * 1024,
    cwd: gitPath
  };  
  const output = await execGit('status --porcelain', execOpts);
  if (output && output.toString().trim().length)
    return `${highlight(pkgName)} has unsaved local git changes (use -f to clear):\n${output.toString().trim().replace(/\?\?/g, '-')}`;
  const headRef = toRef(await getHead(gitPath));
  if (headRef !== ref)
    return `${highlight(pkgName)} is currently on the ${bold(headRef)} branch instead of ${bold(ref)}. ${fixMsg}`;
  try {
    const curOrigin = (await execGit(`remote get-url origin`, execOpts)).toString().trim();
    if (curOrigin !== remote)
      return `${highlight(pkgName)} has a different ${bold('origin')} ${curOrigin} than expected ${remote}. ${fixMsg}`;
  }
  catch (e) {
    if (e.toString().indexOf('No such remote') !== -1)
      return `${highlight(pkgName)} does not have an ${bold('origin')} branch. ${fixMsg}`;
    throw e;
  }
  return;
}

export async function setLocalHead (project: Project, pkgName: string, localGitPath: string, globalGitPath: string, ref: string = 'master', force: boolean): Promise<boolean> {
  const execOpts = {
    killSignal: 'SIGKILL',
    maxBuffer: 100 * 1024 * 1024,
    cwd: localGitPath
  };
  const output = await execGit('status --porcelain', execOpts);
  if (output && output.toString().trim().length) {
    if (!force) {
      project.log.warn(`${highlight(pkgName)} has unsaved local git changes (use -f to clear):\n${output.toString().trim().replace(/\?\?/g, '-')}`);
      return;
    }
    else {
      project.log.info(`Resetting local git repo ${highlight(pkgName)}.`);
    }
    await execGit(`reset --hard ${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
    await execGit(`clean -f -d`, execOpts);
    {
      const output = await execGit('status --porcelain', execOpts);
      if (output && output.toString().trim().length)
        throw new JspmUserError(`${highlight(pkgName)} Unable to clean repo state for ${pkgName}.`);
    }
  }
  try {
    await execGit(`remote add tmp-jspm ${globalGitPath.replace(/(['"()])/g, '\\\$1')}`, execOpts);
  }
  catch (e) {
    if (e.toString().indexOf('already exists') === -1)
      throw e;
  }
  try {
    await execGit(`fetch tmp-jspm`, execOpts);

    const globalHead = await getHead(globalGitPath);
    await execGit(`checkout ${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
    
    // branch -> reset
    if (globalHead.startsWith('ref: refs/heads/'))
      await execGit(`reset --hard tmp-jspm/${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
  }
  finally {
    await execGit(`remote remove tmp-jspm`, execOpts);
  }
  return true;
}

function toRef (headRef: string): string {
  if (headRef.startsWith('ref: refs/heads/'))
    return headRef.slice(16);
  return headRef;
}

export async function getHead (gitPath: string): Promise<string> {
  const source = await new Promise((resolve, reject) => fs.readFile(gitPath + '/.git/HEAD', (err, source) => err ? reject(err) : resolve(source)));
  return source.toString().trim();
}
