import mm = require('micromatch');
import { JspmUserError, bold } from "./common";
import fs = require('graceful-fs');
import path = require('path');

const alwaysIncludeFile = /^(readme|changelog|license|licence|notice)\.[^\.\/]+$/i;
// (we ignore all dot files)
const alwaysIgnoreFile = /^\.|^(CVS|npm-debug\.log|node_modules|jspm_packages|config\.gypi|[^\.]+\.orig|package-lock\.json|jspm\.json|jspm\.json\.lock|package\.json\.lock)$/;

export function throwFieldMissing (fieldName: string) {
  throw new JspmUserError(`Package configuration must specify a ${bold(fieldName)} field to publish.`);
}
export function throwFieldInvalid (value: string, expected: string) {
  throw new JspmUserError(`${bold(JSON.stringify(value))} is not a valid ${expected}.`);
}

export async function createFilesFilter (projectPath: string, pjsonFiles: undefined | string[], pjsonIgnore: undefined | string[]): Promise<(file: string) => boolean> {
  // We support package.json "ignore", falling back to .npmignore, .gitignore
  let ignore = pjsonIgnore;
  let ignoreIsFile = false;
  if (pjsonIgnore instanceof Array === false) {
    if (pjsonIgnore !== undefined)
      throwFieldInvalid('ignore', 'array of patterns');
    try {
      const npmignore = await new Promise((resolve, reject) => 
        fs.readFile(path.join(projectPath, '.npmignore'), (err, source) => err ? reject(err) : resolve(source))
      );
      ignoreIsFile = true;
      ignore = npmignore.toString().trim().split('\n').map(item => item.trim()).filter(item => item[0] !== '#');
    }
    catch (e) {
      if (e.code !== 'ENOENT')
        throw e;
      try {
        const gitignore = await new Promise((resolve, reject) =>
          fs.readFile(path.join(projectPath, '.gitignore'), (err, source) => err ? reject(err) : resolve(source))
        );
        ignoreIsFile = true;
        ignore = gitignore.toString().trim().split('\n').map(item => item.trim()).filter(item => item[0] !== '#');
      }
      catch (e) {
        if (e.code !== 'ENOENT')
          throw e;
      }
    }
  }

  if (pjsonFiles !== undefined && pjsonFiles instanceof Array === false)
    throwFieldInvalid('files', 'array of patterns');

  // we dont ignore if there are files entries and the ignore came from a file (npm rule)
  if (ignoreIsFile && pjsonFiles)
    ignore = [];

  const ignoresRes: RegExp[] = [];
  const filesRes: RegExp[] = [];
  const foldersRes: RegExp[] = [];
  if (pjsonFiles) {
    for (let pattern of pjsonFiles) {
      pattern = pattern.replace(/\\/g, '/');
      const parts = pattern.split('/');
      while (parts.length > 1) {
        parts.pop();
        foldersRes.push(mm.makeRe(parts.join('/')));
      }
      filesRes.push(mm.makeRe(pattern));
      filesRes.push(mm.makeRe(pattern + (pattern[pattern.length - 1] !== '/' ? '/' : '') + '**'));
    }
  }
  if (ignore) {
    for (let pattern of ignore) {
      pattern = pattern.replace(/\\/g, '/');
      ignoresRes.push(mm.makeRe(pattern));
      ignoresRes.push(mm.makeRe(pattern + (pattern[pattern.length - 1] === '/' ? '/' : '') + '**'));
    }
  }

  return (file: string) => {
    const relFile = path.relative(projectPath, file).replace(/\\/g, '/');

    // always included
    if (relFile.indexOf('/') === -1) {
      if (relFile === 'package.json' || alwaysIncludeFile.test(relFile))
        return false;
    }
    // always ignored
    if (alwaysIgnoreFile.test(path.basename(relFile)))
      return true;
    // "files"
    if (pjsonFiles) {
      if (filesRes.some(re => re.test(relFile))) {
        return ignoresRes.some(re => re.test(relFile));
      }
      // folder of "files" pattern
      return !foldersRes.some(re => re.test(relFile));
    }
    return ignoresRes.some(re => re.test(relFile));
  };
}