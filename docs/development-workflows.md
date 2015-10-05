### Performance
There are a couple of things that can be done to speed up the development workflow.
For more see: https://github.com/jspm/jspm-cli/issues/872

#### Creating a dependencies bundle
To speed up the module loading and possibly transpilation it's possible to prebuild and bundle all the dependencies (packages in jspm_packages).
This is possible using the `jspm bundle` feature. If you're code lives in a folder called `lib` you can bundle and [inject](https://github.com/jspm/jspm-cli/blob/master/docs/production-workflows.md#loading-a-bundle-automatically-inject) the dependencies with:
```
jspm bundle 'lib/**/* - [lib/**/*] --inject'
```
Modules loaded with specific loaders need to be excluded specifically. Examples:
``` bash
jspm bundle 'src/**/* - [src/**/*] - [src/**/*.css!]' bundle.js --inject
jspm bundle 'src/**/* - [src/**/*] - [src/**/*.css!css-modules]' bundle.js --inject
```
When the loader is specific through [systemjs meta config](https://github.com/systemjs/systemjs/blob/master/docs/config-api.md#meta) this isn't needed. 
