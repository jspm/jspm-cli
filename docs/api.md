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

Must be run before instantiating other classes.

### Loader API

#### class Loader

Create a new SystemJS loader based on the current jspm environment:

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

jspm supports all Node libraries on the server and uses their Browserify equivalents in the browser.

[Read more about NodeJS usage of jspm](docs/nodejs-usage.md).

[Read more on the SystemJS API](https://github.com/systemjs/systemjs/blob/master/docs/system-api.md)

### Bundle API

#### class Builder

Create a new SystemJS Builder instance for the current jspm environment:

```javascript
var jspm = require('jspm');
jspm.setPackagePath('.'); // optional

var builder = new jspm.Builder();

// or builder.buildSFX
builder.build('app/main.js', 'bundle.js', {
  minify: true,
  
  // inject the bundle config into the configuration file
  inject: true
})
```

The builder will be automatically configured to have the correct jspm configuration and baseURL for the environment.

Additional configuration options can be set via `builder.config({...})`

[Read more on the builder API at the SystemJS builder project page](https://github.com/systemjs/builder)

### unbundle() -> Promise()

Removes any existing `depCache` or `bundle` configuration from the configuration file.

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

