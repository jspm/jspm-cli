jspm CLI [![Build Status][travis-image]][travis-url] [![Gitter](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/jspm/jspm?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
===

Registry and format agnostic JavaScript package manager.

* Supports installing any module format from any registry, with GitHub and npm currently provided, via [the endpoint API](https://github.com/jspm/jspm-cli/wiki/Endpoint-API).
* Couples to the [SystemJS module loader](https://github.com/systemjs/systemjs), which is built on the current draft of the [browser ES6 module loader](https://github.com/ModuleLoader/es6-module-loader) specfication.
* Carefully resolves version ranges using greedy fork minimization into flat multi-version package folders.
* Provides tiered bundling of multi-format module trees using [SystemJS builder](https://github.com/systemjs/builder).
* Loads and builds assets through [SystemJS plugins](https://github.com/systemjs/systemjs#plugins).

See [https://jspm.io](https://jspm.io) for a project overview.

For support, [join the Gitter room](https://gitter.im/jspm/jspm) or [Google Group](http://groups.google.com/group/jspm-io).

[See the current release notes here including upgrade information](https://github.com/jspm/jspm-cli/releases).

Use `jspm --help` to see the full up-to-date list of commands.

Note io.js support is currently pending [issue #410](https://github.com/jspm/jspm-cli/issues/410).

### Documentation

* [Getting Started with jspm](https://github.com/jspm/jspm-cli/wiki/Getting-Started)
* [jspm documentation wiki](https://github.com/jspm/jspm-cli/wiki).
* [SystemJS project page](https://github.com/systemjs/systemjs).

### License

Apache 2.0

[travis-url]: https://travis-ci.org/jspm/jspm-cli
[travis-image]: https://travis-ci.org/jspm/jspm-cli.svg?branch=master
