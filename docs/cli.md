# JSPM CLI
> A minimal package manager for import-maps compliant environemnts like deno and browser.

With JSPM CLI, it's possible to load any npm module into your import maps via the command line. 
Features like tracing a module and installing the dependencies, updating the modules or even injecting a specific import-map into the HTML file.

* Installing and Uninstalling npm dependencies
* Updating dependencies
* Linking (Trace installing) modules
* Injecting Import-maps
* Extracting packages from the Import-maps 


## Install
```
npm i -g jspm
```
## Commands

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
