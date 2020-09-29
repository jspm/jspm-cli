declare module 'sver';
declare module 'webcmd';
declare module 'es-module-lexer';
declare module 'ora';
declare module 'chalk';
declare module 'make-fetch-happen';
declare module 'rimraf';
declare module 'rollup';
declare module 'mkdirp';
declare module '@babel/core';
declare module 'babel-plugin-transform-cjs-dew';
declare module 'terser';
declare module 'crypto';
declare module 'os';
declare module 'url';
declare namespace process {
  const cwd: () => string;
  const versions: Record<string, string>;
  const platform: string;
  const env: Record<string, string>;
}
declare function require (specifier: string): any;
