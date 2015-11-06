jspm can be installed and used as an API dependency in a Node project:

```
  npm install jspm
```

```javascript
  var jspm = require('jspm');
  jspm.install('jquery'); // etc
```

The API is currently unstable and subject to change. The API is also lacking most jspm functions. New API suggestions or adjustments are always welcome, and PRs would be taken gladly.

## jspm API version 0.2

#### setPackagePath(packagePath)

Sets the directory where the jspm `package.json` file for the package being acted on is to be found.

Must be run before any other API calls.

### Loader API

#### import

Loads a module in the jspm project in Node:

```javascript
var jspm = require('jspm');
jspm.setPackagePath('.');

jspm.import('fs').then(function(fs) {
  console.log(fs.readFileSync('./package.json'));
});
```

jspm supports all Node libraries on the server and uses their Browserify equivalents in the browser.

[Read more about NodeJS usage of jspm](nodejs-usage.md).

#### normalize(name, parentName) -> Promise(normalized)

Normalize a module name within the current jspm project.

#### class Loader

For more loader flexibility within the API, a new custom SystemJS loader instance can be created
based on the current jspm environment:

```javascript
var jspm = require('jspm');
jspm.setPackagePath('.'); // optional

var mySystem = new jspm.Loader();

// can be used as any other System instance
mySystem.normalize('moduleName').then(function(normalized) {
  
});
mySystem.import('moduleName').then(function(module) {
  
});
```

[Read more on the SystemJS API](https://github.com/systemjs/systemjs/blob/master/docs/system-api.md)

### Bundle API

#### bundle(expression, fileName, options) -> Promise()

```javascript
// jspm bundle app/main build.js --no-mangle
var jspm = require('jspm');
jspm.setPackagePath('.');
jspm.bundle('app/main', 'build.js', { mangle: false }).then(function() {
});
```

Set the `inject` option to inject the bundle tree into the configuration file.

### unbundle() -> Promise()

Removes any existing `depCache` or `bundle` configuration from the configuration file.

#### bundleSFX(moduleName, fileName, options) -> Promise()

Creates a single self-executing bundle for a module.

##### Bundle Options

Both `bundle` and `bundleSFX` support the following options:

* `minify`: Use minification, defaults to true.
* `mangle`: Use mangling with minification, defaults to true.
* `lowResSourceMaps`: Use faster low-resolution source maps, defaults to true.
* `sourceMaps`: Use source maps, defaults to true.

#### class Builder

When more build flexibility is needed, create a custom SystemJS Builder instance for the current jspm environment via:

```javascript
var jspm = require('jspm');
jspm.setPackagePath('.'); // optional

var builder = new jspm.Builder();

builder.config({ custom: 'options' });

// or builder.buildStatic
builder.bundle('app/main.js', {
  minify: true
})
.then(function(output) {
  // output is now an in-memory build
  // output.source

  // get the depCache configuration for the tree
  var depCache = builder.getDepCache(output.tree);
});
```

The builder will be automatically configured to have the correct jspm configuration and baseURL for the environment.

[Read more on the builder API at the SystemJS builder project page](https://github.com/systemjs/builder)

### Package Manager API

#### dlLoader -> Promise()

Downloads the loader files if needed.

#### install(name [,target] [, options]) -> Promise()
#### install(targets [, options]) -> Promise()
#### install(true [, options]) -> Promise()

Installs the given package or packages.

```javascript
// jspm install jquery
jspm.install('jquery')

// jspm install jquery=github:components/jquery@^2.0.0
jspm.install('jquery', 'github:components/jquery@^2.0.0')

// jspm install jquery=2
// jspm install jquery@2
jspm.install('jquery', '2')

// jspm install jquery --force
jspm.install('jquery', { force: true })

// jspm install jquery@1.2.3 bootstrap --link
jspm.install({ jquery: '1.2.3', 'bootstrap': true }, { link: true })

// jspm install
// reproducible install from package.json
jspm.install(true, { lock: true })
```

#### uninstall(name) -> Promise()
#### uninstall(names) -> Promise()

Can take a single module or array of modules to uninstall.

