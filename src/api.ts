import { TraceMap } from './tracemap.ts';
import * as installUtils from './installtree.ts';
import { Installer } from './installer.ts';
import * as utils from './utils.ts';
import { version } from './version.js';

async function jspmRollupLazy () {
  return import('./rollup-plugin.ts');
}

export { TraceMap, Installer, jspmRollupLazy, installUtils, utils, version }
