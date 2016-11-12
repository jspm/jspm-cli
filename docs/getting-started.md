### 1. Install jspm CLI:

  ```
    npm install jspm -g
  ```

### 2. Create a project:

Optionally lock down jspm for the project:

  ```
    cd my-project
    npm install jspm --save-dev
  ```

> It is advisable to locally install to lock the version of jspm.
This will ensure upgrades to the global jspm will not alter the behavior of your application.
Use `jspm -v` to confirm the local version.

Create a new project configuration:

  ```
  jspm init

Package.json file does not exist, create it? [Yes]: Yes
Init mode (Quick, Standard, Custom) [Quick]: Quick
Local package name (recommended, optional): app
package.json directories.baseURL: .
package.json configFiles folder [./]: ./
Use package.json configFiles.jspm:dev? [No]: No
SystemJS.config browser baseURL (optional): /
SystemJS.config Node local project path [src/]: src/
SystemJS.config local package main [app.js]: app.js
SystemJS.config transpiler (Babel, Traceur, TypeScript, None) [babel]: babel

```

  Sets up the package.json and configuration file.
  Note `jspm init` happens automatically if you try installing into an empty project too.

* **Init mode**: TODO
* **Local package name**: The module name for your app.
* **package.json directories.baseUR**: The folder where jspm will install external dependencies.
* **package.json configFiles folder**: TODO The jspm config file for your application. Should be within the baseURL and checked in to version control.
* **Use package.json configFiles.jspm:dev**: TODO
* **SystemJS.config browser baseURL (optional)**: The URL from the browser where the public folder is hosted.
* **SystemJS.config Node local project path**: TODO
* **SystemJS.config local package main**: TODO
* **SystemJS.config transpiler**: Change this option at any time with `jspm dl-loader babel`. Custom transpilation options can also be set through `babelOptions` or `traceurOptions` in the jspm config file.

If you ever need to reset any of these properties, you can modify the package.json, which will update the configuration when you next run `jspm install` or `jspm init` to refresh.

### 3. Install any packages from the jspm Registry, GitHub or npm:

  ```
    jspm install npm:lodash-node
    jspm install github:components/jquery
    jspm install jquery
    jspm install myname=npm:underscore
  ```

  Multiple installs can also be combined into a single line separated by spaces.

  Any npm or Github package can be installed in this way.

  Most npm packages will install without any configuration necessary.
  This is because the npm registry endpoint applies conversion operations based on the assumption of
  Node require resolution making the Node and npm-style code compatible with jspm.

Github packages may need to be configured for jspm first.
[Read the guide here on configuring packages for jspm](https://github.com/jspm/registry/wiki/Configuring-Packages-for-jspm).

  All installs are saved into the package.json, so that the jspm_packages folder and
  configuration file can be entirely recreated with a single `jspm install` call with no arguments.
  This is ideal for version-controlled projects where third party packages aren't saved in the repo itself.

  The `jspm.config.js` file is updated with the version information and the version is locked down,
  this configuration file itself forming the lock, which should be added to version control.

  In other words: `jspm install` command installs the latest versions of packages listed in the package.json respecting semver ranges package.json contains. Once installed, exact versions numbers(not ranges) are stored in the `jspm.config.js`. The subsequent jspm installs will install concrete versions stored in the `jspm.config.js`. To update packages to the latest version (but still within semver ranges defined in the package.json) one has to run `jspm update`.

### 4. Write application code

We can now write into our `src` folder code that loads our dependencies, in any module format (including ES6):

  src/bootstrap.js
  ```javascript
    import _ from 'lodash-node/modern/lang/isEqual.js';
    import $ from 'jquery';
    import underscore from 'myname';

    export function bootstrap() {
      // bootstrap code here
    }
  ```

  src/app.js
  ```javascript
    import {bootstrap} from './bootstrap.js';
    bootstrap();
  ```

> Note modules are only detected as ES6 when module syntax is present. This is because the module loader transpilation is linked to the ES module format currently, although this transpilation layer will be separated in future. Read more about SystemJS module formats at https://github.com/systemjs/systemjs/blob/master/docs/module-formats.md.

### 5. Run the code

In an HTML page include the automatically downloaded SystemJS loader along with the config file, then import our application main entry point:

  ```html
  <!doctype html>
  <script src="jspm_packages/system.js"></script>
  <script src="jspm.config.js"></script>
  <script>
    System.import('app');
  </script>
  ```

Run a local server to view the page.

> jspm makes requests for many files. For best performance, ideally try to use a performant HTTP/2-enabled development server
  and set up `jspm_packages` to be served with far-future expires from the local server so that it is cached in the browser
  and separate requests don't need to be made.

### 6. Bundle for production

```
  jspm bundle src/app.js app-bundle.js --minify --inject
```

Refresh the browser, and see the entire app loaded from a single bundle file.

Alternatively, use `jspm build src/app.js` to create a static build script that can be used on its own with a `<script>` tag independent of `config.js` and `system.js`. For example, `jspm build src/app.js app-build.js` and test with the following HTML page:

  ```html
  <!doctype html>
  <script src="app-build.js"></script>
  <script>
    System.import('app');
  </script>
  ```

### Next Steps

[Read more about the production workflows](production-workflows.md)

[Read the guide on configuring packages for jspm here](https://github.com/jspm/registry/wiki/Configuring-Packages-for-jspm).

_If you are having any trouble configuring a package for jspm, please just [post an issue to the registry](https://github.com/jspm/registry/) and we'll help get it configured._
