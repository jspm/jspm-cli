"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const url_1 = require("url");
const crypto = require("crypto");
const common_1 = require("../utils/common");
const zlib = require("zlib");
const peek = require("buffer-peek-stream");
const fs = require("graceful-fs");
const tar = require("tar-fs");
const execGit = require("@jspm/github/exec-git");
const rimraf = require("rimraf");
const path = require("path");
const gitProtocol = {
    resolve: gitResolve,
    download: gitCheckout
};
exports.sourceProtocols = {
    'git': gitProtocol,
    'git+file': gitProtocol,
    'git+ssh': gitProtocol,
    'git+http': gitProtocol,
    'git+https': gitProtocol,
    'https': {
        download: fetchRemoteTarball
    },
    'http': {
        download: fetchRemoteTarball
    },
    'file': {
        download: extractLocalTarball
    },
    'link': {}
};
function getProtocolHandler(source) {
    const protocolIndex = source.indexOf(':');
    const protocol = source.substr(0, protocolIndex);
    const protocolHandler = exports.sourceProtocols[protocol];
    if (!protocolHandler)
        throw new common_1.JspmUserError(`No handler available for source protocol ${common_1.bold(protocol)} processing ${source}.`);
    return protocolHandler;
}
async function resolveSource(log, fetch, source, timeout) {
    const protocolHandler = getProtocolHandler(source);
    if (!protocolHandler.resolve)
        return source;
    return protocolHandler.resolve(log, fetch, source, timeout);
}
exports.resolveSource = resolveSource;
function downloadSource(log, fetch, source, outDir, timeout) {
    const protocolHandler = getProtocolHandler(source);
    if (!protocolHandler.download)
        throw new common_1.JspmError(`Invalid attempt to download source ${source}`);
    return protocolHandler.download(log, fetch, source, outDir, timeout);
}
exports.downloadSource = downloadSource;
async function gitResolve(log, fetch, source, timeout) {
    let url = source.startsWith('git:') ? source : source.substr(4);
    const gitRefIndex = url.lastIndexOf('#');
    let gitRef = '';
    if (gitRefIndex !== -1) {
        gitRef = url.substr(gitRefIndex + 1);
        url = url.substr(0, gitRefIndex);
    }
    const logEnd = log.taskStart(`Resolving git source ${common_1.highlight(source)}`);
    try {
        const execOpts = { timeout, killSignal: 'SIGKILL', maxBuffer: 100 * 1024 * 1024 };
        let credentials = await fetch.getCredentials(url);
        if (credentials.basicAuth) {
            let urlObj = new url_1.URL(url);
            ({ username: urlObj.username, password: urlObj.password } = credentials.basicAuth);
            url = urlObj.href;
        }
        try {
            log.debug(`ls-remote ${url}${credentials.basicAuth ? ' (with basic auth)' : ''}`);
            var stdout = await execGit(`ls-remote ${url} HEAD refs/tags/* refs/heads/*`, execOpts);
        }
        catch (err) {
            const str = err.toString();
            // not found
            if (str.indexOf('not found') !== -1)
                throw new common_1.JspmUserError(`Git source ${common_1.highlight(source)} not found.`);
            // invalid credentials
            if (str.indexOf('Invalid username or password') !== -1 || str.indexOf('fatal: could not read Username') !== -1)
                throw new common_1.JspmUserError(`git authentication failed resolving ${common_1.highlight(source)}.
    Make sure that git is locally configured with the correct permissions.`);
            throw err;
        }
        let refs = stdout.split('\n');
        let hashMatch;
        for (let ref of refs) {
            if (!ref)
                continue;
            let hash = ref.substr(0, ref.indexOf('\t'));
            let refName = ref.substr(hash.length + 1);
            if (!gitRef && refName === 'HEAD') {
                hashMatch = hash;
                break;
            }
            else if (refName.substr(0, 11) === 'refs/heads/') {
                if (gitRef === refName.substr(11)) {
                    hashMatch = hash;
                    break;
                }
            }
            else if (refName.substr(0, 10) === 'refs/tags/') {
                if (refName.substr(refName.length - 3, 3) === '^{}') {
                    if (gitRef === refName.substr(10, refName.length - 13)) {
                        hashMatch = hash;
                        break;
                    }
                }
                else if (gitRef === refName.substr(10)) {
                    hashMatch = hash;
                    break;
                }
            }
        }
        if (!hashMatch)
            throw new common_1.JspmUserError(`Unable to resolve the ${common_1.highlight(gitRef || 'head')} git reference for ${source}.`);
        url += '#' + hashMatch;
        if (!source.startsWith('git:'))
            return 'git+' + url;
        else
            return url;
    }
    finally {
        logEnd();
    }
}
const gitRefRegEx = /^[a-f0-9]{6,}$/;
async function gitCheckout(log, _fetch, source, outDir, timeout) {
    const execOpts = {
        cwd: outDir,
        timeout,
        killSignal: 'SIGKILL',
        maxBuffer: 100 * 1024 * 1024
    };
    let gitSource = source.startsWith('git:') ? source : source.substr(4);
    let gitRefIndex = gitSource.lastIndexOf('#');
    if (gitRefIndex === -1)
        throw new common_1.JspmUserError(`Invalid source ${source}. Git sources must have an exact trailing # ref.`);
    let gitRef = gitSource.substr(gitRefIndex + 1);
    gitSource = gitSource.substr(0, gitRefIndex);
    if (!gitRef.match(gitRefRegEx))
        throw new common_1.JspmUserError(`Invalid source ${source}. Git source reference ${gitRef} must be a hash reference.`);
    const local = source.startsWith('file:') ? '-l ' : '';
    // this will work for tags and branches, but we want to encourage commit references for uniqueness so dont want to reward this use case unfortunately
    // await execGit(`clone ${local}--depth=1 ${source.replace(/(['"()])/g, '\\\$1')} --branch ${ref.replace(/(['"()])/g, '\\\$1')} ${outDir}`, execOpts);
    // TODO: better sanitize against source injections here
    // do a full clone for the commit reference case
    // credentials used by git will be standard git credential manager which should be relied on
    const logEnd = log.taskStart('Cloning ' + common_1.highlight(source));
    try {
        await execGit(`clone ${gitRef ? '-n ' : ''}${local}${gitSource.replace(/(['"()])/g, '\\\$1')} ${outDir}`, execOpts);
        if (gitRef)
            await execGit(`checkout ${gitRef.replace(/(['"()])/g, '\\\$1')}`, execOpts);
    }
    catch (err) {
        if (err.toString().indexOf('Repository not found') !== -1)
            throw new common_1.JspmUserError(`Unable to find repo ${common_1.highlight(source)}. It may not exist, or authorization may be required.`);
        throw err;
    }
    finally {
        logEnd();
    }
    // once clone is successful, then we can remove the git directory
    await new Promise((resolve, reject) => rimraf(path.join(outDir, '.git'), err => err ? reject(err) : resolve()));
}
async function fetchRemoteTarball(log, fetch, source, outDir) {
    const { url, hashType, hash } = readSource(log, source);
    const fetchOptions = {
        headers: {
            accept: 'application/octet-stream'
        }
    };
    const href = url.href;
    const logEnd = log.taskStart('Fetching ' + common_1.highlight(href));
    try {
        var res = await fetch.fetch(href, fetchOptions);
    }
    catch (err) {
        switch (err.code) {
            case 'ENOTFOUND':
                if (err.toString().indexOf('getaddrinfo') === -1)
                    break;
            case 'ECONNRESET':
            case 'ETIMEDOUT':
            case 'ESOCKETTIMEDOUT':
                err.retriable = true;
                err.hideStack = true;
        }
        throw err;
    }
    finally {
        logEnd();
    }
    if (res.status !== 200)
        throw new Error(`Bad download response code ${res.status} for ${source}`);
    let validationPromise;
    if (!hashType) {
        validationPromise = Promise.resolve();
    }
    else {
        const verifyHash = crypto.createHash(hashType);
        // Validate downloaded hash
        validationPromise = new Promise((resolve, reject) => {
            res.body.pipe(verifyHash)
                .pause()
                .on('finish', () => {
                let computedHash = verifyHash.read();
                if (!computedHash.equals(hash)) {
                    let err = new Error(`Hash integrity compromised downloading ${href}.`);
                    err.hideStack = true;
                    reject(err);
                }
                resolve();
            })
                .on('error', reject);
        });
    }
    let stream = await new Promise((resolve, reject) => {
        // pipe through gunzip if a gzipped stream
        peek(res.body, 3, (err, bytes, stream) => {
            if (err)
                reject(err);
            else if (bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08)
                resolve(stream.pipe(zlib.createGunzip()).pause());
            else
                resolve(stream.pause());
        });
    });
    await Promise.all([
        validationPromise,
        // Unpack contents as a tar archive and save to targetDir
        new Promise((resolve, reject) => {
            stream.pipe(tar.extract(outDir, {
                // all dirs and files should be readable and writeable
                dmode: 0o555,
                fmode: 0o666,
                strip: 1,
                filter: function (_, header) {
                    return header.type !== 'file' && header.type !== 'directory';
                }
            }))
                .on('finish', resolve)
                .on('error', reject);
        })
    ]);
}
async function extractLocalTarball(log, _fetch, source, outDir) {
    const { url, hashType, hash } = readSource(log, source);
    let stream = fs.createReadStream(url);
    let validationPromise;
    if (!hashType) {
        validationPromise = Promise.resolve();
    }
    else {
        const verifyHash = crypto.createHash(hashType);
        // Validate downloaded hash
        validationPromise = new Promise((resolve, reject) => {
            stream.pipe(verifyHash)
                .pause()
                .on('finish', () => {
                let computedHash = verifyHash.digest();
                if (!computedHash.equals(hash)) {
                    let err = new Error(`Hash integrity compromised downloading ${url.href}.`);
                    err.hideStack = true;
                    reject(err);
                }
                resolve();
            })
                .on('error', reject);
        });
    }
    let extractStream = await new Promise((resolve, reject) => {
        // pipe through gunzip if a gzipped stream
        peek(stream, 3, (err, bytes, stream) => {
            if (err)
                reject(err);
            else if (bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08)
                resolve(stream.pipe(zlib.createGunzip()).pause());
            else
                resolve(stream.pause());
        });
    });
    await Promise.all([
        validationPromise,
        // Unpack contents as a tar archive and save to targetDir
        new Promise((resolve, reject) => {
            extractStream.pipe(tar.extract(outDir, {
                // all dirs and files should be readable
                dmode: 0o555,
                fmode: 0o666,
                strip: 1,
                filter: function (_, header) {
                    return header.type !== 'file' && header.type !== 'directory';
                }
            }))
                .on('finish', resolve)
                .on('error', reject);
        })
    ]);
}
const base64RegEx = /[a-z0-9+/]*={0,2}$/i;
const hexRegEx = /[a-f0-9]*$/g;
const hashTypes = [
    {
        hashType: 'sha1',
        len: 20
    },
    {
        hashType: 'sha224',
        len: 28
    },
    {
        hashType: 'sha256',
        len: 32
    },
    {
        hashType: 'sha384',
        len: 48
    },
    {
        hashType: 'sha512',
        len: 64
    }
];
;
function readSource(log, source) {
    const hashIndex = source.lastIndexOf('#');
    if (hashIndex === -1) {
        const url = new url_1.URL(source);
        return { url };
    }
    const url = new url_1.URL(source.substr(0, hashIndex));
    const hashTypeIndex = source.indexOf('-', hashIndex + 1);
    // direct hexadecimal hash for sha
    if (hashTypeIndex === -1) {
        const hashLen = source.length - hashIndex - 1;
        hexRegEx.lastIndex = hashIndex + 1;
        if (hexRegEx.exec(source)[0].length !== hashLen) {
            log.warn(`Source ${source} does not have a valid hexadecimal hash so is being ignored.`);
            return { url };
        }
        const halfHashLen = hashLen / 2;
        let hashMatch = hashTypes.find(({ len }) => len === halfHashLen);
        if (!hashMatch || hashLen % 2 !== 0) {
            log.warn(`Source ${source} has a hexadecimal hash of invalid length for any sha hash so is being ignored.`);
            return { url };
        }
        const hashType = hashMatch.hashType;
        const hash = Buffer.from(source.substr(hashIndex + 1), 'hex');
        return { url, hash, hashType };
    }
    // base64 integrity-style hash
    else {
        const hashType = source.substring(hashIndex + 1, hashTypeIndex);
        const hashLen = source.length - hashTypeIndex - 1;
        base64RegEx.lastIndex = hashTypeIndex + 1;
        if (base64RegEx.exec(source)[0].length !== hashLen) {
            log.warn(`Source ${source} does not have a valid base64 hash string so is being ignored.`);
            return { url };
        }
        const hashMatch = hashTypes.find(({ hashType: type }) => hashType === type);
        if (!hashMatch) {
            log.warn(`Source ${source} is using an unsupported hash algorithm so is being ignored.`);
            return { url };
        }
        const hash = Buffer.from(source.substr(hashTypeIndex + 1), 'base64');
        if (hashMatch.len !== hash.length) {
            log.warn(`Source ${source} does not have a valid length ${hashType} base64 hash so it is being ignored.`);
            ;
            return { url };
        }
        return { url, hash, hashType };
    }
}
//# sourceMappingURL=source.js.map