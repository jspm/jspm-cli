import { Semver } from 'sver';
import { JspmUserError, bold, validPkgNameRegEx, highlight } from '../utils/common';
import { Project } from '../api';
import { PackageName } from './package';
import tar = require('tar-fs');
import spdxLicenses = require('spdx-license-list/simple');
import fs = require('graceful-fs');
import { Readable } from 'stream';
import { throwFieldMissing, throwFieldInvalid, createFilesFilter } from '../utils/pjson';

interface PublishOptions {
  otp?: string;
  tag?: string;
  public?: boolean | void;
}

export function pack (project: Project, ignoreFilter: (file: string) => boolean) {
  const includedFiles: string[] = [];
  const tarStream = <Readable>tar.pack(project.projectPath, <any>{
    fs,
    ignore (file: string) {
      if (ignoreFilter(file))
        return true;
      includedFiles.push(file);
      return false;
    },
    map (header) {
      header.name = 'package' + (header.name === '.' ? '' : '/' + header.name);
      delete header.uid;
      delete header.gid;
      return header;
    }
  });
  return {
    files: includedFiles,
    stream: tarStream
  };
}

export default async function publish (project: Project, opts: PublishOptions) {
  const registry = project.defaultRegistry;
  const pjson: any = project.config.pjson._original;
  const { name, version } = project.config.pjson;
  if (typeof pjson.name !== 'string')
    throwFieldMissing('name');
  if (!name.match(validPkgNameRegEx))
    throwFieldInvalid(name, 'package name');
  if (typeof version !== 'string')
    throwFieldMissing('version');
  try {
    new Semver(version);
  }
  catch (e) {
    throwFieldInvalid(version, 'semver version');
  }
  if (project.config.pjson.private)
    throw new JspmUserError(`Package configured as ${bold('private')} cannot be published.`);
  if (typeof pjson.license !== 'string')
    throwFieldMissing('license');
  if (!spdxLicenses.has(pjson.license))
    throwFieldInvalid(pjson.license, 'spdx license');
  if (typeof pjson.main !== 'string')
    project.log.warn(`No package ${bold("main")} provided.`);

  const pkg: PackageName = { registry, name, version };

  // pjson filtering to avoid unnecessary data
  delete pjson.devDependencies;
  delete pjson.overrides;

  const { files, stream } = pack(project, await createFilesFilter(project.projectPath, pjson.files, pjson.ignore));

  // log the files
  let logged = false;
  function logFiles () {
    // TODO: an actual tree logger!
    if (logged) return;
    logged = true;
    let last: string = undefined;
    let first = true;
    for (const file of files.sort()) {
      if (last) {
        if (first) {
          project.log.info(`┌ ${last}`);
          first = false;
        }
        else {
          project.log.info(`├ ${last}`);
        }
      }
      last = file;
    }
    if (last)
      project.log.info(`└ ${last}`);
  }
  stream.on('end', logFiles);

  await project.registryManager.publish(project.projectPath, pkg.registry, pjson, stream, {
    access: opts.public && 'public',
    tag: opts.tag,
    otp: opts.otp
  });

  logFiles();

  project.log.ok(`Successfully published ${highlight(pkg.registry + ':' + pkg.name + '@' + pkg.version)}`);
}
