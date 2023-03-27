
JSPM is a package manager for [import maps](https://github.com/WICG/import-maps). Using JSPM, it's possible to install, upgrade and link JavaScript modules into import maps via the command line, with features like:

* Resolution against `node_modules` for local development workflows.
* Versioned, locked dependency management against the local `package.json`.
* Tracing and installing the full dependency tree of an application.
* Complete NPM-like module resolution that supports conditional environments and package entry points.
* Support for a wide range of CDNs, such as [jspm.io](https://jspm.org), [Skypack](https://skypack.dev), [UNPKG](https://unpkg.com), [jsDelivr](https://www.jsdelivr.com), and more.
* Import map extraction/injection into HTML files, with module preloading and integrity attributes.


## Installation

The following command installs JSPM globally:
```
npm install -g @jspm/jspm
```


## Commands

For a full list of commands and supported options, run `jspm help`. For help with a specific command, use the `-h` or `--help` flag.


### `jspm link [...modules]`

Traces and installs all dependencies necessary to execute the given modules into the import map, including both static and dynamic module imports. This is the easiest way to generate an import map for a module:

```sh
jspm link ./index.js
```

To relink everything in the input map, you can call `link` without any arguments. This can be used to link the inline modules in a HTML file, for instance:

```sh
jspm link -m index.html
```


### `jspm install [...packages]`

Installs packages into the import map. By default, `jspm` will install the latest versions of the specified packages that are compatible with the constraints in the local `package.json`:

```sh
jspm install react react-dom
```

To install a particular version of a package, use an `@`. `jspm` supports full semantic versioning:

```sh
jspm install react@18.2.0 react-dom@latest
```

Packages can be installed under an alias with the `=` symbol:

```sh
jspm install alias=react-dom
```


### `jspm update [...packages]`

Updates packages in the import map to the latest versions that are compatible with the constraints in the local `package.json` file:

```sh
jspm update react-dom
```

To update every dependency in the import map, run `jspm update` without any arguments.


### `jspm uninstall [...packages]`

Uninstalls packages from the import map.

```sh
jspm uninstall lit lodash
```


### `jspm clear-cache`

Clears the global module fetch cache, for situations where the contents of dependencies have changed.


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

### Input/Output Maps

The input and output maps can be changed with the following options:
- `-m, --map <path>`: path to the initial import map
- `-o, --output <path>`: path to the output map

If the input and output targets are the same, `jspm` operates in __incremental__ mode, meaning that operations will modify the existing import map:

```sh
jspm install lit -m map.json -o map.json
```

If the input and output paths are different, `jspm` operates in __extraction__ mode, meaning that only the parts of the map that changed will be written to the output target. This can be used to extract the dependencies of a single module from an import map that contains an entire project's dependency tree, for instance:

```sh
jspm link ./lib/util.js -m project-map.json -o util-map.json
```

`jspm` supports HTML files as both input and output targets, in which case import maps are automatically parsed to/from `<script type="importmap">` tags:

```sh
jspm install react -o index.html
```

### Environment

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

### Providers

### Other

- `-r, --resolution <resolutions>`: custom dependency resolution overrides for all installs
- `-e, --env <environments>`: the conditional environment resolutions to apply
- `-m, --map <map>`: an authoritative initial import map
- `-o, --output <outputFile>`: .json or .importmap file for the output
import-map. For the `inject` command this is the .html file for the output html with the import-map
- `-p, --provider <provider>`: the default provider to use for a new install,
	defaults to JSPM. The provider can be JSPM | `jspm.system` | `nodemodules` | `skypack` | `jsdelivr` | `unpkg`
- `--force`: force install even if the import map is up to date (default: false)
- `--stdout`: output the import map to stdout (default: false)
- `--preload`: preload the import map into the browser (default: false)
- `--integrity`: generate integrity hashes for all dependencies (default: false)
- `--compact`: output a compact import map (default: false)

