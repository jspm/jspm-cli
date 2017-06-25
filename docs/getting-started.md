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

Package.json file does not exist, create it? [yes]: 
Would you like jspm to prefix the jspm package.json properties under jspm? [yes]: 
Enter server baseURL (public folder path) [.]: 
Enter jspm packages folder [./jspm_packages]: 
Enter config file path [./config.js]: 
Configuration file config.js doesn't exist, create it? [yes]:
Enter client baseURL (public folder URL) [/]: 
Which ES6 transpiler would you like to use, Traceur or Babel? [traceur]:
```

  Sets up the package.json and configuration file.
  Note `jspm init` happens automatically if you try installing into an empty project too.

* **baseURL**: This should be set to the public folder where your server will serve from, relative to the package.json file. _Defaults to the package.json folder itself._
* **jspm packages folder**: The folder where jspm will install external dependencies.
* **Config file path**: The jspm config file for your application. Should be within the baseURL and checked in to version control.
* **Client baseURL**: The URL from the browser where the public folder is hosted.
* **Transpiler**: Change this option at any time with `jspm dl-loader babel`. Custom transpilation options can also be set through `babelOptions` or `traceurOptions` in the jspm config file.

If you ever need to reset any of these properties, you can modify the package.json, which will update the configuration when you next run `jspm install` or `jspm init` to refresh.

It is possible to run through the above prompts again at any time with `jspm init -p`.

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
  
  The config.js file is updated with the version information and the version is locked down, 
  this configuration file itself forming the lock, which should be added to version control.

### 4. Write application code

We can now write into our `lib` folder code that loads our dependencies, in any module format (including ES6):
  
  lib/bootstrap.js
  ```javascript
    import _ from 'lodash-node/modern/lang/isEqual.js';
    import $ from 'jquery';
    import underscore from 'myname';
  
    export function bootstrap() {
      // bootstrap code here
    }
  ```

  lib/main.js
  ```javascript
    import {bootstrap} from './bootstrap.js';
    bootstrap();
  ```
  
> Note modules are only detected as ES6 when module syntax is present. This is because the module loader transpilation is linked to the ES module format currently, althought this transpilation layer will be separated in future. Read more about SystemJS module formats at https://github.com/systemjs/systemjs/blob/master/docs/module-formats.md.

### 5. Run the code

In an HTML page include the automatically downloaded SystemJS loader along with the config file, then import our application main entry point:

  ```html
  <!doctype html>
  <script src="jspm_packages/system.js"></script>
  <script src="config.js"></script>
  <script>
    System.import('lib/main.js');
  </script>
  ```

Run a local server to view the page.

> jspm makes requests for many files. For best performance, ideally try to use a performant HTTP/2-enabled development server
  and set up `jspm_packages` to be served with far-future expires from the local server so that it is cached in the browser
  and separate requests don't need to be made.

### 6. Bundle for production

```
  jspm bundle lib/main --inject
```

Refresh the browser, and see the entire app loaded from a single bundle file.

Alternatively, use `jspm build lib/main` to create a bundle script that can be used on its own with a `<script>` tag independent of `config.js` and `system.js`.

### Next Steps

[Read more about the production workflows](production-workflows.md)

[Read the guide on configuring packages for jspm here](https://github.com/jspm/registry/wiki/Configuring-Packages-for-jspm).

_If you are having any trouble configuring a package for jspm, please just [post an issue to the registry](https://github.com/jspm/registry/) and we'll help get it configured._
