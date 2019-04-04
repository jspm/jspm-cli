"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("../utils/common");
const babel = require("@babel/core");
const path = require("path");
const fs = require("graceful-fs");
const dewTransformPlugin = require("babel-plugin-transform-cjs-dew");
const partial_dew_resolve_1 = require("./partial-dew-resolve");
const stage3Syntax = ['asyncGenerators', 'classProperties', 'optionalCatchBinding', 'objectRestSpread', 'numericSeparator', 'dynamicImport', 'importMeta'];
function tryParseCjs(source) {
    const requires = new Set();
    let hasProcess, hasBuffer;
    const { ast } = babel.transform(source, {
        ast: true,
        babelrc: false,
        highlightCode: false,
        compact: false,
        sourceType: 'script',
        parserOpts: {
            allowReturnOutsideFunction: true,
            plugins: stage3Syntax
        },
        plugins: [({ types: t }) => ({
                visitor: {
                    ReferencedIdentifier(path) {
                        const identifierName = path.node.name;
                        if (!hasProcess && identifierName === 'process' && !path.scope.hasBinding('process'))
                            hasProcess = true;
                        if (!hasBuffer && identifierName === 'Buffer' && !path.scope.hasBinding('Buffer'))
                            hasBuffer = true;
                    },
                    CallExpression(path) {
                        if (t.isIdentifier(path.node.callee, { name: 'require' })) {
                            let arg = path.node.arguments[0];
                            if (t.isStringLiteral(arg))
                                requires.add(arg.value);
                            else if (t.isTemplateLiteral(arg) && arg.expressions.length === 0)
                                requires.add(arg.quasis[0].value.cooked);
                            // no dynamic require detection support currently
                        }
                    }
                }
            })]
    });
    if (hasProcess && !requires.has('process'))
        requires.add('process');
    if (hasBuffer && !requires.has('buffer'))
        requires.add('buffer');
    return { ast, requires };
}
function transformDew(ast, source, resolveMap) {
    const { code: dewTransform } = babel.transformFromAst(ast, source, {
        babelrc: false,
        highlightCode: false,
        compact: false,
        sourceType: 'script',
        parserOpts: {
            allowReturnOutsideFunction: true,
            plugins: stage3Syntax
        },
        plugins: [[dewTransformPlugin, {
                    resolve: name => resolveMap[name] || name,
                    esmDependencies: resolved => resolved.endsWith('.node') || resolved.startsWith('jspm-node-builtins/'),
                    filename: `import.meta.url.startsWith('file:') ? decodeURI(import.meta.url.slice(7 + (typeof process !== 'undefined' && process.platform === 'win32'))) : new URL(import.meta.url).pathname`,
                    dirname: `import.meta.url.startsWith('file:') ? decodeURI(import.meta.url.slice(0, import.meta.url.lastIndexOf('/')).slice(7 + (typeof process !== 'undefined' && process.platform === 'win32'))) : new URL(import.meta.url.slice(0, import.meta.url.lastIndexOf('/'))).pathname`
                }]]
    });
    return dewTransform;
}
async function tryCreateDew(filePath, pkgBasePath, files, folderMains) {
    const dewPath = filePath.endsWith('.js') ? filePath.substr(0, filePath.length - 3) + '.dew.js' : filePath + '.dew.js';
    try {
        const source = await new Promise((resolve, reject) => fs.readFile(filePath, (err, source) => err ? reject(err) : resolve(source.toString())));
        var { ast, requires } = tryParseCjs(source);
        const resolveMap = {};
        for (const require of requires)
            resolveMap[require] = partial_dew_resolve_1.toDew(partial_dew_resolve_1.relativeResolve(require, filePath, pkgBasePath, files, folderMains), true);
        const dewTransform = transformDew(ast, source, resolveMap);
        await new Promise((resolve, reject) => fs.writeFile(dewPath, dewTransform, err => err ? reject(err) : resolve()));
    }
    catch (err) {
        if (err instanceof SyntaxError && err.toString().indexOf('sourceType: "module"') !== -1)
            return true;
        if (filePath.endsWith('.js')) {
            try {
                const dewTransform = `export function dew () {\n  throw new Error('jspm error converting CommonJS File: ${err.message.replace('\'', '\\\'')}')}\n`;
                await new Promise((resolve, reject) => fs.writeFile(dewPath, dewTransform, err => err ? reject(err) : resolve()));
            }
            catch (e) {
                return true;
            }
            return;
        }
        return true;
    }
}
async function createJsonDew(filePath) {
    try {
        const source = await new Promise((resolve, reject) => fs.readFile(filePath, (err, source) => err ? reject(err) : resolve(source.toString())));
        let dewTransform;
        try {
            let parsed = JSON.parse(source);
            dewTransform = `export function dew () {\n  return exports;\n}\nvar exports = ${JSON.stringify(parsed)};\n`;
        }
        catch (err) {
            dewTransform = `export function dew () {\n  throw new Error('jspm CommonJS Conversion Error: Error parsing JSON file.')}\n`;
        }
        await new Promise((resolve, reject) => fs.writeFile(filePath + '.dew.js', dewTransform, err => err ? reject(err) : resolve()));
    }
    catch (err) {
        return true;
    }
}
module.exports = function convert(dir, files, folderMains, namedExports, callback) {
    return Promise.resolve()
        .then(async function () {
        const dewWithoutExtensions = {};
        const conversionPromises = [];
        const esmWrapperPromises = [];
        // - create .dew.js with precedence of X beating X.js
        // - .json.dew.js for JSON files
        // - replaces the original ".js" file with the ESM form (except for ".json" files)
        // - on a processing error, leaves the original ".js" file and creates a ".dew.js" throwing the error
        for (const file of Object.keys(files).sort()) {
            // because these are sorted, "x" will come before "x.js"
            // so if x is valid js, we skip x.js conversion
            if (file.endsWith('.js') && dewWithoutExtensions[file.substr(0, file.length - 3)])
                continue;
            if (files[file] === false)
                continue;
            if (file.endsWith(('.json'))) {
                // creates file.json.dew.js
                conversionPromises.push(createJsonDew(path.resolve(dir, file)).then(err => {
                    if (err)
                        return;
                    // all json files also get a ".json.js" entry for convenience
                    esmWrapperPromises.push(writeESMWrapper(dir, file + '.js', partial_dew_resolve_1.toDew(path.basename(file), false), namedExports));
                }));
            }
            else {
                // we attempt to create dew for all files as CommonJS can import any file extension as CommonJS
                // this will also fail if a file is already occupying the file.dew.js spot
                // on error, file.dew.js is populated with the error
                conversionPromises.push(tryCreateDew(path.resolve(dir, file), dir, files, folderMains).then(err => {
                    if (err)
                        return;
                    // exports should be passed as an argument here supporting both names, and star exports which are in turn provided from the esm of the star (internal or external)
                    if (!file.endsWith('.js'))
                        dewWithoutExtensions[file] = true;
                    esmWrapperPromises.push(writeESMWrapper(dir, file, partial_dew_resolve_1.toDew(path.basename(file), false), namedExports));
                }));
            }
        }
        await Promise.all(conversionPromises);
        await Promise.all(esmWrapperPromises);
    })
        .then(callback, callback);
};
function writeESMWrapper(dir, file, dewFile, namedExports) {
    let esmWrapperSource;
    if (namedExports && namedExports[file]) {
        const exportNames = namedExports[file].filter(name => common_1.isValidIdentifier(name) && name !== 'default');
        esmWrapperSource = `import { dew } from './${dewFile}';\nconst exports = dew();\nexport default exports;\nexport const ${exportNames.map(name => `${name} = exports.${name}`).join(', ')};\n`;
    }
    else {
        esmWrapperSource = `import { dew } from './${dewFile}';\nexport default dew();\n`;
    }
    return new Promise((resolve, reject) => fs.writeFile(path.resolve(dir, file), esmWrapperSource, err => err ? reject(err) : resolve()));
}
//# sourceMappingURL=convertCJSWorker.js.map