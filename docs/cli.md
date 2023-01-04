# JSPM CLI
> A minimal package manager for import-maps compliant environemnts like deno and browser.

With JSPM CLI, it's possible to load any npm module into your import maps via the command line. 
Features like tracing a module and installing the dependencies, updating the modules or even injecting a specific import-map into the HTML file.

- Installing and Uninstalling npm dependencies
- Updating dependencies
- Trace Installing modules
- Injecting Import-maps
- Extracting packages from the Import-maps 
 
 ## Install
```
npm i -g jspm
```
## Commands
### `install` (alias: `i`)
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
### `trace-install` (alias: `ti`)
> `jspm trace-install [...modules]`

Trace a module, installing all dependencies necessary into the map to support its execution including static and dynamic module imports.

```sh
jspm trace-install ./index.js
```
### `inject`
> `jspm inject <htmlFile> [...packages]`

Inject the import map into the provided HTML source.

```sh
jspm inject index.html react
```

### `extract` (alias: `e`)
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
## Options
- `-r, --resolution <resolutions>`: custom dependency resolution overrides for all installs
- `-e, --env <environments>`: the conditional environment resolutions to apply
- `-m, --map <map>`: an authoritative initial import map
- `-o, --output <outputFile>`: .json or .importmap file for the output import-map
- `--force`: force install even if the import map is up to date (default: false)
- `--stdout`: output the import map to stdout (default: false)
- `--preload`: preload the import map into the browser (default: false)
- `--integrity`: generate integrity hashes for all dependencies (default: false)
- `--compact`: output a compact import map (default: false)
