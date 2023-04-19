
The JSPM CLI is the main command-line import map package management tool for JSPM.

> For a complete guide and introduction to the JSPM CLI and import map package management, see the [getting started guide](/getting-started).

For import map generation API usage or in other environments, see the low-level [Generator API](/docs/generator/stable/) which is the internal import map package management and generation API which this CLI project wraps. The [Generator API documentation](/docs/generator/stable/) also provides a more thorough details of the operations.

## Installation

The following command installs JSPM globally:

```
npm install -g jspm
```

# Commands

For a full list of commands and supported options, run `jspm --help`. For help with a specific command, add the `-h` or `--help` flag to the command invocation.

By default, JSPM operates on `importmap.json` which is automatically created if it does not exist. This is considered the main import map on which link and install operations are being performed, and can be customized with the `--map` option.

## link

### Usage
  
```
jspm link [flags] [...modules]
```
Traces and installs all dependencies necessary to execute the given modules into an import map, including both static and dynamic module imports. The given modules can be:
  1. Paths to local JavaScript modules, such as "./src/my-module.mjs".
  2. Paths to local HTML files, such as "index.html", in which case all module scripts in the file are linked.
  3. Valid package specifiers, such as `react` or `chalk@5.2.0`, in which case the package's main export is linked.
  4. Valid package specifiers with subpaths, such as `sver@1.1.1/convert-range`, in which case the subpath is resolved against the package's exports and the resulting module is linked.

In some cases there may be ambiguity. For instance, you may want to link the NPM package "app.js", but your working directory contains a local file called "app.js" as well. In these cases local files are preferred by default, and external packages must be prefixed with the "%" character (i.e. "%app.js").

If no modules are given, all "imports" in the initial map are relinked.

### Options
* `-m, --map` _&lt;file&gt;_                File containing initial import map (default: importmap.json)
* `-o, --output` _&lt;file&gt;_             File to inject the final import map into (default: --map / importmap.json) 
* `-e, --env` &lt;[environments](#environments)&gt;        Comma-separated environment condition overrides 
* `-r, --resolution` &lt;[resolutions](#resolutions)&gt;  Comma-separated dependency resolution overrides 
* `-p, --provider` &lt;[providers](#providers)&gt;       Default module provider 
* `--cache` _&lt;mode&gt;_                  Cache mode for fetches (online, offline, no-cache) (default: online)
* `--root` _&lt;url&gt;_                    URL to treat as server root, i.e. rebase import maps against 
* `--preload` _[mode]_                Add module preloads to HTML output (default: static, dynamic) 
* `--integrity`                     Add module preloads with integrity attributes to HTML output (default: false)
* `--compact`                       Output a compact import map (default: false)
* `--freeze`                        Freeze input map dependencies, i.e. do not modify them (default: false)
* `--stdout`                        Output the import map to stdout (default: false)
* `--silent`                        Silence all output (default: false)
* `-h, --help`                      Display this message 

### Examples
Link a remote package in importmap.json
  
```
jspm link chalk@5.2.0
```
Link a local module
  
```
jspm link ./src/cli.js
```
Link an HTML file and update its import map including preload and integrity tags
  
```
jspm link --map index.html --integrity --preload dynamic
```
## install

### Usage
  
```
jspm link [flags] [...packages]
```
Installs packages into an import map, along with all of the dependencies that are necessary to import them.By default, the latest versions of the packages that are compatible with the local "package.json" are installed, unless an explicit version is specified. The given packages must be valid package specifiers, such as `npm:react@18.0.0` or `denoland:oak`. If a package specifier with no registry is given, such as `lit`, the registry is assumed to be NPM. Packages can be installed under an alias by using specifiers such as `myname=npm:lit@2.1.0`. An optional subpath can be provided, such as `npm:lit@2.2.0/decorators.js`, in which case only the dependencies for that subpath are installed.

If no packages are provided, all "imports" in the initial map are reinstalled.

### Options
* `-m, --map` _&lt;file&gt;_                File containing initial import map (default: importmap.json)
* `-o, --output` _&lt;file&gt;_             File to inject the final import map into (default: --map / importmap.json) 
* `-e, --env` &lt;[environments](#environments)&gt;        Comma-separated environment condition overrides 
* `-r, --resolution` &lt;[resolutions](#resolutions)&gt;  Comma-separated dependency resolution overrides 
* `-p, --provider` &lt;[providers](#providers)&gt;       Default module provider 
* `--cache` _&lt;mode&gt;_                  Cache mode for fetches (online, offline, no-cache) (default: online)
* `--root` _&lt;url&gt;_                    URL to treat as server root, i.e. rebase import maps against 
* `--preload` _[mode]_                Add module preloads to HTML output (default: static, dynamic) 
* `--integrity`                     Add module preloads with integrity attributes to HTML output (default: false)
* `--compact`                       Output a compact import map (default: false)
* `--freeze`                        Freeze input map dependencies, i.e. do not modify them (default: false)
* `--stdout`                        Output the import map to stdout (default: false)
* `--silent`                        Silence all output (default: false)
* `-h, --help`                      Display this message 

### Examples
Install a package
  
```
jspm install lit
```
Install a versioned package and subpath
  
```
jspm install npm:lit@2.2.0/decorators.js
```
Install a versioned package
  
```
jspm install npm:react@18.2.0
```
Install a Denoland package and use the Deno provider
  
```
jspm install -p deno denoload:oak
```
Install "alias" as an alias of the resolution react
  
```
jspm install alias=react
```
## uninstall

### Usage
  
```
jspm uninstall [flags] [...packages]
```
Uninstalls packages from an import map. The given packages must be valid package specifiers, such as `npm:react@18.0.0`, `denoland:oak` or `lit`, and must be present in the initial import map.

### Options
* `-m, --map` _&lt;file&gt;_                File containing initial import map (default: importmap.json)
* `-o, --output` _&lt;file&gt;_             File to inject the final import map into (default: --map / importmap.json) 
* `-e, --env` &lt;[environments](#environments)&gt;        Comma-separated environment condition overrides 
* `-r, --resolution` &lt;[resolutions](#resolutions)&gt;  Comma-separated dependency resolution overrides 
* `-p, --provider` &lt;[providers](#providers)&gt;       Default module provider 
* `--cache` _&lt;mode&gt;_                  Cache mode for fetches (online, offline, no-cache) (default: online)
* `--root` _&lt;url&gt;_                    URL to treat as server root, i.e. rebase import maps against 
* `--preload` _[mode]_                Add module preloads to HTML output (default: static, dynamic) 
* `--integrity`                     Add module preloads with integrity attributes to HTML output (default: false)
* `--compact`                       Output a compact import map (default: false)
* `--freeze`                        Freeze input map dependencies, i.e. do not modify them (default: false)
* `--stdout`                        Output the import map to stdout (default: false)
* `--silent`                        Silence all output (default: false)
* `-h, --help`                      Display this message 

### Examples


```
jspm uninstall lit lodash
```
Uninstall "lit" and "lodash" from importmap.json.

## update

### Usage
  
```
jspm update [flags] [...packages]
```
Updates packages in an import map to the latest versions that are compatible with the local `package.json`. The given packages must be valid package specifiers, such as `npm:react@18.0.0`, `denoland:oak` or `lit`, and must be present in the initial import map.

### Options
* `-m, --map` _&lt;file&gt;_                File containing initial import map (default: importmap.json)
* `-o, --output` _&lt;file&gt;_             File to inject the final import map into (default: --map / importmap.json) 
* `-e, --env` &lt;[environments](#environments)&gt;        Comma-separated environment condition overrides 
* `-r, --resolution` &lt;[resolutions](#resolutions)&gt;  Comma-separated dependency resolution overrides 
* `-p, --provider` &lt;[providers](#providers)&gt;       Default module provider 
* `--cache` _&lt;mode&gt;_                  Cache mode for fetches (online, offline, no-cache) (default: online)
* `--root` _&lt;url&gt;_                    URL to treat as server root, i.e. rebase import maps against 
* `--preload` _[mode]_                Add module preloads to HTML output (default: static, dynamic) 
* `--integrity`                     Add module preloads with integrity attributes to HTML output (default: false)
* `--compact`                       Output a compact import map (default: false)
* `--freeze`                        Freeze input map dependencies, i.e. do not modify them (default: false)
* `--stdout`                        Output the import map to stdout (default: false)
* `--silent`                        Silence all output (default: false)
* `-h, --help`                      Display this message 

### Examples


```
jspm update react-dom
```
Update the react-dom package.

## clear-cache

### Usage
  
```
jspm clear-cache
```
Clears the global module fetch cache, for situations where the contents of a dependency may have changed without a version bump. This can happen during local development, for instance.

### Options
* `--silent`    Silence all output (default: false)
* `-h, --help`  Display this message 

# Configuration

## Environments

Environments allow for configuring the conditional resolutions (ie [conditional exports](https://nodejs.org/dist/latest-v19.x/docs/api/packages.html#conditional-exports) and imports) for resolved packages.

The default environments for all operations are `development`, `browser` and `module`.

To configure different environments, you can provide one or more `-e` or `--env` flags with additional environment names to resolve. Environments like `development` and `production` are _modal_, meaning that setting one will override the other. To disable the default `browser` or `module` environments, you can set the `no-browser` or `no-module` environments respectively.

The environments used to generate a particular import map are recorded in the resulting map, so specifying the environments for a series of operations is only necessary for the first one.

### Examples

Compareing the import maps for `axios` in a browser environment (the default), and a non-browser environment:

```
diff <(jspm i axios --stdout) <(jspm i axios -e no-browser --stdout)
```

```
[...]
<       "#lib/adapters/http.js": "https://ga.jspm.io/npm:@jspm/core@2.0.1/nodelibs/@empty.js",
<       "#lib/platform/node/classes/FormData.js": "https://ga.jspm.io/npm:@jspm/core@2.0.1/nodelibs/@empty.js",
<       "#lib/platform/node/index.js": "https://ga.jspm.io/npm:@jspm/core@2.0.1/nodelibs/@empty.js"
---
>       "#lib/": "https://ga.jspm.io/npm:axios@1.3.4/lib/",
[...]
```

## Providers

Providers are used to resolve package _canonical names_ (such as `npm:react@18.2.0`) to _resolved URLs_ (such as [https://ga.jspm.io/npm:react@18.2.0/](https://ga.jspm.io/npm:react@18.2.0/package.json)). The default provider for all operations is `jspm.io`, which uses the [jspm.io](https://jspm.io) CDN for package resolutions. To configure a different provider, you can provide a `-p` or `--provider` flag.

The following providers are supported:

* `jspm.io`
* `jspm.io#system`
* `nodemodules`
* `esm.sh`
* `unpkg`
* `jsdelivr`

Most of these providers will resolve against their corresponding CDNs. For instance, `esm.sh` uses the [esm.sh](https://esm.sh) CDN, `unpkg` uses the [UNPKG](https://unpkg.com) CDN, and so on.

The `jspm.io#system` provider also uses the [jspm.io](https://jspm.io) CDN, but the resolved packages use the [SystemJS](https://github.com/systemjs/systemjs) module format rather than [ESM](https://nodejs.org/api/esm.html).

The `nodemodules` provider resolves packages against the local `node_modules` folder, allowing you to generate import maps for local development. This will only work in the browser if all dependencies are ESM dependencies.

### Examples

```
jspm install -p nodemodules lit
```

Installs `lit` into the import map using the `nodemodules` provider, which maps packges against the local `node_modules` directory. Note that this will fail unless `lit` and its dependencies have already been installed locally with `npm`. The resulting import map looks like this:

```json
{
  "env": [
    "browser",
    "development",
    "module"
  ],
  "imports": {
    "lit": "./node_modules/lit/index.js"
  },
  "scopes": {
    "./node_modules/": {
      "@lit/reactive-element": "./node_modules/@lit/reactive-element/development/reactive-element.js",
      "lit-element/lit-element.js": "./node_modules/lit-element/development/lit-element.js",
      "lit-html": "./node_modules/lit-html/development/lit-html.js",
      "lit-html/is-server.js": "./node_modules/lit-html/development/is-server.js"
    }
  }
}
```


## Resolutions

Resolutions are used to remap package _names_ to particular package _targets_. For instance, the latest version of one of your secondary dependencies may be broken, and you want to pin it to an older version, or even to a different package altogether. To do this, you can provide one or more `-r` or `--resolution` flags, with arguments `[package_name]=[target_version]` or `[package_name]=[registry]:[name]@[target-range]`. Package specifiers can take the full syntax described under [`jspm install`](#jspm-install).

When a resolution is set, _all_ dependencies on that package will take the given remapping, no matter what the the resolution context is. Note that this may cause packages to break in unexpected ways if you violate their dependency constraints.

### Examples

```
  jspm install react@latest -r react=npm:preact@10.13.2
```

Installs `npm:preact@10.13.2` into the import map under the name `react`. Note that this will happen even though we have specified a particular version for `react`. The resulting import map looks like this:

```json
{
  "env": [
    "browser",
    "development",
    "module"
  ],
  "imports": {
    "react": "https://ga.jspm.io/npm:preact@10.13.2/dist/preact.module.js"
  }
}
```


## Preload Tags and Integrity Attributes

It is always recommended to generate modulepreload tags for production apps using import maps. This avoids the latency waterfall for dependency discovery by inlining preload hints for all statically loaded modules upfront.

In addition, preload tags can also include [integrity attributes](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) for static dependency integrity.

When performing HTML injection operations (ie when the `--output` import map is an HTML file), `--preload` and `--integrity` can be used to handle this injection automatically.

