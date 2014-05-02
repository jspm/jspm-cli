jspm CLI
===

Browser package management with modular dependency and version management.
https://jspm.io

* Installs version-managed modular packages along with their dependencies from any jspm endpoint, currently supporting GitHub, npm and the [jspm Registry](https://github.com/jspm/registry).
* Carefully resolves version ranges within semver compatibility clearly verifying any version forks.
* Creates the [SystemJS](https://github.com/systemjs/systemjs) version configuration file for the package.
* Builds ES6 into AMD and ES5 for using ES6 modules in production.

### Getting Started

1. Install jspm CLI:

  ```
    npm install jspm -g
  ```

2. Create a project:

  ```
  cd my-project
  jspm init
    
  No package.json found, would you like to create one? [yes]: 
  Enter package name [app]: 
  Enter application folder [lib]: 
  Enter packages folder [jspm_packages]: 
  Enter config file path [config.js]: 
  Configuration file config.js not found, create it? [y]: 
  ok   Loader files downloaded successfully
  ok   Verified package.json at package.json
       Verified config file at config.js
  ```
  
  The application name is used to require anything from the application code folder `lib`, instead of from the jspm registry.
  
  A require to `app/main` will load `lib/main.js` in this example.

  Sets up the package.json and configuration file, and downloads the jspm SystemJS loader files.
  
3. Download the loader files

  ```
    jspm dl-loader
    
     Downloading loader files to jspm_packages
       system@0.4.js
       es6-module-loader@0.4.1.js
       traceur@0.0.10.js
  ```

4. Install any packages from the jspm Registry, GitHub or npm:

  ```
    jspm install npm:lodash-node
    jspm install github:components/jquery
    jspm install jquery
  ```
  
  Any npm or Github package can be installed in this way.
  
  Most npm packages will install without any configuration necessary. Github packages may need to be configured for jspm first. [Read the guide here on configuring packages for jspm](https://github.com/jspm/registry/wiki/Configuring-Packages-for-jspm).
  
  All installs are saved into the package.json, so that the jspm_packages folder and configuration file can be entirely recreated with a single `jspm install` call with no arguments. This is ideal for version-controlled projects where third party packages aren't saved in the repo itself.
  
  The config.js file is updated with the version information and the version is locked down.

5. In an HTML page include the downloaded SystemJS loader along with the automatically generated configuration file (`config.js`), then load the modules:

  ```html
  <script src="jspm_packages/system@0.4.js"></script>
  <script src="config.js"></script>
  <script>
    System.import('npm:lodash-node/modern/objects/isEqual').then(function(isEqual) {
    });
    
    System.import('github:components/jquery').then(function($) {
    });
  
    System.import('jquery').then(function($) {
    });
  </script>
  ```

* Most npm modules should install without any additional configuration.
* Most Github modules that are not already in the [registry](https://github.com/jspm/registry), will need some package configuration in order to work correctly with `jspm install github:my/module`.

[Read the guide on configuring packages for jspm here](https://github.com/jspm/registry/wiki/Configuring-Packages-for-jspm).

_If you are having any trouble configuring a package for jspm, please just post an issue and we'll help get it configured._

### Installing from the jspm Registry

```
  jspm install jquery
```

Automatically downloads and sets the configuration map for the loader.

This is equivalent to writing:

```
  jspm install jquery=github:components/jquery
```

The [jspm registry](https://github.com/jspm/registry) just provides a mapping from a name into an endpoint package name.

### Switching to CDN package sources

The npm and Github endpoints are both served by CDN, which is automatically configured in jspm.

We can switch the CDN version with a single command:

```
  jspm setmode remote
```

This updates the configuration to now load all the packages from the CDN directly instead of the `jspm_packages` folder. The app will still behave identically, but we retain the version-lock configuration.

Revert back to the local files with:

```
  jspm setmode local
```

### jspm Inject - using the jspm CDN in production

The CDN can be used for production as sources are provided minified with SPDY and optimal cache headers.

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

All packages will be checked, and versions upgraded where necessary.

### Building Application Code

jspm provides some operations for convenience:

* Minification
* Module Transpiling from ES6 to ES5
* SystemJS Plugin builds (under development)

Minification is provided for convenience only, while transpiling is provided as a fundamental use case for ES6 module usage.

Application code is stored in the `lib` directory, which is also stored in the package.json as:

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
    "minify": true,
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

Use `-o` or `--override` to force-set the package override for a package that needs extra configuration. See https://github.com/jspm/registry#testing-package-overrides.

### Rate Limits

To set GitHub authentication to avoid rate limits, enter your GitHub credentials with:

```
  jspm config github.username myusername
  jspm config github.password mypassword
```

### Further Reading

* Type `jspm --help` for command list.
* [Read the SystemJS documentation here](https://github.com/systemjs/systemjs).
* Add new items to the [jspm registry](https://github.com/jspm/registry) repo by providing a pull request.
* Read more on [configuring packages for jspm](https://github.com/jspm/registry/wiki/Configuring-Packages-for-jspm).

### License

Apache 2.0
