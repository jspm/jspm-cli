import { TraceMap } from './tracemap';
import * as installUtils from './installtree';
import { Installer } from './installer';
import * as utils from './utils';
import { version } from './version.js';

async function jspmRollupLazy () {
  return import('./rollup-plugin');
}

export { TraceMap, Installer, jspmRollupLazy, installUtils, utils, version }
