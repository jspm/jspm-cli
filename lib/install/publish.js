"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sver_1 = require("sver");
const common_1 = require("../utils/common");
const tar = require("tar-fs");
const spdxLicenses = require("spdx-license-list/simple");
const fs = require("graceful-fs");
const path = require("path");
const mm = require("micromatch");
function throwFieldMissing(fieldName) {
    throw new common_1.JspmUserError(`Package configuration must specify a ${common_1.bold(fieldName)} field to publish.`);
}
function throwFieldInvalid(value, expected) {
    throw new common_1.JspmUserError(`${common_1.bold(JSON.stringify(value))} is not a valid ${expected}.`);
}
const alwaysIncludeFile = /^(readme|changelog|license|licence|notice)\.[^\.\/]+$/i;
// (we ignore all dot files)
const alwaysIgnoreFile = /^\.|^(CVS|npm-debug\.log|node_modules|jspm_packages|config\.gypi|[^\.]+\.orig|package-lock\.json|jspm\.json|jspm\.json\.lock|package\.json\.lock)$/;
function pack(project, files, ignore) {
    const ignoresRes = [];
    const filesRes = [];
    const foldersRes = [];
    if (files) {
        for (let pattern of files) {
            pattern = pattern.replace(/\\/g, '/');
            const parts = pattern.split('/');
            while (parts.length > 1) {
                parts.pop();
                foldersRes.push(mm.makeRe(parts.join('/')));
            }
            filesRes.push(mm.makeRe(pattern));
            filesRes.push(mm.makeRe(pattern + (pattern[pattern.length - 1] !== '/' ? '/' : '') + '**'));
        }
    }
    if (ignore) {
        for (let pattern of ignore) {
            pattern = pattern.replace(/\\/g, '/');
            ignoresRes.push(mm.makeRe(pattern));
            ignoresRes.push(mm.makeRe(pattern + (pattern[pattern.length - 1] === '/' ? '/' : '') + '**'));
        }
    }
    const includedFiles = [];
    const tarStream = tar.pack(project.projectPath, {
        fs,
        ignore(file) {
            const relFile = path.relative(project.projectPath, file).replace(/\\/g, '/');
            // always included
            if (relFile.indexOf('/') === -1) {
                if (relFile === 'package.json' || alwaysIncludeFile.test(relFile)) {
                    includedFiles.push(relFile);
                    return false;
                }
            }
            // always ignored
            if (alwaysIgnoreFile.test(path.basename(relFile)))
                return true;
            // "files"
            if (files) {
                if (filesRes.some(re => re.test(relFile))) {
                    if (ignoresRes.some(re => re.test(relFile)))
                        return true;
                    includedFiles.push(relFile);
                    return false;
                }
                // folder of "files" pattern
                if (foldersRes.some(re => re.test(relFile))) {
                    includedFiles.push(relFile);
                    return false;
                }
                return true;
            }
            else {
                if (ignoresRes.some(re => re.test(relFile)))
                    return true;
                includedFiles.push(relFile);
                return false;
            }
        },
        map(header) {
            header.name = 'package' + (header.name === '.' ? '' : '/' + header.name);
            delete header.uid;
            delete header.gid;
            return header;
        }
    });
    return {
        files: includedFiles,
        stream: tarStream
    };
}
exports.pack = pack;
async function publish(project, opts) {
    const registry = project.defaultRegistry;
    const pjson = project.config.pjson._original;
    const { name, version } = project.config.pjson;
    if (typeof pjson.name !== 'string')
        throwFieldMissing('name');
    if (!name.match(common_1.validPkgNameRegEx))
        throwFieldInvalid(name, 'package name');
    if (typeof version !== 'string')
        throwFieldMissing('version');
    try {
        new sver_1.Semver(version);
    }
    catch (e) {
        throwFieldInvalid(version, 'semver version');
    }
    if (project.config.pjson.private)
        throw new common_1.JspmUserError(`Package configured as ${common_1.bold('private')} cannot be published.`);
    if (typeof pjson.license !== 'string')
        throwFieldMissing('license');
    if (!spdxLicenses.has(pjson.license))
        throwFieldInvalid(pjson.license, 'spdx license');
    if (typeof pjson.main !== 'string')
        project.log.warn(`No package ${common_1.bold("main")} provided.`);
    const pkg = { registry, name, version };
    // pjson filtering to avoid unnecessary data
    delete pjson.devDependencies;
    delete pjson.overrides;
    // We support package.json "ignore", falling back to .npmignore, .gitignore
    let ignore = pjson.ignore;
    let ignoreIsFile = false;
    if (pjson.ignore instanceof Array === false) {
        if ('ignore' in pjson)
            throwFieldInvalid('ignore', 'array of patterns');
        try {
            const npmignore = await new Promise((resolve, reject) => fs.readFile(path.join(project.projectPath, '.npmignore'), (err, source) => err ? reject(err) : resolve(source)));
            ignoreIsFile = true;
            ignore = npmignore.toString().trim().split('\n').map(item => item.trim()).filter(item => item[0] !== '#');
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                throw e;
            try {
                const gitignore = await new Promise((resolve, reject) => fs.readFile(path.join(project.projectPath, '.gitignore'), (err, source) => err ? reject(err) : resolve(source)));
                ignoreIsFile = true;
                ignore = gitignore.toString().trim().split('\n').map(item => item.trim()).filter(item => item[0] !== '#');
            }
            catch (e) {
                if (e.code !== 'ENOENT')
                    throw e;
            }
        }
    }
    if ('files' in pjson && pjson.files instanceof Array === false) {
        throwFieldInvalid('files', 'array of patterns');
    }
    // we dont ignore if there are files entries and the ignore came from a file (npm rule)
    if (ignoreIsFile && pjson.files)
        ignore = [];
    const { files, stream } = pack(project, pjson.files, ignore);
    // log the files
    let logged = false;
    function logFiles() {
        // TODO: an actual tree logger!
        if (logged)
            return;
        logged = true;
        let last = undefined;
        let first = true;
        for (const file of files.sort()) {
            if (last) {
                if (first) {
                    project.log.info(`┌ ${last}`);
                    first = false;
                }
                else {
                    project.log.info(`├ ${last}`);
                }
            }
            last = file;
        }
        if (last)
            project.log.info(`└ ${last}`);
    }
    stream.on('end', logFiles);
    await project.registryManager.publish(project.projectPath, pkg.registry, pjson, stream, {
        access: opts.public && 'public',
        tag: opts.tag,
        otp: opts.otp
    });
    logFiles();
    project.log.ok(`Successfully published ${common_1.highlight(pkg.registry + ':' + pkg.name + '@' + pkg.version)}`);
}
exports.default = publish;
//# sourceMappingURL=publish.js.map