jspm CLI
===

[![NPM version][npm-image]][npm-url]
[![Downloads][downloads-image]][npm-url]
[![Travis build Status][travis-image]][travis-url]
[![AppVeyor build Status][appveyor-image]][appveyor-url]
[![Gitter][gitter-image]][gitter-url]
[![Support][supporterhq-image]][supporterhq-url]
[![Codecov][codecov-image]][codecov-url]

Registry and format agnostic JavaScript package manager.

* Supports installing any module format from any registry, with GitHub and npm currently provided, via [the registry API](docs/registry-api.md).
* Couples to the [SystemJS module loader](https://github.com/systemjs/systemjs), which is built on the current draft of the [browser ES6 module loader](https://github.com/ModuleLoader/es6-module-loader) specification.
* Carefully resolves version ranges using greedy fork minimization into flat multi-version package folders.
* Provides tiered bundling of multi-format module trees using [SystemJS builder](https://github.com/systemjs/builder).
* Loads and builds assets through [SystemJS plugins](https://github.com/systemjs/systemjs#plugins).

See [https://jspm.io](https://jspm.io) for a project overview.

For support, [join the Gitter room](https://gitter.im/jspm/jspm) or [Google Group](http://groups.google.com/group/jspm-io).

Use `jspm --help` to see the full up-to-date list of commands.

If you are interested in contributing to the project, [please read the contributors' guide](https://github.com/jspm/jspm-cli/wiki/Contributors%27-Guide).

For a list of community projects and tools, see the [Third-Party Resources Wiki](https://github.com/jspm/jspm-cli/wiki/Third-Party-Resources).

### Documentation

See the [SystemJS](https://github.com/systemjs/systemjs) project page for SystemJS usage documentation.

* [Getting Started with jspm](docs/getting-started.md)
* [Installing Packages](docs/installing-packages.md)
* [Plugins](docs/plugins.md)
* [Production Workflows](docs/production-workflows.md)
* [Publishing Packages](docs/publishing-packages.md)
* [Registries](docs/registries.md)
* [Linking](docs/linking.md)
* [NodeJS Usage](docs/nodejs-usage.md)
* [The Registry Property](docs/registry-property.md)
* [jspm API](docs/api.md)
* [Registry API](docs/registry-api.md)

### License

Apache 2.0

[appveyor-url]: https://ci.appveyor.com/project/guybedford/jspm-cli
[appveyor-image]: https://ci.appveyor.com/api/projects/status/gf1tr1gh4520hpcj?svg=true
[downloads-image]: http://img.shields.io/npm/dm/jspm.svg
[gitter-image]: https://badges.gitter.im/Join%20Chat.svg
[gitter-url]: https://gitter.im/jspm/jspm?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge
[npm-image]: http://img.shields.io/npm/v/jspm.svg
[npm-url]: https://npmjs.org/package/jspm
[supporterhq-image]: https://supporterhq.com/api/b/33df4abbec4d39260f49015d2457eafe/JSPM
[supporterhq-url]: https://supporterhq.com/support/33df4abbec4d39260f49015d2457eafe/JSPM
[travis-image]: https://travis-ci.org/jspm/jspm-cli.svg?branch=master
[travis-url]: https://travis-ci.org/jspm/jspm-cli
[codecov-image]: https://img.shields.io/codecov/c/github/jspm/jspm-cli/master.svg
[codecov-url]: https://codecov.io/gh/jspm/jspm-cli/branch/master
