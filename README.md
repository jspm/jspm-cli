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

Since loading only requires the jspm resolver, it is easy to provide into existing build tools by just writing a wrapper plugin. Node.js and browser support similarly are simply resolver-level (Node.js through a custom module loader resolve hook and the browser through package maps).

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
1. [Transpilation Builds](#9-transpilation-builds)
1. [Debugging Helpers](#10-debugging-helpers)

* [Architecture Summary](#architecture-summary)

### 1. Install jspm 2.0 beta

Make sure your GitHub SSH keys are configured correctly then:

```
npm install -g git+ssh://git@github.com/jspm/jspm2-cli#2.0
```

Also make sure to run NodeJS 10.x or greater.

> Installing `jspm` installs `jspx` as well, working just like `npx`. Try it out!

### 2. Create a Project

`jspm init` is still in development for now, so create a new project manually:

```
mkdir jspm-test
cd jspm-test
echo '{ "jspm": {} }' > package.json
```

> By using the `jspm` prefix, we can have `npm` and `jspm` have separate dependencies in the same project. We will use this for building shortly.

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
jspm-node test.js
```

When executing jspm is using the NodeJS `--experimental-modules` feature directly, configuring the jspm resolver through the NodeJS `--loader` hooks so this is using full native ES module support in Node.js.

> If you get an error when running this, you may not be on the latest Node.js version. Only Node.js 10.x supports dynamic import through native ES modules.

### 5. Execution in the Browser

To execute the above file in the browser, we can create a package map:

```
jspm map ./test.js -o packagemap.json
```

This will create just the maps necessary to load `lodash/clone`.

> `jspm map` with no arguments will create the full package map for everything that is installed. By default package maps are created based on browser development environment. Passing `--production` will resolve based on the production conditional.

To support package maps in the browser, we need to use the es-module-shims project:

```
jspm install es-module-shims --dev
```

test.html
```html
<!doctype html>
<script type-"module" src="jspm_packages/npm/es-module-shims@0.1.11/dist/es-module-shims.js"></script>
<script type="packagemap-shim" src="packagemap.json"></script>
<script type="module-shim" src="test.js"></script>
```

Run any local server to load the page (eg `jspx http-server`), and you should see the code running in the browser console.

**We are loading 100s of ES modules converted from Node.js semantics to work natively in the browser with only a package map.**

> jspx is just like npx, but for jspm. A jspm install is run in the background to a private package and everything is executed as Node-native ES modules with the jspm resolver.

> [ES Module Shims](https://github.com/guybedford/es-module-shims) supports package name maps only for browsers that already support ES modules. Its module lexing is fast enough that it is actually suitable for prodution workflows. When package maps are natively supported in browsers, this project will no longer be necessary.

### 6. Building for the Browser

Since Lodash is not optimized for browser delivery we still want to do a modular build for production.

jspm no longer bundles a build workflow, rather it makes it very easy to work with other build tools.

To build with Rollup first make sure it is installed with npm:

```
npm install -g rollup && npm install git+ssh://github.com/jspm/rollup-plugin-jspm --save-dev
```

> We need to use npm here as getting `rollup` working through jspm is currently blocked as Rollup uses `require.extensions` methods to load the `rollup.config.js` file. Apart from that `jspx rollup x.js` does work though!

Create the following `rollup.config.js`:

```js
import jspmResolve from 'rollup-plugin-jspm';

export default {
  input: ['test.js'],
  experimentalCodeSplitting: true,
  output: {
    dir: 'dist',
    format: 'esm'
  },
  plugins: [jspmResolve({
    env: {
      production: true
    }
  })]
};
```

And running `rollup -c`.

> To build for Node.js set the `env.node: true` build flag.

This will build a `dist` folder containing `test.js` and a separate file for Babel itself, along with a shared chunk.

Only the code shared between lodash and Babel is in the shared chunk, which is loaded on startup, before the dynamic import loads the Babel-specific chunk which shares parts of Lodash with the base chunk.

We are still building ES modules, so we still use ES-Module-Shims to load this in the browser:

test-build.html
```html
<!doctype html>
<script type="module" src="jspm_packages/npm/es-module-shims@0.1.11/dist/es-module-shims.js"></script>
<script type="module-shim" src="dist/test.js"></script>
```

All we needed to change for the built version is to use the `dist/test.js` module instead of the original file.

### 7. Building for Legacy Browsers

To support this same code in legacy browsers, we build into the SystemJS module format.

We can configure Rollup to do two builds for us:

```js
import jspmResolve from 'rollup-plugin-jspm';

export default {
  input: ['test.js'],
  experimentalCodeSplitting: true,
  output: [{
    dir: 'dist',
    format: 'esm'
  }, {
    dir: 'dist-legacy',
    format: 'system'
  }],
  plugins: [jspmResolve({
    env: {
      production: true
    }
  })]
};
```

Install SystemJS 2.0:

```
jspm install systemjs --dev
```

We can then update `test-build.html` to work in both legacy and modern browsers with the following:

```html
<!doctype html>
<script type="module" src="jspm_packages/npm/es-module-shims@0.1.11/dist/es-module-shims.js"></script>
<script type="module-shim" src="dist/test.js"></script>

<script nomodule src="jspm_packages/npm/systemjs@2.0.1/dist/s.min.js"></script>
<script nomodule>System.import('./dist-legacy/test.js')</script>
```

For IE11 support, [see the polyfills section of the SystemJS readme](https://github.com/systemjs/systemjs#polyfills-for-older-browsers).

Support for loading jspm_packages through SystemJS is not currently provided. A jspm_packages_system variation could be provided as a future feature.

### 8. Partial Builds

A key concept that is enabled by the fact that we are building ES modules is that unlike previous bundling approaches, there is no cost to iterative builds.

That is, we can build parts of an application together, then bundle those parts into other importers again. Building can mix in this way any number of times losslessly.

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

We can build our local code, while keeping externals being referenced separately with the following Rollup configuration:

```js
import jspmResolve from 'rollup-plugin-jspm';

export default {
  input: ['test.js'],
  experimentalCodeSplitting: true,
  external: ['lodash/clone.js', '@babel/core'],
  output: {
    dir: 'dist',
    format: 'esm'
  },
  plugins: [jspmResolve({
    env: {
      production: true
    }
  })]
};
```

And running `rollup -c`.

Even though we've now done a build, we can still generate a package map for the built application, and only the external packages used will be included:

```
jspm map ./dist/test.js -o packagemap.json
```

If lodash/clone.js was small enough it might make sense to inline, leaving only the Babel dependency external. It is this kind of balance that needs to be worked out in configuring the external boundary for the local build.

This kind of partial build should be done for all packages before publishing.

> While Babel and Lodash are not optimized themselves, if all packages performed these sorts of optimizations on publish, then we would be getting 10s of requests in the browser not 100s, and these workflows may even become suitable in production.

### 9. Transpilation Builds

If you want to use Babel / TypeScript etc, there are basically two standard approaches to this:

#### 1. Per-file Pre-compilation Build

* Write a `src/` folder containing the uncompiled `.js` or `.ts` code. 
* Have a build command / watcher that converts this `src/` folder into a `lib/` folder as build js files.
* Run the jspm per-file loading and Rollup build against this lib folder.

This is a good workflow because per-file-caching is provided making it fast for rebuilds, while also enabling per-file loading in both Node and the browser early in the workflow as well.

#### 2. The Monolithic Build

* Have the Rollup or other custom build step do the compilation at the same time as the main build.
* In the example above, that means adding a TypeScript or Babel plugin to the `rollup.config.js` file.

This works fine too!

Note that one catch with these workflows is that you must ensure that the `.js` file extensions are included by the compiler.

When using TypeScript with (1) this isn't currently easy to configure unfortunately, but TypeScript will need to provide a solution here if/when Node.js decides not to add default .js extensions. It should be possible to configure this in Rollup or Webpack builds when doing (2) though. Any easy workflows you come up with here are very welcome to be shared as starter repos.

### 10. Debugging Helpers

Two useful helpers when debugging resolution in jspm are `jspm resolve` and `jspm trace`.

`jspm resolve` provides a way to see the resolution for any module:

```
jspm resolve lodash
   /path/to/jspm_packages/npm/lodash@4.17.11/lodash.js
```

This will only resolve packages that are top-level installed.

If we wanted to see how @babel/core is itself resolving a dependency import we can do relative resolution with:

```
jspm resolve json5 ./jspm_packages/npm/@babel/core@7.1.2/
   /path/to/jspm_packages/npm/json5@0.5.1/lib/json5.js
```

The second argument means _resolve relative to this parent_.

This parent can itself also be a top-level unresolved dependency:

```
jspm resolve json5/package.json @babel/core
   /path/to/jspm_packages/npm/json5@0.5.1/package.json
```

We can even resolve in different environments by passing the `--node` and `--production` flags (default is always browser dev for jspm).

`jspm trace` works similarly, but will trace the entire tree, throwing on any resolution or loading issues, and returning the full resolution map:

```
jspm trace @babel/core/lib/config/helpers/environment.js
{
  "file:///path/to/jspm_packages/npm/@babel/core@7.1.2/lib/config/helpers/environment.dew.js": {
    "process": "file:///path/to/jspm_packages/npm/@jspm/node-builtins@0.1.2/process.js"
  },
  "file:///path/to/jspm_packages/npm/@babel/core@7.1.2/lib/config/helpers/environment.js": {
    "./environment.dew.js": "file:///path/to/jspm_packages/npm/@babel/core@7.1.2/lib/config/helpers/environment.dew.js"
  }
}
```

## Further Features not yet covered in this tutorial or docs

TODO: flesh these out!

(see also `jspm help`)

* `jspm link` for linking local projects
* `jspm checkout` for modifying installed packages
* Custom registries
* Global configuration API
* Authentication management
* `jspm resolve`
* Map configuration and conditional resolution
* CDN Workflows (coming soon!)

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

Building CommonJS into ES modules is done through a special wrapper transform. This can be disabled for a package by adding `"mode": "esm"` to the package.json or a sub folder in the package with a package.json, or by adding `"skipESMConversion": true` or `"skipESMConversion: ["file.js", "dir"]` for files not to convert.

These can be added with overrides as well on install via `jspm install x -o mode=esm` or `jspm install x -o skipESMConversion=["file.js"]`

When installing es-module-shims and systemjs both of these packages have the `"mode": "esm"` present to avoid being built so they can work through script tags. Otherwise the wrapper conversion would stop these script tags from working.

These problems go away with ES module adoption though.

The CommonJS conversion still isn't perfect, but supports the 99% even including things like:

* Circular references and exact exports bindings semantics are maintained
* Tracing dynamic require as much as possible - eg require('./' + unknown)
* Rewriting sloppy code into strict mode code
* Handling reassignment of module.exports
* Rewriting __filename and __dirname to import.meta.url statements

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

The jspm resolver also provides [an ES module loader for Node.js loading](https://nodejs.org/dist/latest-v10.x/docs/api/esm.html#esm_loader_hooks), which can be used via:

```
node --experimental-modules --loader @jspm/resolve/loader.mjs
```

`jspm-node` is just a bin alias for the above.

For tools like Mocha, support can be added just through the NODE_OPTIONS environment variable:

```js
NODE_OPTIONS="--experimental-modules --loader \"@jspm/resolve/loader.mjs\"" mocha
```

## How you can help

Many of the above architecture decisions follow Node.js quite closely. I'm working on a number of PRs, proposals and discussions to ensure as much compatibility with Node.js as possible on the above.

At some point the time will come for decisions here in Node, and your support at such a point would be highly appreciated if you care about these jspm-style workflows.
