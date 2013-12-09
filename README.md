jspm CLI
===

Browser package management with modular dependency and version management.
https://jspm.io

* Installs version-managed modular packages along with their dependencies from any jspm endpoint, currently supporting GitHub, npm and the [jspm Registry](https://github.com/jspm/registry).
* Injects the [jspm Loader](https://github.com/jspm/jspm-loader) configuration for the package including the map, shim, main entry point and module format.
* Builds ES6 into AMD and ES5 for working with ES6 modules.

### Basic Use

Install any package from GitHub or npm:

```
jspm install npm:lodash-node
jspm install github:components/jquery
jspm install jquery
```

In an HTML page, include the [jspm Loader](https://github.com/jspm/jspm-loader) (`loader.js`), along with the automatically generated configuration file (`config.js`), then load the modules:

```html
<script src="loader.js"></script>
<script src="config.js"></script>
<script>
  jspm.import('npm:lodash-node/modern/objects/isEqual', function(isEqual) {
  });
  
  jspm.import('github:components/jquery', function($) {
  });

  jspm.import('jquery', function($) {
  });
</script>
```

* Most npm modules should install without any additional configuration.
* Most Github modules that are not already in the [registry](https://github.com/jspm/registry), will need some package configuration in order to work correctly with `jspm install github:my/module`.

[Read the guide on configuring packages for jspm here](https://github.com/jspm/registry/wiki/Configuring-Packages-for-jspm).

_If you are having any trouble configuring a package for jspm, please just post an issue and we'll help get it configured._

### Getting Started

```
  npm install jspm jspm-github jspm-npm -g
```

This installs the jspm CLI along with the Github and npm endpoint modules.

### Creating a Project

```
cd my-project
jspm init
  
    Enter config file location (config.js): 
    Enter external package install location (jspm_packages): 
    Enter local application code location / baseURL (lib): 
    Config file updated.
    No package.json found, would you like to create one? (y/n): y
    package.json updated.
    Downloading loader files to jspm_packages.
       es6-module-loader.js
       loader.js
       traceur.js
ok  Loader files downloaded successfully.
```

Sets up the package.json and configuration file, and downloads the jspm loader files.

* The jspm loader configuration file to use (it can even be an HTML file that has a `jspm.config` call in it)
* The install location for packages (defaults to `jspm_packages`)
* The baseURL directory where the main application code will be (defaults to `lib`)

Note that unlike RequireJS, the baseURL is different from the external package location.

### Installing a Package

```
  jspm install npm:underscore
```

Any npm or Github package can be installed in this way.

Most npm packages will install without any configuration necessary. Github packages may need to be configured for jspm first. [Read the guide here on configuring packages for jspm](https://github.com/jspm/registry/wiki/Configuring-Packages-for-jspm).

All installs are saved into the package.json, so that the jspm_packages folder and configuration file can be entirely recreated with a single `jspm install` call with no arguments. This is ideal for version-controlled projects where third party packages aren't saved in the repo itself.

If you check `config.js`, you will see its contents have been updated to:

config.js:
```javascript
jspm.config({
  baseURL: 'lib',
  jspmPackages: 'jspm_packages',
  map: {
    'npm:underscore': 'npm:underscore@1.5.2'
  }
});
```

### Create a Sample Page

test.html:
```html
  <!doctype html>
  <html>
    <head>
      <script src='jspm_packages/loader.js'></script>
      <script src='config.js'></script>
      
      <script>
        jspm.import('npm:underscore', function(_) {
          _.map([1, 2, 3], function(num) { return num + 1; });
        });
      </script>
    </head>
    <body>
    </body>
  </html>
```

Open `test.html` to see the application run. This sample can also be found here - https://github.com/jspm/jspm-demo.

### Installing into a Custom Name

```
  jspm install myjquery=jquery@1.8
```

This will write the jspm loader map configuration for `myjquery` instead of `jquery@1.8`.

Allowing requires of the form:

```javascript
  jspm.import('myjquery')
```

### Installing from the Registry

```
  jspm install jquery
```

Automatically downloads and sets the configuration map for the loader.

This is equivalent to writing:

```
  jspm install jquery=github:components/jquery
```

The [jspm registry](https://github.com/jspm/registry) just provides a mapping from a name into an endpoint package name. It is purely a name shortening service and nothing more.

### Using the jspm CDN instead of jspm_packages

The npm and Github endpoints are both served by CDN, which is automatically configured in jspm.

We can switch the CDN version with a single command:

```
  jspm setmode remote
```

This updates the configuration to now load all the packages from the CDN directly instead of the `jspm_packages` folder. The app will still behave identically.

Revert back to the local files with:

```
  jspm setmode local
```

### jspm Inject - using the jspm CDN in production

The CDN can be used for production as sources are provided minified with optimal cache headers.

When moving to production with an app using CDN sources, the jspm CLI can inject package configuration and lock down versions minimising the production requests.

To inject the configuration locking down an exact version of a module, use `jspm inject`.

A specific package can have its configuration injected and version locked down with:

```
  jspm inject jquery 
```

All the packages in the package.json can be injected (like the install command) with:

```
  jspm inject
```

This provides an alternative workflow to installation when using the CDN.

### Update Installed Packages

```
  jspm update
```

All packages will be checked, and versions bumped for latest and minor version package installs.

### Building Application Code

jspm is not a build tool, and never will be a build tool. Use grunt and other tools for automating project tasks.

The only operations jspm provides as a helper are:

* Minification
* Module Transpiling from ES6 to ES5

Minification is provided for convenience only, while transpiling is provided as a fundamental use case for modules of the future.

Application code is stored in the `baseURL` directory (`lib` in the original example), which is also stored in the package.json as:

package.json:
```javascript
{
  "directories": {
    "lib": "lib"
  }
}
```

When building, this is the directory that we build.

To set build options, add a `directories.dist` and a `buildConfig` object to the package.json:

package.json:
```javascript
{
  "directories": {
    "lib": "lib",
    "dist": "lib-built"
  },
  "buildConfig": {
    "uglify": true, // or set to options object
    "traceur": true, // or set to options object
    "transpile": true
  }
}
```

To run the build, use the command:

```
  jspm build
```

To run the application from the built sources, use the command:

```
  jspm setmode production
```

The `baseURL` in the configuration file will be updated to the build directory, and the app will load its resources from there.

To try out a demonstration of this, [clone the ES6 demo repo here](https://github.com/jspm/demo-es6).

### Command Options

Use `-f` or `--force` with the install command to overwrite and redownload all dependencies.

Use `-h` or `--https` to download with https instead of alternative protocols.

Use `-o` or `--override` to force-set the package override for a package that needs extra configuration. See https://github.com/jspm/registry/wiki/Configuring-Packages-for-jspm#testing-package-overrides.

### Rate Limits

To set GitHub authentication to avoid rate limits, enter your GitHub credentials with:

```
  jspm config github.username myusername
  jspm config github.password mypassword
```

### Further Reading

* Type `jspm --help` for command list.
* [Read the jspm Loader documentation here](https://github.com/jspm/jspm-loader).
* Add new items to the [jspm registry](https://github.com/jspm/registry) repo by providing a pull request.
* Read more on [configuring packages for jspm](https://github.com/jspm/registry/wiki/Configuring-Packages-for-jspm).

### License

Apache 2.0
