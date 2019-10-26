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
import { Logger } from '../project';
import FetchClass from './fetch';
import { URL } from 'url';
import crypto = require('crypto');
import { JspmError, JspmUserError, bold, highlight, isWindows, winSepRegEx } from '../utils/common';
import zlib = require('zlib');
import peek = require('buffer-peek-stream');
import fs = require('graceful-fs');
import tar = require('tar-fs');
import execGit from '../utils/exec-git';
import path = require('path');

const gitProtocol = {
  download: gitCheckout
};

// checkout sources are sources that are not global cache links
export function isCheckoutSource (source: string) {
  return source.startsWith('file:') || source.startsWith('git');
}

function defaultToGitUser (sshTarget: string) {
  const atIndex = sshTarget.indexOf('@');
  const lastSlashIndex = sshTarget.lastIndexOf('/');
  if (atIndex === -1 || atIndex > lastSlashIndex)
    return 'git@' + sshTarget.replace('/', ':');
  return (sshTarget.lastIndexOf('/', atIndex) === -1 ? 'git@' : '') + sshTarget.replace('/', ':');
}

export function readGitSource (source: string) {
  let url = source.startsWith('git:') ? source : source.substr(4);
  if (url.startsWith('ssh://'))
    url = defaultToGitUser(url.slice(6));
  else if (url.startsWith('ssh:/'))
    url = defaultToGitUser(url.slice(5));
  else if (url.startsWith('ssh:'))
    url = defaultToGitUser(url.slice(4));
  let ref;
  let gitRefIndex = url.lastIndexOf('#');
  if (gitRefIndex !== -1) {
    ref = url.slice(gitRefIndex + 1);
    url = url.substr(0, gitRefIndex);
  }
  return { url, ref };
}

export function normalizeResourceTarget (source: string, packagePath: string, projectPath: string): string {
  if (source.startsWith('file:')) {
    let sourceProtocol = source.substr(0, 5);
    let sourcePath = path.resolve(projectPath, source.substr(5));
    
    // relative file path installs that are not for the top-level project are relative to their package real path
    if (packagePath !== projectPath) {
      if ((isWindows && (source[0] === '/' || source[0] === '\\')) ||
          sourcePath[0] === '.' && (sourcePath[1] === '/' || sourcePath[1] === '\\' || (
          sourcePath[1] === '.' && (sourcePath[2] === '/' || sourcePath[2] === '\\')))) {
        const realPackagePath = fs.realpathSync(packagePath);
        sourcePath = path.resolve(realPackagePath, sourcePath);
      }
    }
    sourcePath = path.relative(projectPath, sourcePath);
    if (isWindows)
      sourcePath = sourcePath.replace(winSepRegEx, '/');
    source = sourceProtocol + sourcePath;
  }
  else if (source.startsWith('git')) {
    if (source.endsWith('#master'))
      source = source.slice(0, -7);
    return source;
  }
  return source;
}

export const sourceProtocols: {
  [protocol: string]: {
    download?: (log: Logger, fetch: FetchClass, source: string, outDir: string, timeout: number) => Promise<void>
  }
} = {
  'git': gitProtocol,
  'git+file': gitProtocol,
  'git+ssh': gitProtocol,
  'git+http': gitProtocol,
  'git+https': gitProtocol,
  'https': {
    download: fetchRemoteTarball
  },
  'http': {
    download: fetchRemoteTarball
  },
  'file': {}
};

function getProtocolHandler (source: string) {
  const protocolIndex = source.indexOf(':');
  const protocol = source.substr(0, protocolIndex);
  const protocolHandler = sourceProtocols[protocol];

  if (!protocolHandler)
    throw new Error(`No handler available for source protocol ${bold(protocol)} processing ${source}.`);
  
  return protocolHandler;
}

export function downloadSource (log: Logger, fetch: FetchClass, source: string, outDir: string, timeout: number): Promise<void> {
  const protocolHandler = getProtocolHandler(source);
  if (!protocolHandler.download)
    throw new JspmError(`Invalid attempt to download source ${source}`);
  return protocolHandler.download(log, fetch, source, outDir, timeout);
}

async function gitCheckout (log: Logger, fetch: FetchClass, source: string, outDir: string, timeout: number) {
  if (process.env.JSPM_HTTPS_GIT && source.startsWith('git+ssh'))
    source = 'git+https' + source.slice(7);

  let { url, ref } = readGitSource(source);

  const local = url.startsWith('file:');

  const execOpts = {
    timeout,
    killSignal: 'SIGKILL',
    maxBuffer: 100 * 1024 * 1024
  };

  if (url.startsWith('http')) {
    const credentials = await fetch.getCredentials(url);
    if (credentials.basicAuth) {
      let urlObj = new URL(url);
      ({ username: urlObj.username, password: urlObj.password } = credentials.basicAuth);
      url = urlObj.href;
    }
  }

  const logEnd = log.taskStart('Cloning ' + highlight(source));
  try {
    await execGit(`clone ${ref ? '-n ' : ''}${local ? '-l ' : ''}${url.replace(/(['"()])/g, '\\\$1')} ${outDir}`, execOpts);
    if (ref)
      await execGit(`checkout ${ref.replace(/(['"()])/g, '\\\$1')}`, Object.assign(execOpts, { cwd: outDir }));
  }
  catch (err) {
    if (err.toString().indexOf('is not a valid repository name') !== -1)
      throw new JspmUserError(`${highlight(url)} is an invalid GitHub package name. Ensure it does not include any non-standard characters or invalid @. Note '#' should be used for versions in git repos.`);
    if (err.toString().indexOf('Repository not found') !== -1 || err.toString().indexOf('Could not read from remote repository') !== -1)
      throw new JspmUserError(`Unable to find repo ${highlight(url)}. It may not exist, or authorization may be required.`);
    throw err;
  }
  finally {
    logEnd();
  }
}

async function fetchRemoteTarball (log: Logger, fetch: FetchClass, source: string, outDir: string) {
  const { url, hashType, hash } = readSource(log, source);
  const fetchOptions = {
    headers: {
      accept: 'application/octet-stream'
    }
  };

  const href = url.href;
  const logEnd = log.taskStart('Fetching ' + highlight(href));
  try {
    var res = await fetch.fetch(href, fetchOptions);
  }
  catch (err) {
    switch (err.code) {
      case 'ENOTFOUND':
        if (err.toString().indexOf('getaddrinfo') === -1)
          break;
      case 'ECONNRESET':
      case 'ETIMEDOUT':
      case 'ESOCKETTIMEDOUT':
        err.retriable = true;
        err.hideStack = true;
    }
    throw err;
  }
  finally {
    logEnd();
  }

  if (res.status !== 200)
    throw new Error(`Bad download response code ${res.status} for ${source}`);

  let validationPromise;
  if (!hashType) {
    validationPromise = Promise.resolve()
  }
  else {
    const verifyHash = crypto.createHash(hashType);
    // Validate downloaded hash
    validationPromise = new Promise((resolve, reject) => {
      res.body.pipe(verifyHash)
      .pause()
      .on('finish', () => {
        let computedHash = <Buffer>verifyHash.read();
        if (!computedHash.equals(hash)) {
          let err = <JspmError>new Error(`Hash integrity compromised downloading ${href}.`);
          err.hideStack = true;
          reject(err);
        }
        resolve();
      })
      .on('error', reject);
    });
  }

  let stream: any = await new Promise((resolve, reject) => {
    // pipe through gunzip if a gzipped stream
    peek(res.body, 3, (err, bytes, stream) => {
      if (err)
        reject(err);
      else if (bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08)
        resolve(stream.pipe(zlib.createGunzip()).pause());
      else
        resolve(stream.pause());
    });
  });

  await Promise.all([
    validationPromise,
    // Unpack contents as a tar archive and save to targetDir
    new Promise((resolve, reject) => {
      stream.pipe(tar.extract(outDir, <any>{
        // all dirs and files should be readable and writeable
        dmode: 0o555,
        fmode: 0o666,
        strip: 1,
        filter: function(_, header) {
          return header.type !== 'file' && header.type !== 'directory'
        }
      }))
      .on('finish', resolve)
      .on('error', reject);
    })
  ]);
}

/*
async function extractLocalTarball (log: Logger, _fetch: FetchClass, source: string, outDir: string) {
  const { url, hashType, hash } = readSource(log, source);

  let stream = fs.createReadStream(url);

  let validationPromise;
  if (!hashType) {
    validationPromise = Promise.resolve()
  }
  else {
    const verifyHash = crypto.createHash(hashType);
    // Validate downloaded hash
    validationPromise = new Promise((resolve, reject) => {
      stream.pipe(verifyHash)
      .pause()
      .on('finish', () => {
        let computedHash = verifyHash.digest();
        if (!computedHash.equals(hash)) {
          let err = <JspmError>new Error(`Hash integrity compromised downloading ${url.href}.`);
          err.hideStack = true;
          reject(err);
        }
        resolve();
      })
      .on('error', reject);
    });
  }

  let extractStream = await new Promise<Stream.Readable>((resolve, reject) => {
    // pipe through gunzip if a gzipped stream
    peek(stream, 3, (err, bytes, stream) => {
      if (err)
        reject(err);
      else if (bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08)
        resolve(stream.pipe(zlib.createGunzip()).pause());
      else
        resolve(stream.pause());
    });
  });

  await Promise.all([
    validationPromise,
    // Unpack contents as a tar archive and save to targetDir
    new Promise((resolve, reject) => {
      extractStream.pipe(tar.extract(outDir, <any>{
        // all dirs and files should be readable
        dmode: 0o555,
        fmode: 0o666,
        strip: 1,
        filter: function(_, header) {
          return header.type !== 'file' && header.type !== 'directory'
        }
      }))
      .on('finish', resolve)
      .on('error', reject);
    })
  ]);
}
*/

const base64RegEx = /[a-z0-9+/]*={0,2}$/i;
const hexRegEx = /[a-f0-9]*$/g;

const hashTypes = [
  {
    hashType: 'sha1',
    len: 20
  },
  {
    hashType: 'sha224',
    len: 28
  },
  {
    hashType: 'sha256',
    len: 32
  },
  {
    hashType: 'sha384',
    len: 48
  },
  {
    hashType: 'sha512',
    len: 64
  }
];

interface Source {
  url: URL,
  hash?: Buffer,
  hashType?: string
};

function readSource (log: Logger, source: string): Source {
  const hashIndex = source.lastIndexOf('#');
  if (hashIndex === -1) {
    const url = new URL(source);
    return { url };
  }

  const url = new URL(source.substr(0, hashIndex));

  const hashTypeIndex = source.indexOf('-', hashIndex + 1);
  // direct hexadecimal hash for sha
  if (hashTypeIndex === -1) {
    const hashLen = source.length - hashIndex - 1;
    hexRegEx.lastIndex = hashIndex + 1;
    if (hexRegEx.exec(source)[0].length !== hashLen) {
      log.warn(`Source ${source} does not have a valid hexadecimal hash so is being ignored.`);
      return { url };
    }
    const halfHashLen = hashLen / 2;
    let hashMatch = hashTypes.find(({ len }) => len === halfHashLen);
    if (!hashMatch || hashLen % 2 !== 0) {
      log.warn(`Source ${source} has a hexadecimal hash of invalid length for any sha hash so is being ignored.`);
      return { url };
    }
    const hashType = hashMatch.hashType;
    const hash = Buffer.from(source.substr(hashIndex + 1), 'hex');
    return { url, hash, hashType };
  }
  // base64 integrity-style hash
  else {
    const hashType = source.substring(hashIndex + 1, hashTypeIndex);
    const hashLen = source.length - hashTypeIndex - 1;
    base64RegEx.lastIndex = hashTypeIndex + 1;
    if (base64RegEx.exec(source)[0].length !== hashLen) {
      log.warn(`Source ${source} does not have a valid base64 hash string so is being ignored.`);
      return { url };
    }
    const hashMatch = hashTypes.find(({ hashType: type }) => hashType === type);
    if (!hashMatch) {
      log.warn(`Source ${source} is using an unsupported hash algorithm so is being ignored.`);
      return { url };
    }
    const hash = Buffer.from(source.substr(hashTypeIndex + 1), 'base64');
    if (hashMatch.len !== hash.length) {
      log.warn(`Source ${source} does not have a valid length ${hashType} base64 hash so it is being ignored.`);;
      return { url };
    }
    return { url, hash, hashType };
  }
}

// best-effort attempt to determine a git repo remote
export async function checkGitReference (packagePath: string): Promise<string[] | void> {
	const gitCfg = await new Promise<string | void>(resolve => 
		fs.readFile(path.join(packagePath, '.git', 'config'), (err, source) => err ? resolve() : resolve(source.toString()))
  );
	if (!gitCfg)
		return;

	const remotes = [];
	let remoteName;
	for (const line of gitCfg.split('\n')) {
		if (remoteName) {
			const [, remoteUrl] = line.match(/^\s*url\s*=\s*(.+)/) || [];
			if (remoteUrl) {
        if (remotes.indexOf(remoteUrl) === -1)
          remotes.push(remoteUrl);
				remoteName = undefined;
				continue;
			}
		}
		[, remoteName] = line.match(/^\s*\[remote\s*"([^"]+)"\s*\]/) || [];
	}
	return remotes;
}
