# New in v0.17

- New dynamic package configuration system

- New linking workflow

- Peer dependency support

  jspm 0.17 supports peer dependencies.

- Transpilers as plugins

  Babel is now available as a [plugin](https://github.com/systemjs/plugin-babel) as well as [Traceur](https://github.com/systemjs/plugin-traceur). A 3rd-party plugin for Typescript is available: https://github.com/frankwallis/plugin-typescript

- Config file management improved

  In 0.17 the config management was re-worked so that updates JSPM makes to config files retain the content style and properties.

- GitHub registry endpoint reworked

  Previously jspm used GitHub releases to fetch packages. In 0.17 GitHub registry endpoint directly uses git tag or release branches.

- Full support for server-side npm installs

- npm registry endpoint reworked

  In 0.17 npm packages are not modified on installation. The npm packages are installed as is and jspm generates a configuration file stored in `jspm_packages/npm/package@x.y.z.json`. These individual package can be overridden by you and all overrides are persisted in the project package.json. Also overrides provided via jspm registry are persisted in the package.json so that you can inspect and modify them.


- Local project as a package itself with init prompt handling

  In 0.17 `jspm init` configures your local application as a package with its own name, main entry and other configuration options.


- Automatic Rollup optimizations for jspm build

  In 0.17 static builds (`jspm build`) are automatically optimized with [Rollup](http://rollupjs.org/).
