# CLI API Documentation

**Current CLI Version: 3.0**

## Install

```
npm install -g jspm
```

Node.js 10.x or greater must be installed (Node.js 8.x will also work, but without dynamic import support).

To see the full list of options available run `jspm help`. This guide only touches on the basics.

## Create a Project

```
mkdir jspm-test
cd jspm-test
```

## Install Dependencies

```
jspm install lodash @babel/core
```

This populates the dependencies in `package.json` and will also generate a `jspm.json` lockfile.

> Installs have been heavily optimized for performance, and include support for `install --offline` and `install --prefer-offline`.

After install if you inspect the package.json it will now contain a `"type": "module"` field. This matches the Node.js [`--experimental-modules` support for ES modules in `.js` files](http://2ality.com/2019/04/nodejs-esm-impl.html#filename-extensions). Set this to `"commonjs"` if working with CommonJS files.

## ES Modules in Node.js

To load the installed dependencies as ES modules:

test.js
```js
import clone from 'lodash/clone.js';

console.log(clone({ a: 'b' }));

import('@babel/core').then(({ default: babel }) => {
  console.log(babel.transform('test').code);
});
```

and execute this file with:

```
jspm test.js
```

When executing jspm is using the NodeJS `--experimental-modules` native modules support directly, configuring the jspm resolver through the NodeJS `--loader` hooks so this is using full native ES module support in Node.js.

> The jspm resolver is backwards-compatible with the Node.js resolver. Dependencies will be loaded from `node_modules` if not found in `jspm_packages`.

To see how jspm is executing Node.js running `jspm bin --cmd` will output the Node.js execution command:

```
jspm bin --cmd
```

This command can be used directly to execute Node.js with the jspm resolution. All jspm needs to work in any execution environment, builder or other tool is the [jspm resolver](https://github.com/jspm/jspm-resolve) hook to integrate the jspm_packages resolution.

## http-server bin Script

To run a local server install `http-server` from npm with jspm:

```
jspm install http-server --dev
jspm_packages/.bin/http-server
```

> If running on Windows, use `jspm_packages/.bin/http-server.cmd` in the above.

Alternatively, use the `jspm bin` command to execute the correct local bin script:

```
jspm bin http-server
```

jspm supports many npm packages in Node.js using the same `jspm_packages` resolution and ES module conversion that is designed for the browser. In this example, the whole of `http-server` and all its dependencies are executing as ES modules in Node.js, running through `--experimental-modules` and the jspm resolver.

> Global installs and global bins are supported via `jspm install -g`, although this should be used sparingly.

Optionally, set this up to run as a package.json script:

```json
{
  "scripts": {
    "serve": "http-server"
  }
}
```

to use it with:

```
jspm run serve
```

## Browser Modules with Import Maps

Import Maps are currently an experimental feature in Chrome 74 (April 23 release). To use Import Maps in Chrome, first enable the **Experimental Web Platform Features** flag in **chrome://flags**, or copy the URL below directly:

```
chrome://flags/#enable-experimental-web-platform-features
```

Create an import map for a specific module with:

```
jspm map ./test.js -o importmap.json --flat-scope --map-base .
```

Going through the command step-by-step:

* The `map` command is tracing the `./test.js` module, working out all the dependency resolutions it needs to load properly, and populating only the needed maps into `importmap.json` (shown below). _The leading `./` here is important, without it the command would attempt to map a dependency called `test.js`, which would fail._
* The `-o` flag argument sets the output file for the map, `importmap.json`.
* The `--flat-scope` (`-f`) flag tells jspm not to use the import maps [scopes](https://github.com/wicg/import-maps#scoping-examples) feature, which is not yet supported in Chrome. Note that when using this flag, any multi-version conflicts will cause a hard error.
* The `--map-base .` flag argument tells jspm to output absolute paths in the import map, relative to the current directory. This is needed because Chrome doesn't yet support loading import maps from URLs, so this will come in useful in how the import map is loaded below.

> `jspm map` can be called against any number of modules to create a map that maps all of those modules. Providing no arguments will create one big map for all installed dependencies.

<details>
<summary><code>importmap.json</code></summary>
<pre><code class="language-json">{
  "imports": {
    "@babel/core": "/jspm_packages/npm/@babel/core@7.4.3/lib/index.js",
    "buffer": "/jspm_packages/npm/@jspm/core@1.0.4/nodelibs/buffer.js",
    "fs": "/jspm_packages/npm/@jspm/core@1.0.4/nodelibs/@empty.js",
    "lodash/": "/jspm_packages/npm/lodash@4.17.11/",
    "path": "/jspm_packages/npm/@jspm/core@1.0.4/nodelibs/path.js",
    "process": "/jspm_packages/npm/@jspm/core@1.0.4/nodelibs/process.js",
    "@babel/highlight/": "/jspm_packages/npm/@babel/highlight@7.0.0/",
    "@babel/code-frame/": "/jspm_packages/npm/@babel/code-frame@7.0.0/",
    "@babel/core/lib/config/files/index.dew.js": "/jspm_packages/npm/@babel/core@7.4.3/lib/config/files/index-browser.dew.js",
    "@babel/core/lib/transform-file.dew.js": "/jspm_packages/npm/@babel/core@7.4.3/lib/transform-file-browser.dew.js",
    "@babel/generator/": "/jspm_packages/npm/@babel/generator@7.4.0/",
    "@babel/helpers/": "/jspm_packages/npm/@babel/helpers@7.4.3/",
    "@babel/parser/": "/jspm_packages/npm/@babel/parser@7.4.3/",
    "@babel/template/": "/jspm_packages/npm/@babel/template@7.4.0/",
    "@babel/traverse/": "/jspm_packages/npm/@babel/traverse@7.4.3/",
    "@babel/types/": "/jspm_packages/npm/@babel/types@7.4.0/",
    "convert-source-map/": "/jspm_packages/npm/convert-source-map@1.6.0/",
    "debug/index.dew.js": "/jspm_packages/npm/debug@4.1.1/src/browser.dew.js",
    "semver/": "/jspm_packages/npm/semver@5.7.0/",
    "source-map/": "/jspm_packages/npm/source-map@0.5.7/",
    "jsesc/": "/jspm_packages/npm/jsesc@2.5.2/",
    "trim-right/": "/jspm_packages/npm/trim-right@1.0.1/",
    "@babel/helper-get-function-arity/": "/jspm_packages/npm/@babel/helper-get-function-arity@7.0.0/",
    "chalk/": "/jspm_packages/npm/chalk@2.4.2/",
    "esutils/": "/jspm_packages/npm/esutils@2.0.2/",
    "js-tokens/": "/jspm_packages/npm/js-tokens@4.0.0/",
    "@babel/helper-function-name/": "/jspm_packages/npm/@babel/helper-function-name@7.1.0/",
    "@babel/helper-split-export-declaration/": "/jspm_packages/npm/@babel/helper-split-export-declaration@7.4.0/",
    "globals/": "/jspm_packages/npm/globals@11.11.0/",
    "to-fast-properties/": "/jspm_packages/npm/to-fast-properties@2.0.0/",
    "color-convert/": "/jspm_packages/npm/color-convert@1.9.3/",
    "ansi-styles/": "/jspm_packages/npm/ansi-styles@3.2.1/",
    "escape-string-regexp/": "/jspm_packages/npm/escape-string-regexp@1.0.5/",
    "supports-color/index.dew.js": "/jspm_packages/npm/supports-color@5.5.0/browser.dew.js",
    "color-name/": "/jspm_packages/npm/color-name@1.1.3/",
    "safe-buffer/": "/jspm_packages/npm/safe-buffer@5.1.2/",
    "ms/": "/jspm_packages/npm/ms@2.1.1/"
  }
}
</code></pre>
</details>

To use the import map in the browser, create the following `test.html` HTML page:

```html
<!doctype html>
<script>
(async () => {
  document.head.appendChild(Object.assign(document.createElement('script'), {
    type: 'importmap',
    innerHTML: await (await fetch('./importmap.json')).text()
  }));
  import('./test.js');
})();
</script>
```

Running `jspm run serve` ([set up previously](#http-server-bin-script), or using any alternative local server), load the page to see the expected logs in the browser console.

> It is also possible to copy-paste the import map above directly into a `<script type="importmap">{...}</script>` tag in the HTML page, but the workflow shown here is designed to avoid any unnecessary manual steps during the development process.

_Have a look at the network tab when loading the page. Hundreds of ES modules are being loaded that were converted from Node.js semantics to work natively in the browser with only a import map and no build step._

**Note:** This is a development-only workflow, and optimizations are still needed in production, at least while the majority of installed packages are not themselves optimized for delivery.

## Shimming Import Maps in all Browsers

If not running Chrome, the above workflow won't work. But we can still support import maps in all modern browsers with the shim provided by [es-module-shims](http://npmjs.org/package/es-module-shims).

```
jspm install es-module-shims --dev
```

To find out where es-module-shims is located use `jspm resolve`:

```
jspm resolve es-module-shims --relative
```

This will output the relative path to the main entry point of es-module-shims.

This path is then included in `test.html`:

```html
<!doctype html>
<script defer src="jspm_packages/npm/es-module-shims@0.2.6/dist/es-module-shims.min.js"></script>
<script type="importmap-shim" src="importmap.json"></script>
<script type="module-shim" src="test.js"></script>
```

Where `test.js` and `importmap.json` are exactly as we [created in the previous section](#browser-modules-with-import-maps).

The shim uses a very fast tokenizer to inline the import map resolutions into the module imports, while still using the native ES module loader that is supported in 85% of browsers, providing the unbuilt native modules development workflows in all major browsers.

> There is also no need to use the `--flat-scopes` or `--map-base` flags when running `jspm map` with the es-module-shims shim, which were only needed previously to ensure Chrome compatibility.

## Optimized Browser Builds

jspm provides a very simple low-level build command with `jspm build`. Using this to optimize the example application:

```
jspm build ./test.js --minify --production
```

> * Any number of entry point module arguments can be passed to `jspm build`, which will then have their shared chunks generated between them.
> * The `--production` flag sets the `process.env.NODE_ENV` variable, as well as supporting production resolution maps in packages.
> * Use `--watch` for a watched build while developing.

This will output a file at `dist/test.js` containing the following build files:

```
- test.js
- chunk-55a0e531.js
- chunk-bd22664c.js
```

This is a [Rollup Code Splitting](https://rollupjs.org/guide/en#code-splitting) build output, where three different chunks have been output for this build since the `test.js` example uses a dynamic import to load Babel after the initial page load:

* The `test.js` file represents just the code needed for the first initializion of the page (ie `lodash/clone`).
* The second chunk represents the dynamic import for `@babel/core`, which shares dependencies with the first chunk (Babel also uses Lodash itself).
* The third chunk represents this shared Lodash code that is used between both `test.js` and `@babel/core`, which avoids unnecessary duplicate code loading.

To load the build in `test-build.html`:

```html
<!doctype html>
<script type="module" src="dist/test.js"></script>
```

Which can be served through `jspm run serve` or otherwise.

**This provides an optimal build for distributing to users for production, provided their browsers support ES modules and dynamic import.**

## SystemJS Legacy Browser Support

This workflow is based on two builds - a modern build and a legacy build, where the legacy build uses the SystemJS module format for compatiblity with ES module semantics.

To build into the System module format:

```
jspm build ./test.js -f system --minify --production -d dist-system
```

> The benefit of the System module format is that it ensures live bindings, dynamic import, import.meta, Web Assembly imports, top-level await support, and even import maps in the full build, but if these features aren't needed, alternative approaches like `-f iife` can work just fine.

Install SystemJS, and get its path:

```
jspm install systemjs --dev
jspm resolve systemjs/dist/s.min.js --relative
```

Then in `test-build.html`, selectively load the dual-build version:

```html
<!doctype html>
<script defer>
  // modernBuild = Modules + Dynamic Import support
  import('./dist/test.js');
  window.modernBuild = true;
</script>
<script defer>
  if (!window.modernBuild) {
    document.head.appendChild(Object.assign(document.createElement('script'), {
      src: './jspm_packages/npm/systemjs@3.1.6/dist/s.min.js',
      onload: function () {
        System.import('./dist-system/test.js');
      }
    }));
  }
</script>
```

> For IE11 support, [see the polyfills section of the SystemJS readme](https://github.com/systemjs/systemjs#polyfills-for-older-browsers),
and also note the appropriate Babel plugins for browser support would need to be applied as well. See the [Babel integration section](/docs/integrations#babel) for workflows around this.

**This workflow provides optimized modular support in all browsers back to IE11, with the guarantee of the SystemJS module format being that we ensure support for all modular features.**

## Optimized Dependency Builds

With the build optimizations of the previous two sections, every code change will rebuild all of the build files, in turn requiring the users of the app to reload all the build files again. Ideally, rebuilding application code shouldn't result in a need to rebuild all of the dependency code so that dependency builds can continue to be cached. Here is a technique to achieve that with jspm.

We know what our exact dependency imports are, but in case we didn't, let's run a trace first:

```
jspm trace --deps ./test.js
```

The trace outputs the list of dependency imports (including subpaths):

```
@babel/core
lodash/clone.js
```

This is important, because only one subpath of the lodash package is used, we just want to build this subpath, instead of the main entry point.

Run a jspm build of just these dependencies:

```
jspm build @babel/core lodash/clone.js --hash-entries -o deps-buildmap.json
```

In detail:

1. We're building two entry points with Rollup code-splitting - `@babel/core` and `lodash/clone.js`.
2. `--hash-entries` will output these entry points with hashed file names for caching as `dist/core-[hash].js` for Babel and `dist/clone-[hash].js` for Lodash clone.
3. `-o deps-buildmap.json` specifies that the import map for the **build** should be output. This map represents the mapping that `@babel/core` is now found at `dist/core-[hash].js` and similarly for Lodash clone.

Alternatively, skip the copy-paste of the dependency modules in this workflow with:

```
jspm build $(jspm trace --deps ./test.js) -h -o deps-buildmap.json
```

The build map contains:

```json
{
  "imports": {
    "@babel/core": "./dist/core-bd22664c.js",
    "lodash/clone.js": "./dist/clone-13db28fa.js"
  }
}
```

This build map can now be used directly directly in the browser with the original application code, either copy-pasting the build map directly, or using a similar dynamic import map loading approach as provided in the [import maps section above](#browser-modules-with-import-maps).

```html
<!doctype html>
<script>
(async () => {
  document.head.appendChild(Object.assign(document.createElement('script'), {
    type: 'importmap',
    innerHTML: await (await fetch('./deps-buildmap.json')).text()
  }));
  import('./test.js');
})();
</script>
```

Application modules are directly using the built dependency modules, which can be cached in the browser.

The application modules still need to be optimized though, which can be done with a secondary build:

```
jspm build ./test.js --external deps-buildmap.json
```

`--external` allows us to list the externals and optionally provide their new aliases. In this case, by providing the previous build map as the external map, this results in any import to `@babel/core` or `lodash/clone.js` being re-aliased to `dist/core-[hash].js` and `dist/clone-[hash].js` respectively.

At this point no import maps are needed to run the built application as all plain specifiers have been resolved.

The build application can be executed with:

```html
<!doctype html>
<script type="module" src="./dist/test.js"></script>
```

> To leave the externals as bare specifiers, the list of externals can be passed as arguments via something like `jspm build ./test.js -e @babel/core lodash/clone.js` (`-e` is short for `--external`). The `deps-buildmap.json` would then be required in production, and could be used in a corresponding legacy workflow (eg SystemJS / ES Module Shims). The main benefit of this approach would be that the dependency code cache for users can be updated independent of application code cache (because the dependency references don't have to be updated when the dependency build changes, as that is what the import map handles).

There is absolutely nothing wrong with copy and pasting of import maps as well, and using `jspm map -o ./test.js` will output the map to `stdout` where it an be manually maintained too. Both `jspm build` and `jspm map` support an `-i <custommap.json>` argument to extend the output map with custom manual mappings.

**Dependency optimization is a useful workflow both in development and production, but there are many ways to work with import maps. These, and the other flags of `jspm map` and `jspm build`, aim to provide a low-level and flexible toolkit for working with import maps and the many various scenarios in which they can apply.**

## Optimizing Node.js Libraries for Publishing

When writing a Node.js library that will be published to npm, `jspm build` provides a great standard workflow for optimization before publishing.

Assuming the entry point is at `src/library.js`, the local code can be built, while excluding dependencies, with the build command:

```
jspm build ./src/library.js --node --exclude-deps -d . -f commonjs
```

* `--node` informs jspm that to build for the Node.js resolution environment, using Node.js builtins and not following any `package.json` `"browser"` mappings.
* `--exclude-deps` will exclude the local `package.json` `"dependencies"` from the build so that these dependencies are still shared and version-managed by the library consumers.
* Passing `-d .` will build to the current folder creating a single, built `library.js`. For multiple entry points you may wish to output to the `dist/` folder.
* `-f commonjs` sets the output module format as CommonJS so that the library is supported in Node.js without `--experimental-modules`, which is still important for compatibility.

The `package.json` `"main"` can be set to the built file for publishing via `jspm publish`.

> Note that `devDependencies` are not excluded by `--exclude-deps`, and will instead be inlined. This can be a useful way to distinguish on install between dependencies that should be built, and dependencies that shouldn't. For example, a one-line library like left-pad can be inlined by just installing it as a devDependency (`jspm install leftpad --dev`), while a large dependency like `React` can still be shared.

> Not all third-party npm packages will support the jspm build. Specifically, those that do any type of asset loading like `fs.readFile(__dirname + '/path')` will not be able to retain their references. For comprehensive Node.js build support see [ncc](https://github.com/zeit/ncc/).

It is possible to publish packages as ES modules by setting the `package.json` `"main"` to an ES module, provided you know your consumers (say within the same company) will be using either jspm or Node.js `--experimental-modules`. Since the [package.json contains a `"type": "module"`](http://2ality.com/2019/04/nodejs-esm-impl.html#filename-extensions), the package will be supported when loaded under `--experimental-modules`.

Note that the `"module"` field in the package.json will likely not be supported in Node.js, so isn't a reliable pattern to use here. If you are looking to publish packages as both CommonJS and ES modules, this workflow is currently not recommended. The patterns are still being worked out and there are no clear paths here yet.

## Optimizing Universal Libraries

For libraries that provide both a browser and a Node.js version, it's best to approach these as two separate builds.

So if there were a `src/library-browser.js` as well as `src/library-node.js` for Node, create another build for the browser:

```
jspm build ./src/library-browser.js --exclude-deps -d .
```

Setting the `package.json` `"browser": "./library-browser.js` field then provides an optimized build for both environments.

> jspm will always respect the [`"browser"` field](https://github.com/defunctzombie/package-browser-field-spec) in the `package.json` for any installed packages, and for both ES modules and CommonJS.

## CDN Package Maps

Instead of building a import map against the local jspm_packages packages folder, the jspm CDN can even be used as the import map target. Because the structure of jspm_packages is universal, we can just change the reference.

To do this in the [original import map example](#browser-modules-with-import-maps) add the `--cdn` flag:

```
jspm map ./test.js --flat-scope -o importmap.json --cdn
```

Loading the same `test.html` in the browser from the initial import maps example, check the network tab to see all requests are now made against `https://dev-cdn.jspm.io`.

```html
<!doctype html>
<script>
(async () => {
  document.head.appendChild(Object.assign(document.createElement('script'), {
    type: 'importmap',
    innerHTML: await (await fetch('./importmap.json')).text()
  }));
  import('./test.js');
})();
</script>
```

To use a custom jspm_packages path such as your own CDN library server use `--jspmPackages https://mysite.com` rather.

> These workflows are still highly experimental and not recommended for production.

## Development CDN

For quick experiments, `https://dev.jspm.io` provides a version of jspm_packages and the resolver that will always inline resolutions to their latest versions.

This makes it easy to import any package into any environment, without even needing jspm installed:

```js
<!doctype html>
<script type="module">
import clone from 'https://dev.jspm.io/lodash/clone.js';

console.log(clone({ a: 'b' }));

import('https://dev.jspm.io/@babel/core').then(({ default: babel }) => {
  console.log(babel.transform('test').code);
});
</script>
```

Packages are still cached and optimized where possible to make this a good development experience, although it is certainly not a production workflow.

To easily experiment with the above, [try running the above example in the jspm sandbox](/sandbox#H4sIAAAAAAAAA21Ry27DIBC8+yu2vtjJwdydh3rJF6Q/gGETE2HWAuzGivLvXXAT9dDDSsvMzjAsYlvAFm5hHOAsne7ozucEffUmQFghwDuqKWKA0xkG0pPldjayTYOp9h+aVFxGhD4O9pihoLwZIyT0UK6iMjMATdPEZI/aRPKgSCNDWSVW2WrRkV5+JXttZjD6UCpyURqHvjzuBYMvXkk3y7CO5Dbxa7eaibdbqtMNFYfr8f3GboFghtEuMAXjrpATfns5juhTNlEUTJOPoCw5hIunAao+xjG0Qmicm7TFxpCwpGXoRR5jsNoVBacOZLGxdK0zXj9AtlB1FTw3m93Luv7X77OTHVqhyGO14c2hq1mu8SInG1vILNvA4QiPAuDvXZlropcuXMgPdcWfGNkkrZyvfXL9ANJXMe8CAgAA), which provides a convenience online tool for these experiments.

> For further reading, the full documentation will only be released with the stable jspm 2.0 release. [Tooling integrations](/docs/integrations) are still being fleshed out. Feedback and [contributions](https://github.com/jspm/project/blob/master/CONTRIBUTING.md) to this experimental beta are very much appreciated.
