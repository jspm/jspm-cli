jspm 2.0 Private Alpha
===

> Thank you for trying out jspm 2, and giving your feedback!
> This is a private experimental alpha release, so please keep all feedback to the issue queue here or other private channels.

## The What, Why and How

The concept of jspm is the concept of a workflow for JavaScript based on:

* Installing dependencies
* Easily executing those dependencies, without a build or further configuration, in both the browser and Node
* Providing workflows for production optimizations on projects, both for building whole applications and libraries.

The key concept being that the package manager, ecosystem and linker are all heavily entwined and have to exist together
to ensure these smooth workflows.

The first version got caught up in SystemJS as the spec for JS execution, and failed the moment the loader spec got derailed.

This version aims to realign with `<script type="module">`, modules in NodeJS and dynamic `import()` workflows.

The way modules are loaded is designed to exactly match the way modules load in NodeJS as this set the ecosystem conventions, with two main extensions:

1. We support loading from `jspm_packages` using a `jspm.json` lockfile read by the resolver itself, falling back to `node_modules` lookup when a package is not found.
2. We support the `package.json` `"mode": "esm"` flag for enabling `.js` extensions for ES modules (spec proposal for NodeJS at https://github.com/nodejs/node-eps/pull/60, with PR at https://github.com/nodejs/node/pull/18392)

The aim is to build and extend on shared community conventions, to ensure convention based workflows. Edge cases have to
all work out over a large ecosystem, so great care is taken to exactly support Node module resolution in all its edge cases,
while extending it.

The benefit of `jspm_packages` is that we can symlink all `jspm_packages/pkg@version` folders so we can reduce the size overhead of package installs considerably. In addition it is very useful for browser serving and caching.

From this base, we then provide execution in NodeJS, execution in the browser, and build support on these conventions.

Follow the quickstart below for the exact workflows here.

## jspm 2.0 Alpha Quickstart

1. [Install jspm 2.0 alpha](#1-install-jspm-20-alpha)
1. [Create a Project](#2-create-a-project)
1. [Install Dependencies](#3-install-dependencies)
1. [Execution in NodeJS](#4-execution-in-nodejs)
1. [Execution in the Browser](#5-execution-in-the-browser)
1. [Building for NodeJS](#6-building-for-nodejs)
1. [Dynamic Import Support](#7-dynamic-import-support)
1. [Building for the Browser](#8-building-for-the-browser)
1. [Automated Chunked Builds](#9-automated-chunked-builds)
1. [Building for Legacy Browsers](#10-building-for-legacy-browsers)

### 1. Install jspm 2.0 alpha

Make sure your GitHub SSH keys are configured correctly then:

```
npm install -g git+ssh://git@github.com/jspm/jspm2-cli#2.0
```

Also make sure to run NodeJS 8.9.0 or greater.

> Installing `jspm` installs `jspx` as well, working just like `npx`. Try it out!

### 1. Create a Project

`jspm init` is still in development for now, so create a new project manually:

```
mkdir jspm-test
cd jspm-test
echo '{ "mode": "esm" }' > package.json
```

### 2. Install Dependencies

As expected:

```
jspm install react react-dom lodash babel-core
```

Note peer dependencies are not yet quite properly implemented, so will give some warnings, but it will work out fine.

> Great care has been taken to make installs run really fast, as part of the package manager wars :)
> There's also support for `install --offline` and `install --prefer-offline` as expected these days!

### 3. Execution in NodeJS

test.js
```js
import clone from 'lodash/clone';

console.log(clone({ a: 'b' }));
```

```
jspm node test.js
```

When executing jspm is using the NodeJS `--experimental-modules` feature directly, configuring the jspm resolver through
the NodeJS `--loader` hooks so this is full native module support.

### 4. Execution in the Browser

The concept for supporting execution of modules in the browser is that we just need to feed a resolver through for loading
any ES modules with the package lookups of the node resolution.

So in principle, if we had support for a browser resolver, then this could be configured to load everything correctly directly in the browser without a build  (an HTML spec for this is still pending, but will likely be created at some point soon).

So while we still wait for a browser resolver, the route jspm takes is to provide a simple HTTP/2 server, that serves everything else as vanilla file system serving, but performs automatic resolution of ES modules when loaded.

There's the overlooked problem here of supporting CommonJS as well though, and that is handled through a special
transformation process that converts CommonJS modules into ES Modules, while supporting exact execution order
and circular references. This is called a [DEW transformation](https://github.com/jspm/babel-plugin-transform-cjs-dew) (deferred execution wrapper).

So until all modules in an app are ES modules, this transformation will be needed as well, and is done by the server.

In this way we can get full support for loading modules directly in the browser with just a `<script type="module">tag (almost unbuilt):

index.html
```html
<!doctype html>
<script type="module" src="test.js"></script>
```

```
jsps --open
```

In order to start an HTTP/2 server, the above will first generate a local client certificate with some prompts to follow.

Make sure you're running the latest dev release of Chrome, or Edge, or Firefox with the module flag set (although Firefox is terribly slow, this is a known bug being fixed currently there).

Open up the console and lodash is being loaded with separate files in the browser with just a module script to load it.

### 6. Building for NodeJS

By default `jspm build` will build for a NodeJS environment:

```js
jspm build test.js -o build.js
```

By default the output format will itself be an ES module. This can be changed with `--format cjs` etc.

We can then execute the built file with `jspm run build.js` or just `node build.js`.

### 7. Dynamic Import Support

We can update the example to use dynamic import:

test.js
```js
import clone from 'lodash/clone';

console.log(clone({ a: 'b' }));

import('babel-core').then(({ default: babel }) => {
  console.log(babel.transform('test').code);
});
```

If running Chrome dev or canary builds, the above should display both logs in the console.

Note also that we're loading over 500 modules in the browser. On first load this may take a few seconds, but with the browser cache enabled,
subsequent loads will be really fast as we're just using native modules (except in Firefox...), even if the server itself is restarted.

> Support for the `--harmony-dynamic-import` flag in NodeJS is coming in the next release. For now you need to run a custom build of NodeJS master to support running the above code in NodeJS via `jspm run test.js`.

### 8. Building for the Browser

We can now build this file, even with the dynamic import, for the browser:

```
jspm build test.js -o build.js --browser
```

We can then create a `test-build.html`:

```html
<!doctype html>
<script type="module" src="build.js"></script>
```

Both logs should display, with only one request in the network tab.

Because we are doing a single-file build, it has automatically inlined the dynamic import into the build.

Note also that `lodash/clone` shares dependencies with Babel. All of these interrelations are being correctly maintained without bundle duplication or changing CJS execution ordering.

### 9. Automated Chunked Builds

To do a multi-file build we can either pass multiple modules to `jspm build a.js b.js`, in which case a separate build file will be created for each, or we can use the `-d` flag to set an output directory instead of a file:

```
jspm build test.js -d dist --browser
```

Looking at `dist` we now see three separate files:

* `babel-core.js`, the dynamically loaded chunk.
* `test.js`, the initial load
* `chunk-<index>.js`, the chunk containing the shared code between `babel-core` and `test.js` (lodash clone)

We can also set the `--show-graph` flag when building to see the exact module breakdown here.

Updating `test-build.html`:
```html
<!doctype html>
<script type="module" src="dist/test.js"></script>
```

And running `jsps` (or using any other server), we now get three files loaded only in the network tab, with no code duplication.

> The algorithm used for chunking will create the minimum number of separate chunks needed to work over arbitrary numbers of entry points (`jspm build entryA.js entryB.js, ...`), and dynamic imports, while never duplicating code between chunks. I call this the maximal disjoint chunking algorithm.

### 10. Building for Legacy Browsers

The way the chunks work still uses dynamic import and ES module syntax to load the separate files in the browser.

To get this same loading working in legacy browsers, we can build into the `system` module format and use the small SystemJS production loader build.

```
jspm install systemjs
jspm build test.js -d dist --browser --format system
```

We then update `test-build.html`:
```html
<!doctype html>
<script src="jspm_packages/npm/systemjs@0.20.19/dist/system-production.js"></script>
<script>System.import('dist/test.js')</script>
```

And running `jspm s` or another server `test-build.html` now supports all browsers, with modular loading and dynamic import behaving as to spec (it's a proto-polyfill workflow).

