import { ImportMap } from "./tracemap";
import { fetch } from './fetch.js';
import crypto from 'crypto';
import os from 'os';
import { parse } from './script-lexer.js';

/*
 *   Copyright 2020 Guy Bedford
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

export let baseUrl: URL;
if (typeof process !== 'undefined' && process.versions.node) {
  baseUrl = new URL('file://' + process.cwd() + '/');
}
else if (typeof document !== 'undefined') {
  const baseEl: HTMLBaseElement | null = document.querySelector('base[href]');
  if (baseEl)
    baseUrl = new URL(baseEl.href + (baseEl.href.endsWith('/') ? '' : '/'));
  else if (typeof location !== 'undefined')
    baseUrl = new URL('../', new URL(location.href));
}

export interface DecoratedError extends Error {
  code: string;
}

export function decorateError (err: Error, code: string): DecoratedError {
  const decorated = <DecoratedError>err;
  decorated.code = code;
  return decorated;
}

export function deepClone (obj) {
  const outObj = Object.create(null);
  for (const p of Object.keys(obj)) {
    const val = obj[p];
    if (Array.isArray(val))
      outObj[p] = [...val];
    else if (typeof val === 'object' && val !== null)
      outObj[p] = deepClone(val);
    else
      outObj[p] = val;
  }
  return outObj;
}

export function alphabetize<T> (obj: T): T {
  const out: T = <T>{};
  for (const key of Object.keys(obj).sort())
    out[key] = obj[key];
  return out;
}

export interface JsonStyle {
  tab: string,
  newline: string,
  trailingNewline: string,
  indent: string,
  quote: string
};

export const defaultStyle = {
  tab: '  ',
  newline: os.EOL,
  trailingNewline: os.EOL,
  indent: '',
  quote: '"'
};

export function detectStyle (string: string): JsonStyle {
  let style = Object.assign({}, defaultStyle);

  let newLineMatch = string.match( /\r?\n|\r(?!\n)/);
  if (newLineMatch)
    style.newline = newLineMatch[0];

  // best-effort tab detection
  // yes this is overkill, but it avoids possibly annoying edge cases
  let lines = string.split(style.newline);
  let indent;
  for (const line of lines) {
    const curIndent = line.match(/^\s*[^\s]/);
    if (curIndent && (indent === undefined || curIndent.length < indent.length))
      indent = curIndent[0].slice(0, -1);
  }
  if (indent !== undefined)
    style.indent = indent;
  lines = lines.map(line => line.slice(indent.length));
  let tabSpaces = lines.map(line => line.match(/^[ \t]*/)?.[0] || '') || [];
  let tabDifferenceFreqs = {};
  let lastLength = 0;
  tabSpaces.forEach(tabSpace => {
    let diff = Math.abs(tabSpace.length - lastLength);
    if (diff !== 0)
      tabDifferenceFreqs[diff] = (tabDifferenceFreqs[diff] || 0) + 1;
    lastLength = tabSpace.length;
  });
  let bestTabLength;
  Object.keys(tabDifferenceFreqs).forEach(tabLength => {
    if (!bestTabLength || tabDifferenceFreqs[tabLength] >= tabDifferenceFreqs[bestTabLength])
      bestTabLength = tabLength;
  });
  // having determined the most common spacing difference length,
  // generate samples of this tab length from the end of each line space
  // the most common sample is then the tab string
  let tabSamples = {};
  tabSpaces.forEach(tabSpace => {
    let sample = tabSpace.substr(tabSpace.length - bestTabLength);
    tabSamples[sample] = (tabSamples[sample] || 0) + 1;
  });
  let bestTabSample;
  Object.keys(tabSamples).forEach(sample => {
    if (!bestTabSample || tabSamples[sample] > tabSamples[bestTabSample])
      bestTabSample = sample;
  });

  if (bestTabSample)
    style.tab = bestTabSample;

  let quoteMatch = string.match(/"|'/);
  if (quoteMatch)
    style.quote = quoteMatch[0];

  style.trailingNewline = string && string.match(new RegExp(style.newline + '$')) ? style.newline : '';

  return style;
}

export function jsonEquals (sourceA: string | object, sourceB: string | object): boolean {
  if (typeof sourceA === 'string') {
    try {
      sourceA = JSON.parse(sourceA);
    }
    catch (e) {
      return false;
    }
  }
  if (typeof sourceB === 'string') {
    try {
      sourceB = JSON.parse(sourceB);
    }
    catch (e) {
      return false;
    }
  }
  return JSON.stringify(sourceA) === JSON.stringify(sourceB);
}

export function jsonParseStyled (source: string, fileName?: string): { json: any, style: JsonStyle } {
  // remove any byte order mark
  if (source.startsWith('\uFEFF'))
    source = source.substr(1);

  let style = detectStyle(source);
  try {
    return { json: JSON.parse(source), style };
  }
  catch (e) {
    throw new Error(`Error parsing JSON file${fileName ? ' ' + fileName : ''}`);
  }
}

export function jsonStringifyStyled (json, style: JsonStyle) {
  let jsonString = JSON.stringify(json, null, style.tab);

  return style.indent + jsonString
      .replace(/([^\\])""/g, '$1' + style.quote + style.quote) // empty strings
      .replace(/([^\\])"/g, '$1' + style.quote)
      .replace(/\n/g, style.newline + style.indent) + (style.trailingNewline || '');
}

export interface SrcScript { src: string, type: string | undefined, integrity?: string, crossorigin?: boolean, jspmCast: boolean };
export interface SrcScriptParse extends SrcScript { start: number, end: number, srcStart: number, srcEnd: number, typeStart: number, typeEnd: number, integrityStart: number, integrityEnd: number };
export function readHtmlScripts (source: string, fileName: string) {
  const scripts = parse(source);
  let typeAttr;
  let importMap = scripts.find(script => {
    return script.attributes.some(attr => {
      const { nameStart, nameEnd, valueStart, valueEnd } = attr;
      if (source.slice(nameStart, nameEnd) !== 'type')
        return false;
      const type = source.slice(valueStart, valueEnd);
      if (type === 'systemjs-importmap' || type === 'importmap-shim' || type === 'importmap') {
        typeAttr = attr;
        return true;
      }
    });
  });
  if (!importMap) {
    importMap = { innerStart: -1, innerEnd: -1, start: -1, end: -1, attributes: [] };
    typeAttr = { valueStart: -1, valueEnd: -1 };
  }
  const hasSrc = importMap.attributes.some(({ nameStart, nameEnd, valueStart, valueEnd }) =>
    source.slice(nameStart, nameEnd) === 'src' && source.slice(valueStart, valueEnd)
  );
  if (hasSrc)
    throw new Error(`${fileName} references an external import map. Rather install from/to this file directly, or remove the src attribute to use an inline import map.`);
  const srcScripts: SrcScriptParse[] = scripts.map(script => {
    let src, type, srcStart, srcEnd, integrityStart = -1, integrityEnd = -1, typeStart = -1, typeEnd = -1, jspmCast = false;
    for (const attr of script.attributes) {
      switch (source.slice(attr.nameStart, attr.nameEnd)) {
        case 'src':
          if (!src && attr.valueStart !== -1) {
            srcStart = attr.valueStart;
            srcEnd = attr.valueEnd;
            src = source.slice(srcStart, srcEnd);
          }
          break;

        case 'type':
          if (type === undefined) {
            if (attr.valueStart === -1) {
              type === null;
              typeStart = attr.nameEnd;
              typeEnd = attr.nameEnd;
            }
            else {
              type = source.slice(attr.valueStart, attr.valueEnd);
              typeStart = attr.nameStart;
              typeEnd = attr.valueEnd;
            }
          }
          break;

        case 'integrity':
          if (integrityStart === -1 && attr.valueStart !== -1) {
            integrityStart = attr.valueStart;
            integrityEnd = attr.valueEnd;
          }
          break;

        case 'jspm-cast':
          if (!jspmCast)
            jspmCast = true;
          break;
      }
    }
    if (!src) {
      srcStart = script.innerStart;
      srcEnd = script.innerEnd;
    }
    if (!type || type === 'module')
      return { src, type, start: script.start, end: script.end, srcStart, srcEnd, integrityStart, integrityEnd, typeStart, typeEnd, jspmCast };
  }).filter(script => script);
  return {
    type: [typeAttr.valueStart, typeAttr.valueEnd],
    map: [importMap.innerStart, importMap.innerEnd, importMap.start, importMap.end],
    srcScripts
  };
}

export function sort (map: ImportMap) {
  const sorted: ImportMap = {
    imports: alphabetize(map.imports),
    scopes: alphabetize(map.scopes),
    depcache: alphabetize(map.depcache),
    integrity: alphabetize(map.integrity)
  };
  for (const scope of Object.keys(sorted.scopes))
    sorted.scopes[scope] = alphabetize(sorted.scopes[scope]);
  return sorted;
}

export function isURL (specifier: string) {
  if (specifier.startsWith('/'))
    return true;
  try {
    new URL(specifier);
  }
  catch {
    return false;
  }
  return true;
}

export function isPlain (specifier: string) {
  if (specifier.startsWith('./') || specifier.startsWith('../'))
    return false;
  return !isURL(specifier);
}

export function computeIntegrity (source: string) {
  const hash = crypto.createHash('sha384');
  hash.update(source);
  return 'sha384-' + hash.digest('base64');
}

export async function getIntegrity (url: string) {
  const res = await fetch(url);
  switch (res.status) {
    case 200: case 304: break;
    case 404: throw new Error(`URL ${url} not found.`);
    default: throw new Error(`Invalid status code ${res.status} requesting ${url}. ${res.statusText}`);
  }
  return computeIntegrity(await res.text());
}

export function getPackageName (specifier: string, parentUrl: URL) {
  let sepIndex = specifier.indexOf('/');
  if (specifier[0] === '@') {
    if (sepIndex === -1)
      throw new Error(`${specifier} is not an invalid scope name${importedFrom(parentUrl)}.`);
    sepIndex = specifier.indexOf('/', sepIndex + 1);
  }
  return sepIndex === -1 ? specifier : specifier.slice(0, sepIndex);
}

export function importedFrom (parentUrl?: URL) {
  if (!parentUrl) return '';
  let importedFrom;
  if (parentUrl.protocol === 'file:')
    importedFrom = decodeURIComponent(parentUrl.pathname[2] === ':' ? parentUrl.pathname.slice(1) : parentUrl.pathname);
  else {
    importedFrom = new URL(parentUrl.href);
    importedFrom.pathname = importedFrom.pathname.replace(/:/g, '%3A').replace(/@/g, '%40');
  }
  return ` imported from ${importedFrom}`;
}

export function injectInHTML(outSource: string, outMapFile: string, tagToInject: string) {
  const {  map: [, , importMapStart,] }  = readHtmlScripts(outSource, outMapFile);
  return outSource.slice(0, importMapStart) + detectSpace(outSource, importMapStart) + `${tagToInject} \n` + outSource.slice(importMapStart, outSource.length);  
}

export function detectSpace(outSource: string, atIndex: number) {
  let space = '';
  if (outSource === '') {
    space = '\n';
  } else if (atIndex !== -1) {
    const nl = outSource.indexOf('\n', 0);
    if (nl !== -1) {
      const detectedSpace = outSource.slice(atIndex, nl + 1);
      if (detectedSpace.match(/\s*/))
        space = detectedSpace;
    }
  } else {
    space = '\n';
  }
  return space;
}