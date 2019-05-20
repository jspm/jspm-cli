"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const rollup = require("rollup");
const jspmRollup = require("rollup-plugin-jspm");
const terserPlugin = require("rollup-plugin-terser");
const rimraf = require("rimraf");
const mkdirp = require("mkdirp");
const common_1 = require("../utils/common");
const path = require("path");
const ui_1 = require("../utils/ui");
const resolve_1 = require("@jspm/resolve");
const process = require("process");
async function build(input, opts) {
    // esm / cjs as internal default while not yet widely used in Rollup ecosystem
    if (!opts.format)
        opts.format = 'esm';
    if (opts.format === 'module')
        opts.format = 'esm';
    if (opts.format === 'commonjs')
        opts.format = 'cjs';
    let ext = opts.mjs ? '.mjs' : '.js';
    if (opts.dir && opts.dir.endsWith('/'))
        opts.dir = opts.dir.slice(0, -1);
    let inputObj;
    if (input instanceof Array === false) {
        inputObj = input;
    }
    else {
        if (input.length === 0) {
            ui_1.warn(`No inputs provided to build.`);
            return;
        }
        inputObj = {};
        for (const module of input) {
            if (opts.format === 'esm' && 'mjs' in opts === false && module.endsWith('.mjs'))
                ext = '.mjs';
            let basename = path.basename(module);
            if (basename.indexOf('.') !== -1)
                basename = basename.substr(0, basename.lastIndexOf('.'));
            let inputName = basename;
            let i = 0;
            while (inputName in inputObj)
                inputName = basename + i++;
            inputObj[inputName] = module;
        }
    }
    // use .mjs if the output package boundary requires
    if (opts.format === 'esm' && 'mjs' in opts === false && ext !== '.mjs') {
        const outdir = path.resolve(opts.dir);
        const boundary = resolve_1.utils.getPackageBoundarySync.call(resolve_1.fs, outdir + '/');
        if (boundary) {
            const pjson = resolve_1.utils.readPackageConfigSync.call(resolve_1.fs, boundary);
            if (pjson.type !== 'module') {
                let pjsonPath = path.relative(process.cwd(), boundary + '/package.json');
                if (!pjsonPath.startsWith('..' + path.sep))
                    pjsonPath = '.' + path.sep + pjsonPath;
                ui_1.warn(`Output package scope at ${common_1.highlight(pjsonPath)} does not have a ${common_1.bold('"type": "module"')} boundary, so outputting mjs.`);
                ext = '.mjs';
            }
        }
    }
    const rollupOptions = {
        input: inputObj,
        dir: opts.dir,
        onwarn: () => { },
        sourcemap: opts.sourceMap,
        plugins: [jspmRollup({
                projectPath: opts.projectPath || process.cwd(),
                externals: opts.external,
                env: opts.env
            })]
    };
    if (opts.minify) {
        rollupOptions.plugins.push(terserPlugin.terser({
            sourcemap: opts.sourceMap
        }));
    }
    if (opts.watch) {
        rollupOptions.output = {
            dir: opts.dir,
            format: opts.format,
            sourcemap: opts.sourceMap,
            indent: true,
            banner: opts.banner
        };
        const watcher = await rollup.watch(rollupOptions);
        let firstRun = true;
        watcher.on('event', event => {
            if (firstRun)
                firstRun = false;
            else if (event.code === 'BUNDLE_START')
                ui_1.info(`Rebuilding...`);
            else if (event.code === 'BUNDLE_END')
                ui_1.ok(`Built into ${common_1.bold(opts.dir)}`);
        });
        // pause indefinitely
        await new Promise((_resolve, _reject) => { });
    }
    const build = await rollup.rollup(rollupOptions);
    if (opts.clearDir) {
        rimraf.sync(opts.dir);
        mkdirp.sync(opts.dir);
    }
    const { output } = await build.write({
        entryFileNames: '[name]' + (opts.hashEntries ? '-[hash]' : '') + ext,
        chunkFileNames: 'chunk-[hash]' + ext,
        dir: opts.dir,
        format: opts.format,
        sourcemap: opts.sourceMap,
        indent: true,
        banner: opts.banner
    });
    if (opts.log)
        ui_1.ok(`Built into ${common_1.highlight(opts.dir + '/')}`);
    if (opts.showGraph && opts.log) {
        console.log('');
        // Improvements to this welcome! sizes in KB? Actual graph display? See also index.ts in es-module-optimizer
        for (const chunk of output) {
            const entry = chunk;
            const deps = entry.imports;
            console.log(`${common_1.bold(entry.name)}${deps.length ? ' imports ' : ''}${deps.sort().join(', ')}:`);
            const modules = Object.keys(entry.modules).sort((m1, m2) => m1 > m2 ? 1 : -1);
            for (let module of modules) {
                console.log(`  ${path.relative(process.cwd(), module).replace(common_1.winSepRegEx, '/')}`);
            }
            console.log('');
        }
    }
    const imports = Object.create(null);
    const mapBase = opts.mapBase || process.cwd();
    // Make sure the rollup output array is in the same order as input array
    const inputObjKeys = Object.keys(inputObj);
    output.sort((a, b) => inputObjKeys.indexOf(a.name) - inputObjKeys.indexOf(b.name));
    for (const [index, key] of inputObjKeys.entries()) {
        const resolvedFile = path.resolve(opts.dir, output[index].fileName);
        let relMap = path.relative(mapBase, resolvedFile).replace(/\\/g, '/');
        if (!relMap.startsWith('../'))
            relMap = './' + relMap;
        imports[inputObj[key]] = relMap;
    }
    return { imports };
}
exports.build = build;
//# sourceMappingURL=index.js.map