import { fetch } from '../common/fetch.js';
import { parse, init } from 'es-module-lexer';

export async function getMaybeWrapperUrl(moduleUrl: any, fetchOpts: any) {
  await init;
  const source = await (await fetch(moduleUrl, fetchOpts)).text();
  const [imports, , facade] = parse(source);
  const specifier = imports[0]?.specifier;
  if (facade && specifier) {
    try {
      return new URL(specifier, moduleUrl).href;
    } catch {}
  }
  return moduleUrl;
}
