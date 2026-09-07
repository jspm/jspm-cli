import { parseStyled } from '../common/json.js';
import { defaultStyle, SourceStyle } from '../common/source-style.js';
import { baseUrl, isPlain } from '../common/url.js';
import { isWs, ParsedAttribute, ParsedTag, parseHtml } from './lexer.js';
// @ts-ignore
import { parse } from 'es-module-lexer/js';
import type { Import } from 'es-module-lexer';
import { dynamicImportSpecifier } from '../trace/analysis.js';

export interface HtmlAttr {
  quote: '"' | "'" | '';
  name: string;
  value: string | null;
  start: number;
  end: number;
}

function getAttr(source: string, tag: ParsedTag, name: string) {
  for (const attr of tag.attributes) {
    if (source.slice(attr.nameStart, attr.nameEnd) === name)
      return source.slice(attr.valueStart, attr.valueEnd);
  }
  return null;
}

export interface ParsedMap extends Omit<HtmlTag, 'attrs'> {
  json: any;
  style: SourceStyle | null;
  attrs: Record<string, HtmlAttr> | null;
  newScript: boolean;
}

export interface HtmlAnalysis {
  map: ParsedMap;
  base: URL;
  esModuleShims: HtmlTag | null;
  staticImports: Set<string>;
  dynamicImports: Set<string>;
  preloads: HtmlTag[];
  modules: HtmlTag[];
  inlineModules: HtmlTag[];
  scripts: HtmlTag[];
  comments: HtmlTag[];
  newlineTab: string;
}

export interface HtmlTag {
  start: number;
  end: number;
  attrs: Record<string, HtmlAttr>;
}

const esmsSrcRegEx = /(^|\/)(es-module-shims|esms)(\.min)?\.js$/;

function toHtmlAttrs(source: string, attributes: ParsedAttribute[]): Record<string, HtmlAttr> {
  return Object.fromEntries(
    attributes.map(attr => readAttr(source, attr)).map(attr => [attr.name, attr])
  );
}

function collectImports(imports: ReadonlyArray<Import>, analysis: HtmlAnalysis) {
  for (const impt of imports) {
    if (impt.type === 'dynamic') {
      const specifier = dynamicImportSpecifier(impt);
      if (specifier) analysis.dynamicImports.add(specifier);
    } else if (impt.specifier && !impt.typeOnly) {
      analysis.staticImports.add(impt.specifier);
    }
  }
}

export function analyzeHtml(source: string, url: URL = baseUrl): HtmlAnalysis {
  const analysis: HtmlAnalysis = {
    base: url,
    newlineTab: '\n',
    map: {
      json: null,
      style: null,
      start: -1,
      end: -1,
      newScript: false,
      attrs: null
    },
    staticImports: new Set<string>(),
    dynamicImports: new Set<string>(),
    preloads: [],
    modules: [],
    inlineModules: [],
    scripts: [],
    esModuleShims: null,
    comments: []
  };

  const tags = parseHtml(source, ['!--', 'base', 'script', 'link']);

  let createdInjectionPoint = false;
  for (const tag of tags) {
    switch (tag.tagName) {
      case '!--':
        analysis.comments.push({ start: tag.start, end: tag.end, attrs: {} });
        break;

      case 'base':
        const href = getAttr(source, tag, 'href');
        if (href) analysis.base = new URL(href, url);
        break;

      case 'script':
        const type = getAttr(source, tag, 'type');
        if (type === 'importmap') {
          const mapText = source.slice(tag.innerStart, tag.innerEnd);
          const emptyMap = mapText.trim().length === 0;
          const { json, style } = emptyMap
            ? { json: {}, style: defaultStyle }
            : parseStyled(mapText, url.href + '#importmap');
          const { start, end } = tag;
          const attrs = toHtmlAttrs(source, tag.attributes);

          let lastChar = tag.start;
          while (isWs(source.charCodeAt(--lastChar)));
          analysis.newlineTab = detectIndent(source, lastChar + 1);
          analysis.map = { json, style, start, end, attrs, newScript: false };
          createdInjectionPoint = true;
        } else if (type === 'module') {
          const src = getAttr(source, tag, 'src');
          if (src) {
            if (esmsSrcRegEx.test(src)) {
              analysis.esModuleShims = {
                start: tag.start,
                end: tag.end,
                attrs: toHtmlAttrs(source, tag.attributes)
              };
            } else {
              analysis.staticImports.add(isPlain(src) ? './' + src : src);
              analysis.modules.push({
                start: tag.start,
                end: tag.end,
                attrs: toHtmlAttrs(source, tag.attributes)
              });
            }
          } else {
            const [imports, , facade] = parse(source.slice(tag.innerStart, tag.innerEnd)) || [];
            collectImports(imports, analysis);
            if (!facade) {
              analysis.inlineModules.push({
                start: tag.start,
                end: tag.end,
                attrs: toHtmlAttrs(source, tag.attributes)
              });
            }
          }
        } else if (!type || type === 'javascript') {
          const src = getAttr(source, tag, 'src');
          if (src) {
            if (esmsSrcRegEx.test(src)) {
              analysis.esModuleShims = {
                start: tag.start,
                end: tag.end,
                attrs: toHtmlAttrs(source, tag.attributes)
              };
            } else {
              analysis.scripts.push({
                start: tag.start,
                end: tag.end,
                attrs: toHtmlAttrs(source, tag.attributes)
              });
            }
          } else {
            const [imports] = parse(source.slice(tag.innerStart, tag.innerEnd)) || [];
            collectImports(imports, analysis);
          }
        }

        // If we haven't found an injection point already, then we default to
        // injecting before the first link/script tag:
        if (!createdInjectionPoint) {
          createInjectionPoint(source, tag.start, analysis.map, tag, analysis);
          createdInjectionPoint = true;
        }

        break;

      case 'link':
        if (getAttr(source, tag, 'rel') === 'modulepreload') {
          const { start, end } = tag;
          const attrs = toHtmlAttrs(source, tag.attributes);
          analysis.preloads.push({ start, end, attrs });
        }

        // If we haven't found an injection point already, then we default to
        // injecting before the first link/script tag:
        if (!createdInjectionPoint) {
          createInjectionPoint(source, tag.start, analysis.map, tag, analysis);
          createdInjectionPoint = true;
        }
    }
  }

  // If we haven't found an existing import map to base the injection on, we
  // fall back to injecting into the head:
  if (!createdInjectionPoint) {
    const head = parseHtml(source, ['head'])?.[0];
    if (head) {
      let injectionPoint = head.innerStart;
      while (source[injectionPoint] !== '<') injectionPoint++;
      createInjectionPoint(source, injectionPoint, analysis.map, head, analysis);
      createdInjectionPoint = true;
    }
  }

  // As a final fallback we inject into the end of the document:
  if (!createdInjectionPoint) {
    createInjectionPoint(
      source,
      source.length,
      analysis.map,
      {
        tagName: 'html',
        start: source.length,
        end: source.length,
        attributes: [],
        innerStart: source.length,
        innerEnd: source.length
      },
      analysis
    );
  }

  return analysis;
}

function createInjectionPoint(
  source: string,
  injectionPoint: number,
  map: ParsedMap,
  tag: ParsedTag,
  analysis: HtmlAnalysis
) {
  let lastChar = injectionPoint;
  while (isWs(source.charCodeAt(--lastChar)));
  analysis.newlineTab = detectIndent(source, lastChar + 1);
  if (analysis.newlineTab.indexOf('\n') === -1) {
    lastChar = tag.start;
    while (isWs(source.charCodeAt(--lastChar)));
    analysis.newlineTab = detectIndent(source, lastChar + 1);
  }
  map.newScript = true;
  map.attrs = toHtmlAttrs(source, tag.attributes);
  map.start = map.end = injectionPoint;
}

function readAttr(
  source: string,
  { nameStart, nameEnd, valueStart, valueEnd }: ParsedAttribute
): HtmlAttr {
  return {
    start: nameStart,
    end: valueEnd !== -1 ? valueEnd : nameEnd,
    quote:
      valueStart !== -1 && (source[valueStart - 1] === '"' || source[valueStart - 1] === "'")
        ? (source[valueStart - 1] as '"' | "'")
        : '',
    name: source.slice(nameStart, nameEnd),
    value: valueStart === -1 ? null : source.slice(valueStart, valueEnd)
  };
}

function detectIndent(source: string, atIndex: number) {
  if (source === '' || atIndex === -1) return '';
  const nlIndex = atIndex;
  if (source[atIndex] === '\r' && source[atIndex + 1] === '\n') atIndex++;
  if (source[atIndex] === '\n') atIndex++;
  while (source[atIndex] === ' ' || source[atIndex] === '\t') atIndex++;
  return source.slice(nlIndex, atIndex) || '';
}
