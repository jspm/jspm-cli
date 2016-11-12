There are three main workflows for production:

1. [Compile into a bundle](#creating-a-bundle)
2. [Create a static build](#create-a-static-build)
3. [Cache the dependency tree for flat multiplexing via SPDY / HTTP2](#creating-a-dependency-cache)

### Creating a Bundle

```
  jspm bundle app build.js
```

Creates a file `build.js` containing `app` and all its dependencies referenced in jspm.config.js.

We can then load this with a script tag in the page:

```html
<!doctype html>
  <script src="jspm_packages/system.js"></script>
  <script src="jspm.config.js"></script>
  <script src="build.js"></script>
  <script>
    System.import('app');
  </script>
```

Note that bundles also support compiling ES6 code.

#### Creating a bundle with arithmetic

```
  jspm bundle app - react + moment build.js
```

Creates a file `build.js` containing `app` and `moment` and all their dependencies, excluding `react` and all its dependencies.

#### Loading a bundle automatically (inject)

If you don't want to include the bundle with a script tag, but rather load it only when it is needed, we can do:

```
  jspm bundle app main-bundle.js --inject
```

The above will create the bundle, then inject configuration into jspm.config.js to tell the SystemJS loader what modules should be loaded from the `main-bundle.js` file.

bundles section in modified jspm.config.js
```javascript
...
  browserConfig: {
    "bundles": {
      "main-bundle": [
        "app/my-class.js",
        "app.js"
      ]
    }
  }
...
```
As soon as one of these modules is requested, the request is intercepted and the bundle is loaded dynamically first, before continuing with the module load.

You can also use arithmetic bundle:

```
  jspm bundle app - app/core.js main-bundle.js --inject
```

This command will make a `main-bundle.js` file from `app` excluding `app/core.js`.

If wanting to move back to separate file mode, you can remove the bundle configuration manually from the `jspm.config.js` file, or use:

```
  jspm unbundle
```

Which will automatically clear out any injected bundle configuration.

#### Creating a bundle with conditional substitution

SystemJS offers the syntax for conditional loading of modules: `#{...}`. This feature can be used in import statements in order to customize build results. For example,

```js
import text from './#{lang}/text.js';
```

The `lang` value will be imported from the default export of the `lang` module: `import lang from 'lang'`. You can configure SystemJS to resolve the lang module properly:

```js
SystemJS.config({
  ...

  map: {
    ...
    "lang": "app/lang.js",
    ...
  },

  ...
});
```

When building it is possible to override specific conditions using the `--conditions` parameter:

```
jspm bundle test.js bundle-en.js --conditions "{'src/lang.js':'en'}"
```
See a complete example in the guide: [Conditional Substitution](http://jspm.io/0.17-beta-guide/conditional-substitution.html).

#### Creating a bundle for specific environments

SystemJS supports conditional expressions:

```js
SystemJS.config({
  ...

  packages: {
    "app": {
      ...

      "map": {
        "./text.js": {
          "~production": "./text-dev.js"
        }
      }
    },

    ...
  }
});
```

Here the configuration file tells SystemJS to load `text-dev.js` instead of `text.js` if environment is not production. The following environments are supported by JSPM:

* `production` or `dev`
* `node` or `browser`

These parameters can used when building:

```sh
jspm bundle app --node --production # node + production branch
jspm bundle app --browser --dev # browser + production branch
```

See a complete example in the guilde: [Conditional Loading](http://jspm.io/0.17-beta-guide/conditional-loading.html)

### Create a static build (with Rollup Optimization)

To create an output distributable script file that can be included entirely on its own independent of SystemJS and jspm, we can use `build`.

```
  jspm build app app-build.js
```

`app-build.js` contains a micro-loader implementation (1.4KB gzipped), converts all module formats into ES5 (including compiling ES6), and
maintaining bindings and circular references as with normal bundles.

`jspm build` will try to fully optimize the inter-module dependencies.

Whenever there are sub-trees of ES modules within the build tree, SystemJS Builder will inline any of these trees together using [Rollup](http://rollupjs.org/). This allows unused exports to be removed via code tree analysis. If the whole module tree consists only of ES modules, then the entire tree can be inlined with Rollup, giving the best possible code optimization.

### Creating a Dependency Cache

The jspm CDN uses SPDY, optimal cache headers, and minified files, making this workflow suitable for production use.

The remaining performance issue is the round trip latency required to load deep dependencies, as we only find out
the dependencies of a module once we have fetched that module, before fetching its dependencies in turn.

We can get around this by injecting the full dependency tree upfront into a dependency cache, so that all dependencies
can be fetched in parallel.

```
  jspm depcache app
```

The above will trace the full tree for `app` and inject it into the `jspm.config.js` **depCache**.

Now any imports will load the full tree in parallel, reducing the latency delay to one round trip.
