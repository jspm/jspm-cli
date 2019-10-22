import { highlight, JspmUserError, getUniqueName, dirWalk } from '../utils/common';
import { build, Project } from '../api';
import { BuildOptions } from '.';
import path = require('path');
import { createFilesFilter } from '../utils/pjson';
import fs = require('fs');
import events = require('events');
import { readJSONStyled, writeJSONStyled } from '../config/config-file';
import mkdirp = require('mkdirp');
import jspmResolve = require('@jspm/resolve');

const once = (<any>events).once;

const stringFields = ['main', 'bin', 'browser', 'module', 'jsnext:main'];

export async function buildPackage (project: Project, opts: BuildOptions) {
  const { json: pjson, style } = await readJSONStyled(project.projectPath + '/package.json');
  if (!pjson)
    throw new JspmUserError(`No package.json found for package ${highlight(project.projectPath)}.`);

  if (!opts.format)
    opts.format = pjson.format === 'commonjs' || pjson.format === 'module' ? pjson.format : 'commonjs';

  if (!opts.dir) {
    opts.dir = typeof pjson.directories === 'object' && typeof pjson.directories.dist === 'string' ? pjson.directories.dist : 'dist';
    opts.clearDir = true;
  }
  if (path.resolve(opts.dir) === path.resolve(project.projectPath))
    throw new JspmUserError(`Build output directory must be a different directory to the package path ${highlight(project.projectPath)}.`);

  const exports = pjson.exports;
  const main = typeof exports === 'string' ? exports : pjson.main;
  if (typeof exports !== 'object' && typeof main !== 'string')
    throw new JspmUserError(`No exports or main defined for package ${highlight(project.projectPath)}.`);
  
  const buildInput = {};
  if (typeof exports === 'object')
    for (const expt of Object.keys(exports)) {
      const exptPath = exports[expt];
      if (exptPath.endsWith('/') || !expt.startsWith('./'))
        continue;
      buildInput[expt.slice(2)] = exptPath;
    }

  if (typeof pjson.bin === 'string')
    pjson.bin = { [pjson.name || 'bin']: pjson.bin };
  for (const [name, bin] of Object.entries(pjson.bin)) {
    if (typeof bin !== 'string')
      continue;
    buildInput[name] = jspmResolve.sync(bin, project.projectPath + '/', { isMain: true }).resolved;
  }

  let mainName;
  if (main) {
    const mainAlias = pjson.name === 'string' ? pjson.name : 'index';
    mainName = getUniqueName(mainAlias, '', buildInput);
    buildInput[mainName] = !main.startsWith('./') ? './' + main : main;
  }

  opts.mapBase = project.projectPath;
  const map = await build(buildInput, opts);
  const { imports } = map;

  // create the output package.json file
  const outPjson = Object.assign({}, pjson);
  delete outPjson.devDependencies;
  delete outPjson.directories;
  delete outPjson.files;

  // apply import map to: exports / main / module / browser / jsnext:main / bin
  function tryRenormalize (obj, key) {
    const val = obj[key];
    if (typeof val === 'string') {
      if (val.startsWith('./')) {
        if (val in imports) {
          let relResolved = path.relative(opts.dir, path.resolve(project.projectPath, imports[val])).replace(/\\/g, '/');
          if (!relResolved.startsWith('../'))
            relResolved = './' + relResolved;
          obj[key] = relResolved;
        }
      }
      else if ('./' + val in imports) {
        let relResolved = path.relative(opts.dir, path.resolve(project.projectPath, imports['./' + val])).replace(/\\/g, '/');
        if (!relResolved.startsWith('../'))
          relResolved = './' + relResolved;
        obj[key] = relResolved;
      }
    }
  }
  for (const field of stringFields)
    tryRenormalize(outPjson, field);

  if (typeof outPjson.bin === 'object') {
    for (var p in outPjson.bin) {
      tryRenormalize(outPjson.bin, p);
      const binPath = path.resolve(outPjson.bin[p]);
      let source;
      try {
        source = fs.readFileSync(binPath);
      }
      catch (e) {
        continue;
      }
      // add hash bang
      // Note: this will offset sourcemaps
      fs.writeFileSync(binPath, '#!/usr/bin/env node\n' + source.toString());
      // make bins executable
      fs.chmodSync(binPath, fs.statSync(binPath).mode | 0o111);
    }
  }

  // TODO
  // also trailing slash?
  if (outPjson.exports) {
    console.log('TODO: exports');
    outPjson.exports = false;
  }
  /*for (const expt of Object.keys(buildInput)) {
    const inputFile = buildInput[expt];
    if (inputFile.endsWith('/') || !inputFile.startsWith('./'))
      continue;
    const target = map.imports[inputFile];
    if (expt === mainName) {
      if (typeof outPjson.exports !== 'object')
        outPjson.exports['.'] = target;
      else
        outPjson.exports = target;
    }
    else {
      if (typeof outPjson.exports === 'string')
        outPjson.exports = { '.': outPjson.exports };
      else if (typeof outPjson.exports !== 'object')
        outPjson.exports = {};
      outPjson.exports[expt] = target;
    }
  }*/

  // copy files (warning if they clash with existing files first)
  let copyPromises = [];
  const ignoreFilter = await createFilesFilter(project.projectPath, pjson.files, pjson.ignore);
  await dirWalk(project.projectPath, (filePath, stats) => {
    if (filePath === project.projectPath)
      return;
    if (ignoreFilter(filePath))
      return true;
    if (!stats.isFile())
      return;
    copyPromises.push((async () => {
      const toPath = path.resolve(opts.dir, path.relative(project.projectPath, filePath));
      if (fs.existsSync(toPath)) {
        project.log.warn(`Unable to write "files" entry ${highlight(path.relative(project.projectPath, filePath))} as it already exists in the output folder.`);
        return;
      }
      await new Promise((resolve, reject) => mkdirp(path.dirname(toPath), err => err ? reject(err) : resolve()));
      const readStream = fs.createReadStream(filePath);
      const writeStream = fs.createWriteStream(toPath);
      readStream.pipe(writeStream);
      await once(writeStream, 'finish');
    })());
  });
  await Promise.all(copyPromises);
  await writeJSONStyled(path.resolve(opts.dir, 'package.json'), outPjson, style);
  return map;
}

