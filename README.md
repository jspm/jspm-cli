jspm 2.0 Private Beta
===

Thanks for trying out the jspm 2.0 beta. Your feedback will shape the final release.

**This is a private experimental beta release, the code and technical architecture are not currently public, please do not share any of the code or technical details publicly.**

## Reminder: what jspm does

The basic concept of jspm is the concept of a workflow for JavaScript based on:

* Installing dependencies
* Easily executing those dependencies, without a build or further configuration, in both the browser and Node using the native JavaScript module loader.
* Enabling workflows for production optimizations on projects, both for building whole applications and libraries.

The stretch long-term mission of the project is to investigate how published packages can be optimized for production-level delivery directly to the browser in a decentralized way for fine-grained cache sharing, and these associatead workflows.

The package manager, ecosystem and linker are all heavily entwined and have to exist together to ensure these workflows don't get brought down by compatibility frictions.

## Basic Architecture

The first version was based on SystemJS as the spec for JS execution, which became stalled when that spec was no longer supported.

This version aims to realign with:

* `<script type="module">` and dynamic `import()`
* NodeJS support for ES modules (must remain compatible with however Node adopts ES modules).
* Building all CommonJS modules into ES modules _on install_ for native browser modules support.
* Package name maps in browsers using the [ES Module Shims](https://github.com/guybedford/es-module-shims) project to get these to work in all modular browsers today.
* Using SystemJS as the "legacy workflow" for browsers without modules support

The benefit of this approach is that the model becomes very simple:

**jspm installs only ES modules, and then you just need to use the jspm resolver to work with them.**

Since loading only requires the jspm resolver, it is easy to provide into existing build tools by just writing a wrapper plugin. Node.js and browser support similarly are simply resolver-level (Node.js through a custom module loader resolve hook and the browser through import maps).

These workflows above will all make further sense in how they come together going through this guide.

## jspm 2.0 Beta Quickstart Guide

1. [Install jspm 2.0 beta](#1-install-jspm-20-beta)
1. [Create a Project](#2-create-a-project)
1. [Install Dependencies](#3-install-dependencies)
1. [Executing ES Modules](#4-executing-es-modules)
1. [Execution in the Browser](#5-execution-in-the-browser)
1. [Building for the Browser](#6-building-for-the-browser)
1. [Building for Legacy Browsers](#7-building-for-legacy-browsers)
1. [Partial Builds](#8-partial-builds)
1. [Running a Custom Build](#9-running-a-custom-build)
1. [Debugging Helpers](#10-debugging-helpers)
1. [CDN Package Maps](#11-cdn-package-maps)

* [Architecture Summary](#architecture-summary)

### 1. Install jspm 2.0 beta

Make sure your GitHub SSH keys are configured correctly then:

```
npm install -g git+ssh://git@github.com/jspm/jspm2-cli#2.0
```

Also make sure to run NodeJS 10.x or greater.

To see the full list of options available run `jspm help`. This guide only touches on the basics.

### 2. Create a Project

`jspm init` is still in development for now, so create a new project manually:

```
mkdir jspm-test
cd jspm-test
echo '{}' > package.json
```

### 3. Install Dependencies

As expected:

```
jspm install lodash @babel/core
```

This will populate the dependencies in `package.json` and also generate a `jspm.json` lockfile. _Do not delete either of these, as both are used by the resolver._

> A lot of effort has been made to make installs run really fast. There's also support for `install --offline` and `install --prefer-offline` as expected these days.

### 4. Executing ES Modules

test.js
```js
import clone from 'lodash/clone.js';

console.log(clone({ a: 'b' }));

import('@babel/core').then(({ default: babel }) => {
  console.log(babel.transform('test').code);
});
```

```
jspm test.js
```

When executing jspm is using the NodeJS `--experimental-modules` feature directly, configuring the jspm resolver through the NodeJS `--loader` hooks so this is using full native ES module support in Node.js.

> This will support Node 8.x and up, although dynamic import is only supported in Node 10.x and up

To see how jspm is executing Node.js running `jspm bin` will output the Node.js execution command:

```
jspm bin
```

This command can be used directly to execute Node.js with the jspm resolution - all jspm needs to work in any execution environment, builder or other tool is a resolver hook to integrate the jspm_packages resolution.

### 5. Execution in the Browser

To run a local server lets install `http-server` from npm with jspm:

```
jspm install http-server --dev
jspm_packages/.bin/http-server
```

> If running in Windows, use `jspm_packages/.bin/http-server.cmd` in the above.

jspm supports many npm packages using the same jspm_packages resolution and ES module conversion that we run in the browser.
It's all running through --experimental-modules, ES modules and the jspm resolver.

We can then set this up with a package.json script just like with npm:

```json
{
  "scripts": {
    "serve": "http-server"
  }
}
```

which will then support:

```
jspm run serve
```

Now to execute our original example in the browser, we can create a import map:

```
jspm map ./test.js -o importmap.json
```

This will create just the maps necessary to load `lodash/clone`.

> `jspm map` with no arguments will create the full import map for everything that is installed. By default import maps are created based on browser development environment. Passing `--production` will resolve based on the production conditional.

To support import maps in the browser, we need to use the es-module-shims project:

```
jspm install es-module-shims --dev
```

To find out where `es-module-shims` is located we can use `jspm resolve`:

```
jspm resolve --relative es-module-shims
jspm_packages/npm/es-module-shims@0.2.3/dist/es-module-shims.js
```

We can then reference this path to load that file directly in an HTML file:

test.html
```html
<!doctype html>
<script type="module" src="jspm_packages/npm/es-module-shims@0.2.3/dist/es-module-shims.js"></script>
<script type="importmap-shim" src="importmap.json"></script>
<script type="module-shim" src="test.js"></script>
```

Running `jspm run serve` we can load this page to see the expected results in the console.

**We are loading 100s of ES modules converted from Node.js semantics to work natively in the browser with only a import map.**

> [ES Module Shims](https://github.com/guybedford/es-module-shims) supports package name maps only for browsers that already support ES modules. Its module lexing is fast enough that it is actually suitable for prodution workflows. When import maps are natively supported in browsers, this project will no longer be necessary.

### 6. Building for the Browser

Since Lodash is not optimized for browser delivery we still want to do a modular build for production.

To build with Rollup, we can use the `jspm build` command:

```
jspm build test.js --inline-deps --production
```

> By default `jspm build` will build for the browser development environment. Use `--node` to build for Node.js resolution (not applying the package.json "browser" field).

By default, jspm will automatically treat any `"dependencies"` of the project as externals, so `--inline-deps` will ensure lodash and babel are bundled into our build files.

This will output a file at `dist/test.js` containing our build.

We can now update the test page to reference this build file:

test-build.html
```html
<!doctype html>
<script type="module" src="jspm_packages/npm/es-module-shims@0.2.3/dist/es-module-shims.js"></script>
<script type="module-shim" src="dist/test.js"></script>
```

Loading the page in the browser with `jspm run serve` notice how we are just loading three files now:

* The initial chunk that loads lodash/clone
* The dynamic chunk that loads Babel
* A shared chunk containing dependencies shared between both of the above

We thus have an optimal build for distributing to users for a fast load.

> Use `--watch` for a watched build while developing.

### 7. Building for Legacy Browsers

To support this same code in legacy browsers, we build into the SystemJS module format:

```
jspm build test.js -f system -o dist-system --inline-deps
```

Install SystemJS, and verify its path:

```
jspm install systemjs --dev
```

We can then update `test-build.html` to work in both legacy and modern browsers with the following:

```html
<!doctype html>
<script type="module" src="jspm_packages/npm/es-module-shims@0.2.3/dist/es-module-shims.js"></script>
<script type="module-shim" src="dist/test.js"></script>

<script nomodule src="jspm_packages/npm/systemjs@3.1.0/dist/s.min.js"></script>
<script nomodule>System.import('./dist-system/test.js')</script>
```

Since both es-module-shims and SystemJS support import maps, we can provide full modular workflows using these techniques back to IE11!

For IE11 support, [see the polyfills section of the SystemJS readme](https://github.com/systemjs/systemjs#polyfills-for-older-browsers),
note the appropriate Babel plugins for browser support would need to be applied as well, see the custom builds section shortly.

### 8. Partial Builds

A key concept that is enabled by the fact that we are building ES modules is that unlike previous bundling approaches, there is no cost to iterative builds.

That is, we can build parts of an application together, then bundle those parts into other importers again. Building can mix in this way any number of times.

For example, say `test.js` was split into two separate files:

test.js
```js
import clone from 'lodash/clone.js';
import './test-babel.js';

console.log(clone({ a: 'b' }));
```

test-babel.js
```js
import('@babel/core').then(({ default: babel }) => {
  console.log(babel.transform('test').code);
});
```

Now lets leave out the `--inline-deps` option:

```
jspm build test.js --production
```

Even though we've now done a build, we can still generate a import map for the built application, and only the external packages used will be included:

```
jspm map ./dist/test.js -o importmap.json
```

Alternatively, if lodash/clone.js was small enough it might make sense to inline, leaving only the Babel dependency external:

```
jspm build test.js --inline-deps --external lodash/clone.js
```

It is this kind of balance that needs to be worked out in configuring the external boundary for the local build.

Ideally, this kind of partial build should be done for all packages before publishing.

> While Babel and Lodash are not optimized themselves, if all packages performed these sorts of optimizations on publish, then we would be getting 10s of requests in the browser not 100s, and these workflows may even become suitable in production.

### 9. Running a Custom Build

The `jspm build` command only offers the very basic JS semantics for builds. For custom build configurations, you'll usually want
to "eject" out of this workflow and just use Rollup directly.

Let's do that now:

```
jspm install rollup rollup-plugin-jspm=github:jspm/rollup-plugin-jspm --dev
```

Create the following `rollup.config.js`:

```js
import jspmPlugin from 'rollup-plugin-jspm';

export default {
  input: ['test.js'],
  output: {
    dir: 'dist',
    format: 'esm'
  },
  plugins: [jspmPlugin({
    env: {
      production: true
    }
  })]
};
```

We can then run `jspm_packages/.bin/rollup -c` or again set this up as a package.json "scripts" entry.

> To build for Node.js set the `env.node: true` build flag.

In this way we can now add any custom configuration support for Babel / TypeScript etc.

Because the jspm plugin is just a `resolve` function in Rollup, it is very simple to make plugins for Webpack, Parcel and other tools. Help expanding this is very welcome!

### 11. CDN Package Maps

Instead of building a import map against the local jspm_packages packages folder, the jspm CDN can be used instead as the import map target.

To do this in the original import map example we just add the `--cdn` flag:

```
jspm map ./test.js -o importmap.json --cdn
```

Loading the previous `test.html` in the browser, in the network tab all requests are now made against `https://mapdev.jspm.io`.

Because the structure of jspm_packages is universal, we can just change the reference in this way.

To use a custom jspm_packages path such as your own CDN library server use `--jspmPackages https://mysite.com` rather.

## Further Features not yet covered in this tutorial or docs

TODO: flesh these out!

(see also `jspm help`)

* `jspm clean` to clear jspm_packages
* `jspm link` for linking local projects
* `jspm checkout` for modifying installed packages
* Custom registries
* Global configuration API
* Authentication management
* `jspm resolve`
* Map configuration and conditional resolution
* `jspm publish` for publishing

## Architecture Summary

Having gone through the practical workflow, these are some of key architectural decisions worth clarifying:

### Detecting ES Modules

How do we know what are ES modules and what are normal JS?

The naive approach is to detect export and import statements, but the edge case then is modules that don't have either. Should these be loaded as CJS semantics or ESM semantics (and yes there are huge differences in terms of when execution ordering happens and how errors are thrown, which may not sound like much but is important).

This is handled by a `"mode": "esm"` flag in the package.json, in line with what Node.js can implement (https://github.com/nodejs/node/pull/18392).

If you publish a jspm package to npm, **you must include this `"mode": "esm"` flag in the package.json file**. Otherwise the package will not load properly.

When `jspm publish` is included, it will inject this automatically so that you don't need to think about this problem.

Support would be very much appreciated when the time for this decision comes in Node.js, as this is a fundamental architecture decision of jspm at this point.

### Building CommonJS into ES Modules

Building CommonJS into ES modules is done through a special wrapper transform. This can be disabled for a package by adding `"mode": "esm"` to the package.json or a sub folder in the package with a package.json, or by adding `"noModuleConversion": true` or `"noModuleConversion: ["file.js", "dir"]` for files not to convert.

These can be added with overrides as well on install via `jspm install x -o mode=esm` or `jspm install x -o noModuleConversion=["file.js"]`

When installing es-module-shims and systemjs both of these packages have the `"mode": "esm"` present to avoid being built so they can work through script tags. Otherwise the wrapper conversion would stop these script tags from working.

These problems go away with ES module adoption though.

The CommonJS conversion still isn't perfect, but supports the 99% even including things like:

* Circular references and exact exports bindings semantics are maintained
* Tracing dynamic require as much as possible - eg require('./' + unknown)
* Rewriting sloppy code into strict mode code
* Handling reassignment of module.exports
* Rewriting __filename and __dirname to import.meta.url statements
* Support for Node.js binaries

The added benefit this conversion is it makes CommonJS easy to treeshake in Rollup meaning smaller bundles than Webpack in many cases. Improving this analysis is ongoing, and we can still likely find deeper optimizations to add to Rollup here.

### Named Exports Support

Named exports from CommonJS are not currently supported, only the default export.

It can be possible to support these in the CommonJS conversion using code analysis, but we can only follow what Node.js implements here.

As soon as it is clear named exports from CommonJS in ES Modules will be supported for Node.js, then jspm will implement them.

In the mean time, named exports can be manually declared when needed using an override or package config:

```js
jspm install lodash -o namedExports[clone.js]=[a,b,c] namedExports[another.js]=[c,d,e]
```

### jspm Resolver and Package Map Support

Package maps provide support for mapping plain names - `jquery` or `lodash/clone`. But they do not provide support for mapping relative requires - `./x`.

**For this reason, file extensions are mandatory in resolution. There is no automatic extension adding or directory index support.**

The resolver basically does the following:

1. If it is a relative or absolute resolution, just return the URL resolution.
2. Detect the project boundaries of the current module (from jspm.json / jspm_packages locations)
3. If requesting a package directly, add the package.json "main"
4. If requesting a subpath of the package, support custom "map" config from the package.json
5. Finally return the resolved module.

The resolver will also fall back to loading from node_modules for packages that aren't found (including loading as CommonJS). This allows for fallback cases where eg CJS conversion doesn't quite work, or for gradual upgrade paths into jspm.

For more information, the resolution algorithm is explained in fine detail at https://github.com/jspm/jspm-resolve/blob/master/resolver-spec.md.

### Implementing and using the jspm resolver

The jspm resolver API is provided as a library. This will be available at `npm install @jspm/resolve` on public release, but for now it is only available via the `jspm/jspm-resolve` GitHub project.

Using the resolver plugins can be written to integrate jspm resolution into any framework / tool.

Parcel and Webpack resolver plugins still need to be done. If you work on this for any tools, please do share your work!

For an example of how it is used to resolve modules correctly, see the rollup-plugin-jspm project here - https://github.com/jspm/rollup-plugin-jspm/blob/master/jspm-rollup.js#L27.
