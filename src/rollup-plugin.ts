import { pathToFileURL, fileURLToPath } from 'url';
import { TraceMap } from './tracemap';
import { fetch } from './fetch';
import { parse } from 'es-module-lexer';
import { systemCdnUrl, esmCdnUrl } from './installtree';
import * as terser from 'terser';
import { DecoratedError, isPlain, isURL } from './utils';
import chalk from 'chalk';
import * as babel from '@babel/core';
import babelPluginTransformTypeScript from '@babel/plugin-transform-typescript';
import babelPluginSyntaxClassProperties from '@babel/plugin-syntax-class-properties';
import babelPluginNumericSeparator from '@babel/plugin-proposal-numeric-separator';
import babelPluginProposalExportDefaultFrom from '@babel/plugin-proposal-export-default-from';
import babelPluginProposalExportNamespaceFrom from '@babel/plugin-proposal-export-namespace-from';
import babelPluginTransformReactJsx from '@babel/plugin-transform-react-jsx';

const stage3Syntax = ['asyncGenerators', 'classProperties', 'classPrivateProperties', 'classPrivateMethods', 'dynamicImport', 'importMeta', 'nullishCoalescingOperator', 'numericSeparator', 'optionalCatchBinding', 'optionalChaining', 'objectRestSpread', 'topLevelAwait'];

export default ({
  map,
  baseUrl = pathToFileURL(process.cwd() + '/').href,
  fetchOpts,
  format,
  externals,
  inlineMaps,
  minify,
  sourceMap
}: { map: any, minify: boolean, format?: string, baseUrl: URL | string, externals?: boolean | string[], inlineMaps?: boolean, sourceMap?: boolean, fetchOpts: any }) => {
  if (typeof baseUrl === 'string')
    baseUrl = new URL(baseUrl);

  if (!baseUrl.href.endsWith('/'))
    baseUrl.href += '/';

  let minifyUrls = new Set(), externalUrls = new Set();

  return {
    name: 'jspm-rollup',
    buildStart () {
      const traceMap = new TraceMap(baseUrl, map);
      this.traceMap = traceMap;
      minifyUrls = new Set();
      if (externals && typeof externals !== 'boolean') {
        externalUrls = new Set();
        for (const external of externals) {
          const resolvedExternal = traceMap.resolve(external, <URL>baseUrl);
          if (resolvedExternal === null) continue;
          let resolvedExternalUrl = resolvedExternal.href;
          if (resolvedExternalUrl.startsWith(systemCdnUrl))
            resolvedExternalUrl = esmCdnUrl + resolvedExternalUrl.slice(systemCdnUrl.length);
          externalUrls.add(resolvedExternalUrl);
        }
      }
    },
    async resolveId (specifier, parent) {
      if (externals === true && isPlain(specifier)) {
        return { id: specifier, external: true };
      }
      const parentUrl: URL = parent ? (parent[0] !== '/' && isURL(parent) && !parent.match(/^\w:/) ? new URL(parent) : pathToFileURL(parent)) : baseUrl as URL;
      let resolved;
      try {
        resolved = this.traceMap.resolve(specifier, parentUrl);
      }
      catch (e) {
        try {
          if (parentUrl.origin + '/' !== esmCdnUrl)
            throw e;
          resolved = this.traceMap.resolve(specifier, new URL(systemCdnUrl + parentUrl.pathname.slice(1)));
        }
        catch (e) {
          if ((<DecoratedError>e).code === 'MODULE_NOT_FOUND' && isPlain(specifier)) {
            console.warn(`\n${chalk.yellow('warn')} Unable to resolve ${chalk.bold(specifier)}, treating as external.`);
            return { id: specifier, external: true };
          }
          else {
            throw e;
          }
        }
      }
      if (resolved === null) return '@empty';
      let id = resolved.href;
      if (id.startsWith(systemCdnUrl))
        id = esmCdnUrl + id.slice(systemCdnUrl.length);
      const external = externalUrls.has(id);
      if (resolved.protocol === 'file:')
        id = fileURLToPath(resolved);
      else if (format === 'system' && externalUrls.has(id))
        id = systemCdnUrl + id.slice(esmCdnUrl.length);
      return { id: !external || inlineMaps ? id : specifier, external };
    },
    async load (url: string) {
      if (url === '@empty') return '';
      if (!url.startsWith(systemCdnUrl) && !url.startsWith(esmCdnUrl))
        minifyUrls.add(url);
      if (url[1] === ':') {
        url = pathToFileURL(url).href;
      }
      else {
        try {
          new URL(url);
        }
        catch (e) {
          url = pathToFileURL(url).href;
        }
      }
      const res = await fetch(url, fetchOpts);
      switch (res.status) {
        case 200: case 304: break;
        case 404: throw new Error(`Module not found: ${url}`);
        default: throw new Error(`Invalid status code ${res.status} loading ${url}. ${res.statusText}`);
      }
      let source = await res.text();
      try {
        await parse(source);
        return source;
      }
      catch (e) {
        // fetch is _unstable_!!!
        // so we retry the fetch first
        const res = await fetch(url, fetchOpts);
        switch (res.status) {
          case 200: break;
          case 404: throw new Error(`Module not found: ${url}`);
          default: throw new Error(`Invalid status code ${res.status} loading ${url}. ${res.statusText}`);
        }
        return await res.text();
        
      }
    },
    async transform (code, url) {
      if (url.endsWith('.ts') || url.endsWith('.tsx') || url.endsWith('.jsx')) {
        var result = babel.transform(code, {
          filename: url,
          inputSourceMap: false,
          ast: false,
          babelrc: false,
          babelrcRoots: false,
          configFile: false,
          highlightCode: false,
          compact: false,
          sourceType: 'module',
          sourceMaps: true,
          parserOpts: {
            plugins: stage3Syntax,
            errorRecovery: true
          },
          plugins: url.endsWith('.ts') ? tsPlugins : url.endsWith('.tsx') ? tsxPlugins : jsxPlugins
        });
      }
      if (!result)
        result = { code, map: true };
      if (!minify) return result;
      if (!minifyUrls.has(url)) return result;
      var result = await terser.minify(result.code, { sourceMap: sourceMap && result.map });
      if (result.error)
        return code;
      return result;
    }
  };
};

const tsPlugins = [
  [babelPluginTransformTypeScript, {
    onlyRemoveTypeImports: true
  }],
  babelPluginProposalExportDefaultFrom,
  babelPluginProposalExportNamespaceFrom,
  babelPluginSyntaxClassProperties,
  babelPluginNumericSeparator
];
const tsxPlugins = [
  [babelPluginTransformTypeScript, {
    isTSX: true,
    onlyRemoveTypeImports: true
  }],
  babelPluginTransformReactJsx,
  babelPluginProposalExportDefaultFrom,
  babelPluginProposalExportNamespaceFrom,
  babelPluginSyntaxClassProperties,
  babelPluginNumericSeparator
];
const jsxPlugins = [
  babelPluginTransformReactJsx,
  babelPluginProposalExportDefaultFrom,
  babelPluginProposalExportNamespaceFrom,
  babelPluginSyntaxClassProperties,
  babelPluginNumericSeparator
];
