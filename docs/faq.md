## [I have installed a package but when I import it it cannot be found (404). How do I fix this?](http://stackoverflow.com/questions/32293847/jspm-install-npmfb-cannot-find-crypto/32433863#32433863)

If you see an error `"Not Found" 404 /jspm_packages/github/<username>/<module_name>@<version>.js`. It's likely that the module that you install is missing the `main` property in its `package.json`. To check if it's really this problem, examine the output of `jspm install` command. If you see a warning like this one `warn Main entry point not found ...` it's exactly this problem.

In order to fix the problem, you should specify the correct main file with an override and install the module again:

```sh
jspm install github:module/module -o '{"main": "right/main.js"}'
```

Consider submitting the working override to the [JSPM registry](https://github.com/jspm/registry) or raising the issue for the failing module. 

## [I have updated versions in my package.json but `jspm install` installs the old version?](http://stackoverflow.com/questions/32049650/how-to-update-the-jspm-modules-to-the-latest-version)

`jspm install` installs the latest versions of packages listed in the package.json respecting semver ranges defined in it. Once installed, exact versions numbers(not ranges) are stored in jspm's config.js. The subsequent jspm installs will install concrete versions stored in the config.js. To update packages to the latest version (but still within semver ranges defined in the package.json) one has to run `jspm update`.

## [How do I replace my development lib versions with production ones?](http://stackoverflow.com/questions/32920503/jspm-preprocessing-injecting-settings-for-the-targetted-environment-when-bundl)

Use JSPM Builder API:

```js
var builder = new jspm.Builder();

function production(builder) {
  var systemNormalize = builder.loader.normalize;
  builder.loader.normalize = function(name, parentName, parentAddress) {
    // replace certain names with production versions
    if (name === 'ember') name = 'ember/ember.prod';
    if (name === './app-config.dev') name = './app-config.prod';

    return systemNormalize.call(this, name, parentName, parentAddress);
  };
}

production(builder);

builder
  .loadConfig('./config.js')
  .then(function() {
    return builder
      .buildStatic('main', 'app.min.js', {
        sourceMaps: false,
        minify: true,
        mangle: true
      });
  });
```
