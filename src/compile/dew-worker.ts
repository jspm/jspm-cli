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
import { isValidIdentifier } from "../utils/common";
import * as babel from '@babel/core';
import * as path from 'path';
import * as fs from 'graceful-fs';
import * as dewTransformPlugin from 'babel-plugin-transform-cjs-dew';
import { relativeResolve, toDew, isESM } from "./dew-resolve";

const stage3Syntax = ['asyncGenerators', 'classProperties', 'classPrivateProperties', 'classPrivateMethods', 'optionalCatchBinding', 'objectRestSpread', 'numericSeparator', 'dynamicImport', 'importMeta'];

function tryParseCjs (source) {
  const requires = new Set();
  let hasProcess, hasBuffer;
  const { ast } = babel.transform(source, {
    ast: true,
    babelrc: false,
    highlightCode: false,
    compact: false,
    sourceType: 'script',
    parserOpts: {
      allowReturnOutsideFunction: true,
      plugins: stage3Syntax
    },
    plugins: [({ types: t }) => {
      function resolvePartialWildcardString (node, lastIsWildcard) {
        if (t.isStringLiteral(node))
          return node.value;
        if (t.isTemplateLiteral(node)) {
          let str = '';
          for (let i = 0; i < node.quasis.length; i++) {
            const quasiStr = node.quasis[i].value.cooked;
            if (quasiStr.length) {
              str += quasiStr;
              lastIsWildcard = false;
            }
            const nextNode = node.expressions[i];
            if (nextNode) {
              const nextStr = resolvePartialWildcardString(nextNode, lastIsWildcard);
              if (nextStr.length) {
                lastIsWildcard = nextStr.endsWith('*');
                str += nextStr;
              }
            }
          }
          return str;
        }
        if (t.isBinaryExpression(node) && node.operator === '+') {
          const leftResolved = resolvePartialWildcardString(node.left, lastIsWildcard);
          if (leftResolved.length)
            lastIsWildcard = leftResolved.endsWith('*');
          const rightResolved = resolvePartialWildcardString(node.right, lastIsWildcard);
          return leftResolved + rightResolved;
        }
        return lastIsWildcard ? '' : '*';
      }

      return {
        visitor: {
          ReferencedIdentifier (path) {
            const identifierName = path.node.name;
            if (!hasProcess && identifierName === 'process' && !path.scope.hasBinding('process'))
              hasProcess = true;
            if (!hasBuffer && identifierName === 'Buffer' && !path.scope.hasBinding('Buffer'))
              hasBuffer = true;
          },
          CallExpression (path) {
            if (t.isIdentifier(path.node.callee, { name: 'require' })) {
              let arg = path.node.arguments[0];
              const req = resolvePartialWildcardString(arg, false);
              if (req !== '*')
                requires.add(req);
            }
          }
        }
      };
    }]
  });
  if (hasProcess && !requires.has('process'))
    requires.add('process');
  if (hasBuffer && !requires.has('buffer'))
    requires.add('buffer');
  return { ast, requires };
}

function transformDew (ast, source, resolveMap) {
  const { code: dewTransform } = babel.transformFromAst(ast, source, {
    babelrc: false,
    highlightCode: false,
    compact: false,
    sourceType: 'script',
    parserOpts: {
      allowReturnOutsideFunction: true,
      plugins: stage3Syntax
    },
    plugins: [[dewTransformPlugin, {
      resolve: (name, opts) => {
        if ((opts.optional || opts.wildcard) && !resolveMap[name])
          return null;
        return resolveMap[name];
      },
      wildcardExtensions: ['.js', '.json', '.node'],
      esmDependencies: resolved => isESM(resolved),
      filename: `import.meta.url.startsWith('file:') ? decodeURI(import.meta.url.slice(7 + (typeof process !== 'undefined' && process.platform === 'win32'))) : new URL(import.meta.url).pathname`,
      dirname: `import.meta.url.startsWith('file:') ? decodeURI(import.meta.url.slice(0, import.meta.url.lastIndexOf('/')).slice(7 + (typeof process !== 'undefined' && process.platform === 'win32'))) : new URL(import.meta.url.slice(0, import.meta.url.lastIndexOf('/'))).pathname`
    }]]
  });
  return dewTransform;
}

interface DewResult {
  err: any;
  hashbang?: boolean;
}

const hashbangRegEx = /#!\s*([^\s]+)\s*([^\s]+)?/;

const largeHexArrayRegEx = /\[\s*(0x[0-9a-f]+,\s*){100000}/;

async function tryCreateDew (filePath, pkgBasePath, files, main, folderMains, localMaps, deps, name): Promise<DewResult> {
  const dewPath = filePath.endsWith('.js') ? filePath.substr(0, filePath.length - 3) + '.dew.js' : filePath + '.dew.js';
  const result = {
    err: undefined,
    hashbang: false
  };
  try {
    let source = await new Promise<string>((resolve, reject) => fs.readFile(filePath, (err, source) => err ? reject(err) : resolve(source.toString())));

    const hashbangMatch = source.match(hashbangRegEx);
    if (hashbangMatch)
      result.hashbang = true;

    // <CHEATS>
    {
      // Babel stalls on large hex arrays
      if (source.match(largeHexArrayRegEx)) {
        const dewTransform = `var exports = {}, module = { exports: exports }, _dewExec = false;
export function dew() {
  if (_dewExec) return module.exports;
    _dewExec = true;
${source};
  return module.exports;
}`;
        await new Promise((resolve, reject) => fs.writeFile(dewPath, dewTransform, err => err ? reject(err) : resolve()));
        return result;
      }
      // bindings customization
      if (name === 'bindings') {
        // stack file name detection
        let stackFileNameIndex = source.indexOf('Error.prepareStackTrace = function (e, st)');
        if (stackFileNameIndex !== -1) {
          stackFileNameIndex = source.indexOf('st[i].getFileName()', stackFileNameIndex);
          if (stackFileNameIndex !== -1) {
            stackFileNameIndex += 19;
            source = source.substr(0, stackFileNameIndex) + '.substr(7 + (process.platform === \'win32\'))' + source.substr(stackFileNameIndex);
          }
        }
      }
    }
    // </CHEATS>

    var { ast, requires } = tryParseCjs(source);
    
    const resolveMap = {};
    for (const require of requires) {
      if (require.indexOf('*') === -1) {
        resolveMap[require] = relativeResolve(require, filePath, pkgBasePath, files, main, folderMains, localMaps, deps, name);
      }
      else {
        // we can only wildcard resolve internal requires
        if (!require.startsWith('./') && !require.startsWith('../'))
          continue;
        const wildcardPath = path.relative(pkgBasePath, path.resolve(filePath.substr(0, filePath.lastIndexOf(path.sep)), require)).replace(/\\/g, '/');
        const wildcardPattern = new RegExp('^' + wildcardPath.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'));
        const matches = Object.keys(files).filter(file => file.match(wildcardPattern) && (file.endsWith('.js') || file.endsWith('.json') || file.endsWith('.node')));
        const relFile = path.relative(pkgBasePath, path.resolve(filePath.substr(0, filePath.lastIndexOf(path.sep))));
        resolveMap[require] = matches.map(match => {
          let relPath = path.relative(relFile, match).replace(/\\/g, '/');
          if (relPath === '')
            relPath = './' + filePath.substr(filePath.lastIndexOf('/') + 1);
          else if (!relPath.startsWith('../'))
            relPath = './' + relPath;
          requires.add(relPath);
          return relPath;
        });
      }
    }
    const dewTransform = transformDew(ast, source, resolveMap);
    await new Promise((resolve, reject) => fs.writeFile(dewPath, dewTransform, err => err ? reject(err) : resolve()));
  }
  catch (err) {
    if (err instanceof SyntaxError && err.toString().indexOf('sourceType: "module"') !== -1)
      return { err: true };
    if (filePath.endsWith('.js')) {
      try {
        const dewTransform = `export function dew () {\n  throw new Error("Error converting CommonJS file ${name + filePath.substr(pkgBasePath.length)}, please post a jspm bug with this message.\\n${JSON.stringify(err.stack || err.toString()).slice(1, -1)}");\n}\n`;
        await new Promise((resolve, reject) => fs.writeFile(dewPath, dewTransform, err => err ? reject(err) : resolve(result)));
      }
      catch (e) {
        return { err: true };
      }
      return result;
    }
    return { err: true };
  }
  return result;
}

async function createJsonDew (filePath) {
  try {
    const source = await new Promise<string>((resolve, reject) => fs.readFile(filePath, (err, source) => err ? reject(err) : resolve(source.toString())));

    let dewTransform: string;
    try {
      let parsed = JSON.parse(source);
      dewTransform = `export function dew () {\n  return exports;\n}\nvar exports = ${JSON.stringify(parsed)};\n`;
    }
    catch (err) {
      dewTransform = `export function dew () {\n  throw new SyntaxError(${JSON.stringify(err.message)});\n}\n`;
    }

    await new Promise((resolve, reject) => fs.writeFile(filePath + '.dew.js', dewTransform, err => err ? reject(err) : resolve()));
  }
  catch (err) {
    return true;
  }
}

module.exports = function convert (name: string, dir: string, files: Record<string, boolean>, main: string, folderMains: Record<string, string>, namedExports: Record<string, string[]>, localMaps: Record<string, boolean>, deps: Record<string, boolean>, callback) {
  return Promise.resolve()
  .then(async function () {
    const dewWithoutExtensions = Object.create(null);
    const conversionPromises = [];
    const esmWrapperPromises = [];

    // - create .dew.js with precedence of X beating X.js
    // - .json.dew.js for JSON files
    // - replaces the original ".js" file with the ESM form (except for ".json" files)
    // - on a processing error, leaves the original ".js" file and creates a ".dew.js" throwing the error
    for (const file of Object.keys(files).sort()) {
      // because these are sorted, "x" will come before "x.js"
      // so if x is valid js, we skip x.js conversion
      if (file.endsWith('.js') && dewWithoutExtensions[file.substr(0, file.length - 3)])
        continue;
      if (files[file] === false)
        continue;

      if (file.endsWith(('.json'))) {
        // creates file.json.dew.js
        conversionPromises.push(createJsonDew(path.resolve(dir, file)).then(err => {
          if (err)
            return;
          // all json files also get a ".json.js" entry for convenience
          esmWrapperPromises.push(writeESMWrapper(dir, file + '.js', toDew(path.basename(file)), namedExports, false));
        }));
      }
      else {
        // we attempt to create dew for all files as CommonJS can import any file extension as CommonJS
        // this will also fail if a file is already occupying the file.dew.js spot
        // on error, file.dew.js is populated with the error
        conversionPromises.push(tryCreateDew(path.resolve(dir, file), dir, files, main, folderMains, localMaps, deps, name).then(result => {
          if (result.err)
            return;
          // exports should be passed as an argument here supporting both names, and star exports which are in turn provided from the esm of the star (internal or external)
          if (!file.endsWith('.js'))
            dewWithoutExtensions[file] = true;
          esmWrapperPromises.push(writeESMWrapper(dir, file, toDew(path.basename(file)), namedExports, result.hashbang));
        }));
      }
    }

    await Promise.all(conversionPromises);
    await Promise.all(esmWrapperPromises);
  })
  .then(callback, callback);
}

function writeESMWrapper (dir: string, file: string, dewFile: string, namedExports: Record<string, string[]>, hashbang: boolean): Promise<void> {
  let esmWrapperSource = '';
  if (hashbang) {
    esmWrapperSource += '#!/usr/bin/env jspm\n';
  }
  if (namedExports && namedExports[file]) {
    const exportNames = namedExports[file].filter(name => isValidIdentifier(name) && name !== 'default');
    esmWrapperSource += `import { dew } from './${dewFile}';\nconst exports = dew();\nexport default exports;\nexport const ${
      exportNames.map(name => `${name} = exports.${name}`).join(', ')
    };\n`;
  } else {
    esmWrapperSource += `import { dew } from './${dewFile}';\nexport default dew();\n`;
  }
  return new Promise((resolve, reject) => 
    fs.writeFile(path.resolve(dir, file), esmWrapperSource, err => err ? reject(err) : resolve())
  );
}
