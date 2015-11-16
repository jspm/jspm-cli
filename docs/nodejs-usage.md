jspm is primarily a browser package manager, but there are massive benefits to enabling workflows that allow the same JavaScript code to run in both the browser and Node. As such, jspm also enables some basic usage on the server as well.

**It is advisable not to use jspm for arbitrary server applications currently** as there are two major issues with Node module npm support that are limiting use of jspm in Node:

1. Browserify transforms support (https://github.com/jspm/npm/issues/10)
2. Packages with a `browser` field will always use that browser mapping even in Node (https://github.com/jspm/npm/issues/32), pending [conditional loading support in SystemJS](https://github.com/systemjs/systemjs/issues/285).

### jspm run

`jspm run` allows the immediate execution of any module from the command-line:

```
  jspm install fs
  echo "import fs from 'fs';\
    console.log(fs.readFileSync('package.json')+'');" > test.js
  jspm run test
```

### jspm.import

Just like `jspm run`, the [jspm API provides an import function](api.md#import) with the same functionality.

### Node Core and Browserify support

All Node core modules are available in the jspm registry and can be installed by their names.

This includes: assert, buffer, child_process, cluster, console, constants, crypto, dgram, dns, domain, events, fs, http, https, net, os, path, process, punycode, querystring, readline, repl, stream, string_decoder, timers, tls, tty, url, util, vm, zlib.

When running in Node, they use their native implementations, and when running the browser, the [Browserify core shims](https://github.com/substack/node-browserify#compatibility) are used instead.
