JSPM CLI
===

Browser package management.

Designed to work with the [JSPM Loader](https://github.com/jspm/loader) and [JSPM Registry](https://github.com/jspm/registry).

https://jspm.io

### What it does

* Installs flat version-managed dependencies into version-suffixed folders with a folder structure like:
  ```
    - jspm_packages
      - github
        - jquery
          - jquery@2.0.0
          - jquery@2.0.3
      - npm
        - underscore@1.2.3
  ```
  In contrast to NPM, which uses hierarchical version management, flat version management is a must for browser development,
  as dependencies need to be shared to keep bandwidth down. Careful exact version management allows for this to happen.

* Automatically creates the [JSPM loader](https://github.com/jspm/loader) configuration file as dependencies are installed:
  config.js
  ```javascript
    jspm.config({
      map: {
        jquery: 'github:jquery/jquery@2.0.3',
        underscore: 'npm:underscore@1.2.3'
      }
    });
  ```
* Minifies with source maps, translates ES6 into AMD and compiles ES6 syntax into ES5 with Traceur, all with one build command.
  package.json:
  ```javascript
    {
      "buildConfig": {
        "uglify": true,
        "traceur": true, // optionally provide build settings
        "transpile": true
      }
    }
  ```

  ```
    jspm build
  ```

  Creates the deployment folder `my-app-built` containing the minified and transpiled modules for the working project.

### Installing

```
  npm install jspm jspm-github jspm-npm -g
```

### Creating a Project

```
  cd my-project
  jspm init
  
  Enter config file location (config.js): 
  Enter external library install location (jspm_packages): 
  Enter local application code location / baseURL (lib): 
  Config file updated.
  No package.json found, would you like to create one? (y/n): y
  package.json updated.
```

Sets up the package.json and configuration file.

### Installing a repo

```
  jspm install npm:underscore
```

All installs are saved into the package.json, so that the jspm_packages folder and configuration file 
can be entirely recreated with a single `jspm install` call with no arguments. This is ideal 
for version-controlled projects where third party libraries aren't saved in the repo itself.

### Installing from the registry

```
  jspm install jquery
```

Automatically downloads and sets the configuration map for the loader.

The registry is located here - http://github.com/jspm/registry.

### Installing into a custom name

```
  jspm install myjquery=jquery@1.8
```

### Downloading the JSPM Loader

```
  jspm dl-loader
  
  Downloading loader files to jspm_packages.
    loader.js
    es6-module-loader.js
    esprima-es6.min.js
  Loader files downloaded successfully.
```
### Create application code

Edit lib/main.js (ES6 modules as an example, AMD, globals and CJS also supported):

```javascript
  import $ from 'jquery';
  export function test() {
    $(document.body).html('hello world');
  }
```

### Create a sample page

test.html
```html
  <!doctype html>
  <html>
    <head>
      <meta charset='utf-8'>
      <title>JSPM</title>
      <meta name='viewport' content='width=device-width, initial-scale=1'>
  
      <script src='jspm_packages/loader.js'></script>
      <script src='config.js'></script>
      
      <script>
        jspm.import('./main', function(main) {
          main.test();
        });
      </script>
    </head>
    <body>
      
    </body>
  </html>
```

This sample template can also be create simply by running:

```
  jspm create basic-page test.html
```

Open `test.html` to see the application run. This sample can also be found here - https://github.com/jspm/jspm-demo.

### Run a build

In package.json
```
  {
    "buildConfig": {
      "transpile": true,
      "uglify": true
    }
  }
```

```
  jspm build
  
No package.json directories.build. Please enter the build path (dist): 
  Loader baseURL set to dist.
  Config file updated.
  package.json updated.
  Build completed.
```

Open `test.html` to load the built application, with ES6 transpiled into ES5, uglification and source maps support.

When publishing the project to Github, the built version is used from the `dist` folder when downloded as read from the package.json.

### Using the JSPM CDN instead of jspm_packages

```
  jspm setmode remote
```

Instead of loading `jquery` from `jspm_packages`, it is now downloaded directly from the CDN.

The app will still behave identically.

This can be useful for sharing projects without needing to install external packages.

Revert back to the local files with:

```
  jspm setmode local
```

### Command Options

Use `-f` or `--force` with the install command to overwrite and redownload all dependencies.

Use `-h` or `--https` to download with https instead of alternative protocols.

### Further Reading

* [Read more on the package.json specs at the registry wiki](https://github.com/jspm/registry/wiki/Package.json-Specification).
* Type `jspm --help` for command list.
* [Read the JSPM Loader documentation here](https://github.com/jspm/loader).
* Add new items to the [JSPM registry](https://github.com/jspm/registry) repo by providing a pull request.

