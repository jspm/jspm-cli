There are three main workflows for production:

1. [Compile into a bundle](#creating-a-bundle)
2. [Create a self-executing bundle](#creating-a-self-executing-bundle)
3. [Cache the dependency tree for flat multiplexing via HTTP/2](#creating-a-dependency-cache)

### Creating a Bundle

***Important**: The module names such as `app/main` used in the examples below should only be `/` separated (On Windows, do NOT use `\` as your path separator for this argument). The module names are specified in URL space; in particular, they are not file-paths.*

```
  jspm bundle app/main build.js
```
Creates a file `build.js` containing `app/main` and all its dependencies referenced in config.js. \

We can then load this with a script tag in the page:

```html
<!doctype html>
  <script src="jspm_packages/system.js"></script>
  <script src="config.js"></script>
  <script src="build.js"></script>
  <script>
    System.import('app/main.js');
  </script>
```

Note that bundles also support compiling ES6 code.

#### Creating a bundle with arithmetic

```
  jspm bundle app/main - react + moment build.js
```

Creates a file `build.js` containing `app/main` and `moment` and all their dependencies, excluding `react` and all its dependencies.

#### Loading a bundle automatically (inject)

If you don't want to include the bundle with a script tag, but rather load it only when it is needed, we can do:

```
  jspm bundle app/main main-bundle.js --inject
```

The above will create the bundle, then inject configuration into config.js to tell the SystemJS loader what modules should be loaded from the `main-bundle.js` file.

bundles section in modified config.js
```javascript
...
  "bundles": {
    "main-bundle": [
      "app/my-class.js",
      "app/main.js"
    ]
  }
...
```
As soon as one of these modules is requested, the request is intercepted and the bundle is loaded dynamically first, before continuing with the module load.

You can also use arithmetic bundle:

```
  jspm bundle app/main.js - app/core.js main-bundle.js --inject
```

This command will make a `main-bundle.js` file from `app/main.js` excluding `app/core.js`.

If wanting to move back to separate file mode, you can remove the bundle configuration manually from the `config.js` file, or use:

```
  jspm unbundle
```

Which will automatically clear out any injected bundle configuration.

### Creating a self-executing bundle

To create an output distributable script file that can be included entirely on its own independent of SystemJS and jspm, we can use `bundle-sfx`.

```
  jspm bundle-sfx app/main.js app.js
```

`app.js` contains a micro-loader implementation (1.4KB gzipped), converts all module formats into ES5 (including compiling ES6), and
maintaining bindings and circular references as with normal bundles.

### Creating a Dependency Cache

The jspm CDN uses HTTP/2, optimal cache headers, and minified files, making this workflow suitable for production use.

The remaining performance issue is the round trip latency required to load deep dependencies, as we only find out
the dependencies of a module once we have fetched that module, before fetching its dependencies in turn.

We can get around this by injecting the full dependency tree upfront into a dependency cache, so that all dependencies
can be fetched in parallel.

```
  jspm depcache app/main.js
```

The above will trace the full tree for `app/main` and inject it into the `config.js` **depCache**.

Now any imports will load the full tree in parallel, reducing the latency delay to one round trip.
