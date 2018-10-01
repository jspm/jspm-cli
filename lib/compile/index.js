"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/*
 *   Copyright 2014-2018 Guy Bedford (http://guybedford.com)
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
const rimraf = require("rimraf");
const mkdirp = require("mkdirp");
const common_1 = require("../utils/common");
const path = require("path");
const ui_1 = require("../utils/ui");
const defaultEnvTargets = {
    browser: {
        esm: {
            esmodules: true
        },
        other: {
            browsers: ['> 1%', 'last 2 versions', 'Firefox ESR']
        }
    },
    node: {
        esm: {
            node: '8.9.0'
        },
        other: {
            node: '6.12.3'
        }
    }
};
function getDefaultTarget(env, target, esm) {
    let envTarget, envTargetName;
    if (env.node === false || env.browser === true) {
        if (target)
            envTarget = { browsers: target };
        else if (esm)
            envTarget = defaultEnvTargets.browser.esm;
        else
            envTarget = defaultEnvTargets.browser.other;
    }
    else {
        if (target)
            envTarget = { node: target };
        else if (esm)
            envTarget = defaultEnvTargets.node.esm;
        else
            envTarget = defaultEnvTargets.node.other;
    }
    if (env.node === false || env.browser === true) {
        envTargetName = 'browser ' + (target && target.join(', ') || envTarget.browsers || 'esmodules');
    }
    else {
        envTargetName = 'NodeJS ' + (target && target.join(', ') || envTarget.node);
    }
    return { envTarget, envTargetName };
}
async function compile(input, opts) {
    if (!opts.format || opts.format === 'esm' || opts.format === 'es6')
        opts.format = 'es';
    if (opts.format === 'global')
        opts.format = 'iife';
    let { envTarget, envTargetName } = getDefaultTarget(opts.env || {}, opts.target, opts.format === 'es');
    let external = opts.external;
    let paths;
    if (typeof opts.external === 'object') {
        external = [];
        paths = {};
        Object.keys(opts.external).forEach(name => {
            const alias = opts.external[name];
            if (alias === true) {
                external.push(name);
            }
            else if (typeof alias === 'string') {
                external.push(name);
                paths[name] = alias;
            }
        });
    }
    const rollupOptions = {
        input,
        external,
        onwarn: () => { },
        experimentalDynamicImport: true,
        experimentalCodeSplitting: true,
        plugins: [jspmRollup({
                minify: opts.env && opts.env.production,
                sourceMap: opts.sourceMaps,
                configFiles: false,
                basePath: opts.projectPath || process.cwd(),
                //env: opts.env,
                envTarget
            })]
    };
    if (opts.out)
        rollupOptions.file = opts.out;
    else
        rollupOptions.dir = opts.dir;
    if (opts.watch) {
        if (!opts.out)
            throw new common_1.JspmUserError(`jspm build --watch is only supported for single file builds currently.`);
        rollupOptions.output = {
            exports: 'named',
            compact: opts.env && opts.env.production,
            paths,
            file: opts.out,
            format: opts.format,
            sourcemap: opts.sourceMaps,
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
                ui_1.ok(`Built into ${common_1.bold(opts.out)}`);
        });
        // pause indefinitely
        await new Promise((_resolve, _reject) => { });
    }
    try {
        var build = await rollup.rollup(rollupOptions);
    }
    catch (err) {
        if (err.code === 'PARSE_ERROR' &&
            err.message.indexOf(`'import' and 'export' may only appear at the top level`) !== -1 &&
            err.loc.file.endsWith('?dew')) {
            throw new common_1.JspmUserError(`Error parsing ${err.loc.file.substr(0, err.loc.file.length - 4)}:\n\tThis file is being built as a CommonJS module when it uses import/export syntax.\n\tTry setting the package.json "mode": "esm" property for this package module to be interpreted correctly.`);
        }
        if (err.frame) {
            throw new common_1.JspmUserError('Error transforming ' + err.loc.file + ': ' + (err.message || '') + '\n' + err.frame);
        }
        if (err.loc) {
            throw new common_1.JspmUserError(`Error parsing ${err.loc.file}:\n\t${err.message}`);
        }
        throw err;
    }
    let chunks;
    if (opts.out) {
        chunks = {
            [opts.out]: {
                imports: build.imports,
                exports: build.exports,
                modules: build.modules
            }
        };
        await build.write({
            compact: opts.env && opts.env.production,
            exports: 'named',
            paths,
            file: opts.out,
            format: opts.format,
            sourcemap: opts.sourceMaps,
            indent: true,
            banner: opts.banner
        });
        if (opts.log)
            ui_1.ok(`Built into ${common_1.bold(opts.out)}${envTargetName ? ` for ${envTargetName} baseline` : ''}`);
    }
    else {
        chunks = build.chunks;
        if (opts.clearDir) {
            rimraf.sync(opts.dir);
            mkdirp.sync(opts.dir);
        }
        await build.write({
            exports: 'named',
            dir: opts.dir,
            format: opts.format,
            sourcemap: opts.sourceMaps,
            indent: true,
            banner: opts.banner
        });
        if (opts.log)
            ui_1.ok(`Built into ${common_1.bold(opts.dir + '/')}${envTargetName ? ' for ' + envTargetName : ''}`);
    }
    if (opts.showGraph && opts.log) {
        console.log('');
        // Improvements to this welcome! sizes in KB? Actual graph display? See also index.ts in es-module-optimizer
        for (let name of Object.keys(chunks)) {
            const entry = chunks[name];
            const deps = entry.imports;
            console.log(`${common_1.bold(name)}${deps.length ? ' imports ' : ''}${deps.sort().join(', ')}:`);
            for (let module of entry.modules.sort((m1, m2) => m1.id > m2.id ? 1 : -1)) {
                console.log(`  ${path.relative(process.cwd(), module.id).replace(common_1.winSepRegEx, '/')}`);
            }
            console.log('');
        }
    }
}
exports.compile = compile;
//# sourceMappingURL=index.js.map