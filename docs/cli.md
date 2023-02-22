<div align="center">
  <img style="display: inline-block; width: 100px; height: 100pz" src="./logo.png"/>
  <h1 style="display: inline-block">JSPM CLI</h1>
</div>

`jspm` is a minimal package manager for environments that support [import maps](https://github.com/WICG/import-maps), like the browser and Deno. Using `jspm`, it's possible to install, upgrade and link Javascript modules into your import maps via the command line, with features like:

* Versioned, locked dependency management against your local `package.json`.
* Tracing and installing of the full dependency tree of your application.
* Complete NPM-like module resolution that supports conditional environments and package entry points.
* Support for a wide range of CDNs, such as [JSPM](https://jspm.org), [Skypack](https://skypack.dev), [unpkg](https://unpkg.com), [jsDelivr](https://www.jsdelivr.com), and more.
* Import map extraction/injection into HTML files, with module preloading and integrity attributes.

`jspm` is built with [`@jspm/generator`](https://github.com/jspm/generator), which provides the core functionality of the package manager.


## Installation

Run the following in your terminal to install `jspm` globally:
```
npm install --global jspm
```


## Supported Commands

### `install`
> `jspm install [...packages]`

Install a package target into the import map, including all its dependency.
```sh
jspm install react react-dom
```
It's also possible to specify dependency aliases in this command.
```sh
jspm install rd=react-dom
```
This command fully supports semantic versioning like `react-dom@18.2.0` or `react-dom@latest`.

### `update`
> `jspm update [...packages]`

Update packages in the import map.

```sh
jspm update react-dom
```
### `uninstall`
> `jspm uninstall [...packages]`

Remove packages from the import map.

```sh
jspm uninstall react react-dom
```
### `link`
> `jspm link [...modules]`

Trace a module, installing all dependencies necessary into the map to support its execution including static and dynamic module imports.

```sh
jspm link ./index.js
```
### `inject`
> `jspm inject <htmlFile> [...packages]`

Inject the import map into the provided HTML source.

```sh
jspm inject index.html react
```

### `extract`
> `jspm extract [...packages]`

Extract specific packages from the import map to remove unnecessary imported packages. Consider this import-map file.
```json
{
  "imports": {
    "lodash": "https://ga.jspm.io/npm:lodash@4.17.21/lodash.js",
    "react": "https://ga.jspm.io/npm:react@18.2.0/dev.index.js"
  }
}
```
Then with running `jspm extract react`, it would generate this import-map instead:
```json
{
  "imports": {
    "react": "https://ga.jspm.io/npm:react@18.2.0/dev.index.js"
  }
}
```

### `clear-cache`
> `jspm clear-cache`

Clear the global fetch cache, usable for situation where newer builds are
needed.

## Options
- `-r, --resolution <resolutions>`: custom dependency resolution overrides for all installs
- `-e, --env <environments>`: the conditional environment resolutions to apply
- `-m, --map <map>`: an authoritative initial import map
- `-o, --output <outputFile>`: .json or .importmap file for the output
import-map. For the `inject` command this is the .html file for the output html with the import-map
- `-p, --provider <provider>`: the default provider to use for a new install,
	defaults to `jspm`. The provider can be `jspm.io` | `jspm.io#system` | `nodemodules` | `skypack` | `jsdelivr` | `unpkg`
- `--force`: force install even if the import map is up to date (default: false)
- `--stdout`: output the import map to stdout (default: false)
- `--preload`: preload the import map into the browser (default: false)
- `--integrity`: generate integrity hashes for all dependencies (default: false)
- `--compact`: output a compact import map (default: false)

## Enviroment

The default environemnt config for the cli is `--env development,browser,module`
which is configurable using the `--env` option. The default config for `browser`
and `module` can be
overwritten using the `no-${env}` prefix like `no-browser` or `no-module`. In
case of `development` mode, `production` would change mode.

```sh
jspm install --env node,no-module
```

The CLI tries to remember the `--env` configuration in the import-map file for future uses, so one time
specifying this option is enough for the next commands.
