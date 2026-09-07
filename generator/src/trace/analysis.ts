import { JspmError } from '../common/err.js';
import { getIntegrity } from '../common/integrity.js';
import type { Import } from 'es-module-lexer';

export type Analysis =
  | AnalysisData
  | {
      parseError: JspmError | Error;
    };

export interface AnalysisData {
  deps: string[];
  dynamicDeps: string[];
  cjsLazyDeps: string[] | null;
  format: 'esm' | 'commonjs' | 'system' | 'json' | 'typescript' | 'wasm' | 'css';
  size: number;

  // for commonjs format, true iff the module uses a CJS-only global
  usesCjs?: boolean;
  integrity: `sha384-${string}`;
}

export { createTsAnalysis } from './ts.js';
export { createCjsAnalysis } from './cjs.js';

// Template literal dynamic imports are reported as globs, which cannot be traced
export function dynamicImportSpecifier(impt: Import): string | undefined {
  if (impt.type !== 'dynamic' || !impt.specifier || impt.specifier.includes('*')) return undefined;
  return impt.specifier;
}

export async function createEsmAnalysis(
  imports: ReadonlyArray<Import>,
  source: string,
  url: string
): Promise<Analysis> {
  // Change the return type to Promise<Analysis>
  if (!imports.length && systemMatch(source)) return createSystemAnalysis(source, imports, url);
  const deps: string[] = [];
  const dynamicDeps: string[] = [];
  for (const impt of imports) {
    if (impt.type === 'dynamic') {
      // dynamic import -> deoptimize trace all dependencies (and all their exports)
      const specifier = dynamicImportSpecifier(impt);
      if (specifier) dynamicDeps.push(specifier);
    } else if (impt.type !== 'import-meta' && !impt.typeOnly) {
      if (!deps.includes(impt.specifier)) deps.push(impt.specifier);
    }
  }
  const size = source.length;
  return {
    deps,
    dynamicDeps,
    cjsLazyDeps: null,
    size,
    format: 'esm',
    integrity: await getIntegrity(source)
  };
}
const leadingCommentRegex = /^\s*(\/\*[\s\S]*?\*\/|\s*\/\/[^\n]*)*/;
const registerRegex =
  /^\s*System\s*\.\s*register\s*\(\s*(\[[^\]]*\])\s*,\s*\(?function\s*\(\s*([^\),\s]+\s*(,\s*([^\),\s]+)\s*)?\s*)?\)/;

function systemMatch(code: string) {
  const commentMatch = code.match(leadingCommentRegex);
  const offset = commentMatch ? commentMatch[0].length : 0;
  return code.slice(offset).match(registerRegex);
}

export async function createSystemAnalysis(
  source: string,
  imports: ReadonlyArray<Import>,
  url: string
): Promise<Analysis> {
  const [, rawDeps, contextId] = systemMatch(source) || [];
  if (!rawDeps) return createEsmAnalysis(imports, source, url);
  const deps = JSON.parse(rawDeps.replace(/'/g, '"'));
  const dynamicDeps: string[] = [];
  if (contextId) {
    const dynamicImport = `${contextId}.import(`;
    let i = -1;
    while ((i = source.indexOf(dynamicImport, i + 1)) !== -1) {
      const importStart = i + dynamicImport.length + 1;
      const quote = source[i + dynamicImport.length];
      if (quote === '"' || quote === "'") {
        const importEnd = source.indexOf(quote, i + dynamicImport.length + 1);
        if (importEnd !== -1) {
          try {
            dynamicDeps.push(JSON.parse('"' + source.slice(importStart, importEnd) + '"'));
            continue;
          } catch (e) {}
        }
      }
      console.warn('TODO: Dynamic import custom expression tracing.');
    }
  }
  const size = source.length;
  return {
    deps,
    dynamicDeps,
    cjsLazyDeps: null,
    size,
    format: 'system',
    integrity: await getIntegrity(source)
  };
}
