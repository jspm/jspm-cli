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
import { JspmUserError } from '../utils/common';
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
  if (output && output.trim().length)
    return false;
  await execGit(`remote set-url origin ${remote.replace(/(['"()])/g, '\\\$1')}`, execOpts);
  await execGit(`checkout ${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
  const headRef = await getHead(gitPath);
  if (!headRef.startsWith('ref: refs/heads/'))
    return true;
  
  // if a branch ref, update from remote
  await execGit(`fetch origin ${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
  await execGit(`reset --hard origin/${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
  return true;
}

export async function setLocalHead (project: Project, gitPath: string, localGitPath: string, ref: string = 'master', force: boolean): Promise<boolean> {
  const execOpts = {
    killSignal: 'SIGKILL',
    maxBuffer: 100 * 1024 * 1024,
    cwd: gitPath
  };
  const output = await execGit('status --porcelain', execOpts);
  if (output && output.trim().length) {
    if (!force) {
      project.log.warn(`Local git repo ${gitPath} is not in a clean state to update. Commit the recent changes or use the -f flag to force reset.`);
      return false;
    }
    else {
      project.log.warn(`Resetting local git repo ${gitPath}.`);
    }
    await execGit(`reset --hard ${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
    const output = await execGit('status --porcelain', execOpts);
    if (output && output.trim().length)
      throw new JspmUserError(`Unable to clean repo state for ${gitPath}.`);
  }

  await execGit(`remote add tmp-jspm ${localGitPath.replace(/(['"()])/g, '\\\$1')}`, execOpts);
  try {
    await execGit(`fetch tmp-jspm`, execOpts);

    const localHead = await getHead(localGitPath);
    
    // commit tag -> checkout directly
    if (!localHead.startsWith('ref: refs/heads/')) {
      await execGit(`checkout ${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
    }
    // branch -> fetch + reset
    else {
      await execGit(`reset --hard tmp-jspm/${ref.replace(/(['"()])/g, '\\\$1')}`, execOpts);
    }
  }
  finally {
    await execGit(`remote remove tmp-jspm`, execOpts);
  }
  return true;
}

export async function getHead (gitPath: string): Promise<string> {
  const source = await new Promise((resolve, reject) => fs.readFile(gitPath + '/.git/HEAD', (err, source) => err ? reject(err) : resolve(source)));
  return source.toString().trim();
}
