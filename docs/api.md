jspm can be installed and used as an API dependency in a Node project:

```
  npm install jspm
```

```javascript
  var jspm = require('jspm');
  jspm.install('jquery'); // etc
```

The API is currently unstable and subject to change. The API is also lacking most jspm functions. New API suggestions or adjustments are always welcome, and PRs would be taken gladly.

### jspm API version 0.1

#### setPackagePath(packagePath)

Sets the directory where the jspm `package.json` file for the package being acted on is to be found.

#### configureLoader(config) -> Promise()

Call this function to set custom configuration above and beyond that already in the `config.js` file for the project.

#### dlLoader -> Promise()

Downloads the loader files if needed.

#### normalize(name, parentName) -> Promise(normalized)

Perform normalization of a module name within the jspm project.

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

#### import(name, parentName) -> Promise(module)

Loads a module in the jspm project on the server and returns the defined module:

```javascript
var jspm = require('jspm');
jspm.setPackagePath('.');

jspm.import('fs').then(function(fs) {
  console.log(fs.readFileSync('./package.json'));
});
```

jspm supports all Node libraries on the server and uses their Browserify equivalents in the browser.

[Read more about NodeJS usage of jspm](docs/nodejs-usage.md).

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


