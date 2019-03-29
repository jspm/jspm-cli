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

/*
 * jspm core overrides
 *
 * These overrides apply to all jspm installs, overriding the package.json properties
 * of the matching packages.
 * 
 * PRs are welcome to this file, provided:
 * 1. The package has high enough use that this is an important override for jspm core to maintain.
 * 2. The override is necessary for jspm compatibility.
 * 3. An attempt to create an upstream PR has been made, and rejected.
 * 
 */

import { PackageConfig } from "./install/package";

export default <Record<string, Record<string, Record<string, PackageConfig>>>>{
  "github": {
    "@jspm/jspm-resolve": {
      "master": {
        "namedExports": {
            "resolve.js": [
            "applyMap",
            "sync",
            "utils",
            "builtins",
            "cjsResolve"
          ]
        }
      }
    }
  },
  "npm": {
    "assert": {
      "^1.4.1": {
        "namedExports": {
          "assert.js": [
            "AssertionError",
            "deepEqual",
            "deepStrictEqual",
            "doesNotReject",
            "doesNotThrow",
            "equal",
            "fail",
            "ifError",
            "notDeepEqual",
            "notDeepStrictEqual",
            "notEqual",
            "notStrictEqual",
            "ok",
            "rejects",
            "strict",
            "strictEqual",
            "throws"
          ]
        }
      }
    },
    "browserify-zlib": {
      "~0.2.0": {
        "namedExports": {
          "lib/index.js": [
            "Deflate",
            "DeflateRaw",
            "Gunzip",
            "Gzip",
            "Inflate",
            "InflateRaw",
            "Unzip",
            "Z_BEST_COMPRESSION",
            "Z_BEST_SPEED",
            "Z_BINARY",
            "Z_BLOCK",
            "Z_BUF_ERROR",
            "Z_DATA_ERROR",
            "Z_DEFAULT_CHUNK",
            "Z_DEFAULT_COMPRESSION",
            "Z_DEFAULT_LEVEL",
            "Z_DEFAULT_MEMLEVEL",
            "Z_DEFAULT_STRATEGY",
            "Z_DEFAULT_WINDOWBITS",
            "Z_DEFLATED",
            "Z_ERRNO",
            "Z_FILTERED",
            "Z_FINISH",
            "Z_FIXED",
            "Z_FULL_FLUSH",
            "Z_HUFFMAN_ONLY",
            "Z_MAX_CHUNK",
            "Z_MAX_LEVEL",
            "Z_MAX_MEMLEVEL",
            "Z_MAX_WINDOWBITS",
            "Z_MIN_CHUNK",
            "Z_MIN_LEVEL",
            "Z_MIN_MEMLEVEL",
            "Z_MIN_WINDOWBITS",
            "Z_NEED_DICT",
            "Z_NO_COMPRESSION",
            "Z_NO_FLUSH",
            "Z_OK",
            "Z_PARTIAL_FLUSH",
            "Z_RLE",
            "Z_STREAM_END",
            "Z_STREAM_ERROR",
            "Z_SYNC_FLUSH",
            "Z_TEXT",
            "Z_TREES",
            "Z_UNKNOWN",
            "Zlib",
            "codes",
            "createDeflate",
            "createDeflateRaw",
            "createGunzip",
            "createGzip",
            "createInflate",
            "createInflateRaw",
            "createUnzip",
            "deflate",
            "deflateRaw",
            "deflateRawSync",
            "deflateSync",
            "gunzip",
            "gunzipSync",
            "gzip",
            "gzipSync",
            "inflate",
            "inflateRaw",
            "inflateRawSync",
            "inflateSync",
            "unzip",
            "unzipSync"
          ]
        }
      }
    },
    "buffer": {
      "^5.0.8": {
        "namedExports": {
          "index.js": [
            "Buffer",
            "INSPECT_MAX_BYTES",
            "SlowBuffer",
            "kMaxLength"
          ]
        }
      }
    },
    "console-browserify": {
      "^1.1.0": {
        "namedExports": {
          "index.js": [
            "assert",
            "clear",
            "context",
            "count",
            "countReset",
            "debug",
            "dir",
            "dirxml",
            "error",
            "group",
            "groupCollapsed",
            "groupEnd",
            "info",
            "log",
            "memory",
            "profile",
            "profileEnd",
            "table",
            "time",
            "timeEnd",
            "timeStamp",
            "trace",
            "warn"
          ]
        }
      }
    },
    "constants-browserify": {
      "^1.0.0": {
        "namedExports": {
          "constants.json.js": [
            "DH_CHECK_P_NOT_PRIME",
            "DH_CHECK_P_NOT_SAFE_PRIME",
            "DH_NOT_SUITABLE_GENERATOR",
            "DH_UNABLE_TO_CHECK_GENERATOR",
            "E2BIG",
            "EACCES",
            "EADDRINUSE",
            "EADDRNOTAVAIL",
            "EAFNOSUPPORT",
            "EAGAIN",
            "EALREADY",
            "EBADF",
            "EBADMSG",
            "EBUSY",
            "ECANCELED",
            "ECHILD",
            "ECONNABORTED",
            "ECONNREFUSED",
            "ECONNRESET",
            "EDEADLK",
            "EDESTADDRREQ",
            "EDOM",
            "EDQUOT",
            "EEXIST",
            "EFAULT",
            "EFBIG",
            "EHOSTUNREACH",
            "EIDRM",
            "EILSEQ",
            "EINPROGRESS",
            "EINTR",
            "EINVAL",
            "EIO",
            "EISCONN",
            "EISDIR",
            "ELOOP",
            "EMFILE",
            "EMLINK",
            "EMSGSIZE",
            "EMULTIHOP",
            "ENAMETOOLONG",
            "ENETDOWN",
            "ENETRESET",
            "ENETUNREACH",
            "ENFILE",
            "ENGINE_METHOD_ALL",
            "ENGINE_METHOD_CIPHERS",
            "ENGINE_METHOD_DH",
            "ENGINE_METHOD_DIGESTS",
            "ENGINE_METHOD_DSA",
            "ENGINE_METHOD_ECDH",
            "ENGINE_METHOD_ECDSA",
            "ENGINE_METHOD_NONE",
            "ENGINE_METHOD_PKEY_ASN1_METHS",
            "ENGINE_METHOD_PKEY_METHS",
            "ENGINE_METHOD_RAND",
            "ENGINE_METHOD_STORE",
            "ENOBUFS",
            "ENODATA",
            "ENODEV",
            "ENOENT",
            "ENOEXEC",
            "ENOLCK",
            "ENOLINK",
            "ENOMEM",
            "ENOMSG",
            "ENOPROTOOPT",
            "ENOSPC",
            "ENOSR",
            "ENOSTR",
            "ENOSYS",
            "ENOTCONN",
            "ENOTDIR",
            "ENOTEMPTY",
            "ENOTSOCK",
            "ENOTSUP",
            "ENOTTY",
            "ENXIO",
            "EOPNOTSUPP",
            "EOVERFLOW",
            "EPERM",
            "EPIPE",
            "EPROTO",
            "EPROTONOSUPPORT",
            "EPROTOTYPE",
            "ERANGE",
            "EROFS",
            "ESPIPE",
            "ESRCH",
            "ESTALE",
            "ETIME",
            "ETIMEDOUT",
            "ETXTBSY",
            "EWOULDBLOCK",
            "EXDEV",
            "F_OK",
            "NPN_ENABLED",
            "O_APPEND",
            "O_CREAT",
            "O_DIRECTORY",
            "O_EXCL",
            "O_NOCTTY",
            "O_NOFOLLOW",
            "O_NONBLOCK",
            "O_RDONLY",
            "O_RDWR",
            "O_SYMLINK",
            "O_SYNC",
            "O_TRUNC",
            "O_WRONLY",
            "POINT_CONVERSION_COMPRESSED",
            "POINT_CONVERSION_HYBRID",
            "POINT_CONVERSION_UNCOMPRESSED",
            "RSA_NO_PADDING",
            "RSA_PKCS1_OAEP_PADDING",
            "RSA_PKCS1_PADDING",
            "RSA_PKCS1_PSS_PADDING",
            "RSA_SSLV23_PADDING",
            "RSA_X931_PADDING",
            "R_OK",
            "SIGABRT",
            "SIGALRM",
            "SIGBUS",
            "SIGCHLD",
            "SIGCONT",
            "SIGFPE",
            "SIGHUP",
            "SIGILL",
            "SIGINT",
            "SIGIO",
            "SIGIOT",
            "SIGKILL",
            "SIGPIPE",
            "SIGPROF",
            "SIGQUIT",
            "SIGSEGV",
            "SIGSTOP",
            "SIGSYS",
            "SIGTERM",
            "SIGTRAP",
            "SIGTSTP",
            "SIGTTIN",
            "SIGTTOU",
            "SIGURG",
            "SIGUSR1",
            "SIGUSR2",
            "SIGVTALRM",
            "SIGWINCH",
            "SIGXCPU",
            "SIGXFSZ",
            "SSL_OP_ALL",
            "SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION",
            "SSL_OP_CIPHER_SERVER_PREFERENCE",
            "SSL_OP_CISCO_ANYCONNECT",
            "SSL_OP_COOKIE_EXCHANGE",
            "SSL_OP_CRYPTOPRO_TLSEXT_BUG",
            "SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS",
            "SSL_OP_EPHEMERAL_RSA",
            "SSL_OP_LEGACY_SERVER_CONNECT",
            "SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER",
            "SSL_OP_MICROSOFT_SESS_ID_BUG",
            "SSL_OP_MSIE_SSLV2_RSA_PADDING",
            "SSL_OP_NETSCAPE_CA_DN_BUG",
            "SSL_OP_NETSCAPE_CHALLENGE_BUG",
            "SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG",
            "SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG",
            "SSL_OP_NO_COMPRESSION",
            "SSL_OP_NO_QUERY_MTU",
            "SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION",
            "SSL_OP_NO_SSLv2",
            "SSL_OP_NO_SSLv3",
            "SSL_OP_NO_TICKET",
            "SSL_OP_NO_TLSv1",
            "SSL_OP_NO_TLSv1_1",
            "SSL_OP_NO_TLSv1_2",
            "SSL_OP_PKCS1_CHECK_1",
            "SSL_OP_PKCS1_CHECK_2",
            "SSL_OP_SINGLE_DH_USE",
            "SSL_OP_SINGLE_ECDH_USE",
            "SSL_OP_SSLEAY_080_CLIENT_DH_BUG",
            "SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG",
            "SSL_OP_TLS_BLOCK_PADDING_BUG",
            "SSL_OP_TLS_D5_BUG",
            "SSL_OP_TLS_ROLLBACK_BUG",
            "S_IFBLK",
            "S_IFCHR",
            "S_IFDIR",
            "S_IFIFO",
            "S_IFLNK",
            "S_IFMT",
            "S_IFREG",
            "S_IFSOCK",
            "S_IRGRP",
            "S_IROTH",
            "S_IRUSR",
            "S_IRWXG",
            "S_IRWXO",
            "S_IRWXU",
            "S_IWGRP",
            "S_IWOTH",
            "S_IWUSR",
            "S_IXGRP",
            "S_IXOTH",
            "S_IXUSR",
            "UV_UDP_REUSEADDR",
            "W_OK",
            "X_OK"
          ]
        }
      }
    },
    "crypto-browserify": {
      "^3.12.0": {
        "namedExports": {
          "index.js": [
            "Cipher",
            "Cipheriv",
            "Decipher",
            "Decipheriv",
            "DiffieHellman",
            "DiffieHellmanGroup",
            "Hash",
            "Hmac",
            "Sign",
            "Verify",
            "constants",
            "createCipher",
            "createCipheriv",
            "createCredentials",
            "createDecipher",
            "createDecipheriv",
            "createDiffieHellman",
            "createDiffieHellmanGroup",
            "createECDH",
            "createHash",
            "createHmac",
            "createSign",
            "createVerify",
            "getCiphers",
            "getDiffieHellman",
            "getHashes",
            "listCiphers",
            "pbkdf2",
            "pbkdf2Sync",
            "privateDecrypt",
            "privateEncrypt",
            "prng",
            "pseudoRandomBytes",
            "publicDecrypt",
            "publicEncrypt",
            "randomBytes",
            "randomFill",
            "randomFillSync",
            "rng"
          ]
        }
      }
    },
    "domain-browser": {
      "^1.1.7": {
        "namedExports": {
          "source/index.js": [
            "create",
            "createDomain"
          ]
        }
      }
    },
    "events": {
      "^3.0.0": {
        "namedExports": {
          "events.js": [
            "EventEmitter",
            "defaultMaxListeners",
            "init",
            "listenerCount"
          ]
        }
      }
    },
    "https-browserify": {
      "^1.0.0": {
        "namedExports": {
          "index.js": [
            "Agent",
            "ClientRequest",
            "IncomingMessage",
            "METHODS",
            "STATUS_CODES",
            "get",
            "globalAgent",
            "request"
          ]
        }
      }
    },
    "os-browserify": {
      "~0.3.0": {
        "namedExports": {
          "browser.js": [
            "EOL",
            "arch",
            "cpus",
            "endianness",
            "freemem",
            "getNetworkInterfaces",
            "homedir",
            "hostname",
            "loadavg",
            "networkInterfaces",
            "platform",
            "release",
            "tmpDir",
            "tmpdir",
            "totalmem",
            "type",
            "uptime"
          ]
        }
      }
    },
    "path-browserify": {
      "^0.0.0": {
        "namedExports": {
          "index.js": [
            "_makeLong",
            "basename",
            "delimiter",
            "dirname",
            "extname",
            "format",
            "isAbsolute",
            "join",
            "normalize",
            "parse",
            "posix",
            "relative",
            "resolve",
            "sep",
            "win32"
          ]
        }
      }
    },
    "process": {
      "~0.11.10": {
        "namedExports": {
          "browser.js": [
            "addListener",
            "argv",
            "binding",
            "browser",
            "chdir",
            "cwd",
            "emit",
            "env",
            "listeners",
            "nextTick",
            "off",
            "on",
            "once",
            "prependListener",
            "prependOnceListener",
            "removeAllListeners",
            "removeListener",
            "title",
            "umask",
            "version",
            "versions"
          ]
        }
      }
    },
    "punycode": {
      "^2.1.0": {
        "namedExports": {
          "punycode.js": [
            "decode",
            "encode",
            "toASCII",
            "toUnicode",
            "ucs2",
            "version"
          ]
        }
      }
    },
    "querystring": {
      "~0.2.0": {
        "namedExports": {
          "index.js": [
            "decode",
            "encode",
            "parse",
            "stringify"
          ]
        }
      }
    },
    "stream-browserify": {
      "^2.0.1": {
        "namedExports": {
          "index.js": [
            "Duplex",
            "PassThrough",
            "Readable",
            "Stream",
            "Transform",
            "Writable",
            "super_"
          ]
        }
      }
    },
    "stream-http": {
      "^2.7.2": {
        "namedExports": {
          "index.js": [
            "Agent",
            "ClientRequest",
            "IncomingMessage",
            "METHODS",
            "STATUS_CODES",
            "get",
            "globalAgent",
            "request"
          ]
        }
      }
    },
    "string_decoder": {
      "~1.1.1": {
        "namedExports": {
          "lib/string_decoder.js": [
            "StringDecoder"
          ]
        }
      }
    },
    "timers-browserify": {
      "^2.0.10": {
        "namedExports": {
          "main.js": [
            "_unrefActive",
            "active",
            "clearImmediate",
            "clearInterval",
            "clearTimeout",
            "enroll",
            "setImmediate",
            "setInterval",
            "setTimeout",
            "unenroll"
          ]
        }
      }
    },
    "tty-browserify": {
      "^0.0.1": {
        "namedExports": {
          "index.js": [
            "ReadStream",
            "WriteStream",
            "isatty"
          ]
        }
      }
    },
    "url": {
      "~0.11.0": {
        "namedExports": {
          "url.js": [
            "Url",
            "format",
            "parse",
            "resolve",
            "resolveObject"
          ]
        }
      }
    },
    "util": {
      "~0.11.0": {
        "namedExports": {
          "util.js": [
            "_extend",
            "callbackify",
            "debuglog",
            "deprecate",
            "format",
            "inherits",
            "inspect",
            "isArray",
            "isBoolean",
            "isBuffer",
            "isDate",
            "isError",
            "isFunction",
            "isNull",
            "isNullOrUndefined",
            "isNumber",
            "isObject",
            "isPrimitive",
            "isRegExp",
            "isString",
            "isSymbol",
            "isUndefined",
            "log",
            "promisify"
          ]
        }
      }
    },
    "vm-browserify": {
      "^1.1.0": {
        "namedExports": {
          "index.js": [
            "Script",
            "createContext",
            "createScript",
            "isContext",
            "runInContext",
            "runInNewContext",
            "runInThisContext"
          ]
        }
      }
    }
  }
};
