jspm CLI [![Build Status][travis-image]][travis-url] [![Gitter](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/jspm/jspm?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
===

Registry and format agnostic JavaScript package manager.

* Supports installing any module format from any registry, with GitHub and npm currently provided, via [the endpoint API](https://github.com/jspm/jspm-cli/wiki/Endpoint-API).
* Couples to the [SystemJS module loader](https://github.com/systemjs/systemjs), which is built on the current draft of the [browser ES6 module loader](https://github.com/ModuleLoader/es6-module-loader) specfication.
* Carefully resolves version ranges using greedy fork minimization into flat multi-version package folders.
* Provides tiered bundling of multi-format module trees using [SystemJS builder](https://github.com/systemjs/builder).
* Loads and builds assets through [SystemJS plugins](https://github.com/systemjs/systemjs#plugins).

See https://jspm.io for a full introduction and documentation.

For support, [join the Gitter room](https://gitter.im/jspm/jspm) or [Google Group](http://groups.google.com/group/jspm-io).

[See the current release notes here including upgrade information](https://github.com/jspm/jspm-cli/releases).

Use `jspm --help` to see the full up-to-date list of commands.

### Example

```
  jspm install npm:voxel-demo -y
  jspm bundle voxel-demo -i
```

The above populates a `jspm_packages` folder in the current directory, and generates a `config.js` file containing the SystemJS loader configuration.

It then creates a bundle file for the full tree, and ensures it is loaded on demand.

We can then run this demo with:

```html
<!doctype html>
  <script src="jspm_packages/system.js"></script>
  <script src="config.js"></script>
  <script>
    System.import('voxel-demo');
  </script>
```

### License

Apache 2.0

[travis-url]: https://travis-ci.org/jspm/jspm-cli
[travis-image]: https://travis-ci.org/jspm/jspm-cli.svg?branch=master
