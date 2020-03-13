import { pathToFileURL, fileURLToPath } from 'url';
import { TraceMap } from './tracemap';
import { fetch } from './fetch';
import lexer from 'es-module-lexer';
import { systemCdnUrl, esmCdnUrl } from './installtree';
import terser from 'terser';

export default ({
  map,
  baseUrl = pathToFileURL(process.cwd() + '/').href,
  system,
  externals,
  inlineMaps
}: { map: any, system?: boolean, baseUrl: URL | string, externals?: string[], inlineMaps?: boolean }) => {
  if (typeof baseUrl === 'string')
    baseUrl = new URL(baseUrl);

  if (!baseUrl.href.endsWith('/'))
    baseUrl.href += '/';

  let minifyUrls = new Set(), externalUrls = new Set();

  return {
    name: 'jspm-rollup',
    options (opts) {
      opts.output = opts.output || {};
      opts.output.interop = false;
      this.sourcemap = opts.output.sourcemap;
      return opts;
    },
    buildStart () {
      const traceMap = new TraceMap(map, baseUrl);
      this.traceMap = traceMap;
      minifyUrls = new Set();
      if (externals) {
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
      const resolved = this.traceMap.resolve(specifier, parent || baseUrl);
      if (resolved === null) return '@empty';
      let id = resolved.href;
      if (id.startsWith(systemCdnUrl))
        id = esmCdnUrl + id.slice(systemCdnUrl.length);
      const external = externalUrls.has(id);
      if (resolved.protocol === 'file:')
        id = fileURLToPath(resolved);
      else if (system && externalUrls.has(id))
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
      const res = await fetch(url);
      switch (res.status) {
        case 200: break;
        case 404: throw new Error(`Module not found: ${url}`);
        default: throw new Error(`Invalid status code ${res.status} loading ${url}. ${res.statusText}`);
      }
      let source = await res.text();
      try {
        await lexer.parse(source);
        return source;
      }
      catch (e) {
        // fetch is _unstable_!!!
        // so we retry the fetch first
        const res = await fetch(url);
        switch (res.status) {
          case 200: break;
          case 404: throw new Error(`Module not found: ${url}`);
          default: throw new Error(`Invalid status code ${res.status} loading ${url}. ${res.statusText}`);
        }
        return await res.text();
      }
    },
    transform (code, url) {
      if (!minifyUrls.has(url)) return code;
      return terser.minify(code, { sourceMap: this.sourcemap });
    }
  };
};
