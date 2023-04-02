JSPM is a package manager for [import maps](https://github.com/WICG/import-maps). Using JSPM, it's possible to install, upgrade and link JavaScript modules into import maps via the command line, with features like:

* Resolution against `node_modules` for local development workflows.
* Versioned, locked dependency management against the local `package.json`.
* Tracing and installing the full dependency tree of an application.
* Complete NPM-like module resolution that supports conditional environments and package entry points.
* Support for a wide range of CDNs, such as [jspm.io](https://jspm.org), [Skypack](https://skypack.dev), [UNPKG](https://unpkg.com), [jsDelivr](https://www.jsdelivr.com), [esm.sh](https://esm.sh) and more.
* Import map extraction/injection into HTML files, with [module preload](#preload-tags-and-integrity-attributes)ing and integrity attributes.


## Installation

The following command installs JSPM globally:
```
npm install -g @jspm/jspm
```


# Commands

For a full list of commands and supported options, run `jspm help`. For help with a specific command, use the `-h` or `--help` flag.


## jspm link

`$ jspm link [flags] [...modules]`

Traces and installs all dependencies necessary to execute the given modules into an import map, including both static and dynamic module imports. The given modules can be:
1. Paths to local JavaScript modules, such as `./src/my-module.mjs`.
4. Paths to local HTML files, such as `index.html`, in which case all module scripts in the file are linked.
2. Valid package specifiers, such as `react` or `chalk@5.2.0`, in which case the package's main export is linked.
3. Valid package specifiers with subpaths, such as `sver@1.1.1/convert-range`, in which case the subpath is resolved against the package's exports and the resulting module is linked.

In some cases there may be ambiguity. For instance, you may want to link the NPM package `app.js`, but your working directory contains a local file called `app.js` as well. In these cases local files are preferred by default, and external packages must be prefixed with the `%` character (i.e. `%app.js`).

If no modules are given, all `imports` in the initial map are _relinked_.

### Examples

* `jspm link` <br>
Relinks all of the mappings in `importmap.json`.

* `jspm link ./src/cli.js` <br>
Links the given module and all of its dependencies.

* `jspm link index.js` <br>
Links the dependencies of the local `index.js` file if it exists, or the NPM package `index.js` if it doesn't.

* `jspm link %app.js` <br>
Links the dependencies of the NPM package `app.js`.

* `jspm link --map index.html --integrity --preload` <br>
Extracts the inline import map from `index.html`, relinks all of its mappings, and injects the resulting map back into `index.html` with [preload tags](#preload-tags-and-integrity-attributes) and [integrity attributes](#preload-tags-and-integrity-attributes).

### Flags

* `-m, --map <file>` <br>
File containing initial import map. May be JSON, in which case the file itself is taken to be the map, or HTML, in which case the map is parsed from any existing `<script type="importmap">` tag in the file. Defaults to `importmap.json`.

* `-o, --output <file>` <br>
File to output the resulting import map into. May be JSON, in which case the map is written directly into the file, or HTML, in which case the map is injected into the file as a `<script type="importmap">` tag. If the output flag differs from the map flag, the resulting map will only contain the given modules and their dependencies. If the flags are the same, the map will be updated instead. Defaults to the value of the `--map` flag.

* `-p, --provider <provider` <br>
Provider to resolve dependencies against in the resulting map - see the [providers](#providers) section. Only a single provider may be selected. Defaults to `jspm.io`.

* `-e, --env <environment>` <br>
Conditional environments to apply in the resulting map - see the [environments](#environments) section. Multiple environment flags may be provided.

* `-r, --resolution <resolution>` <br>
Resolution overrides to apply in the resulting map - see the [resolutions](#resolutions) section. Multiple resolution flags may be provided.

* `--cache <mode>` <br>
Cache mode to use for resource fetches. Can be `online` to use cached resources when they are fresh, `offline` to use cached resources even if they are not fresh, and `no-cache` to disable caching entirely. Defaults to `online`.

* `--preload` <br>
Inject [module preload](#preload-tags-and-integrity-attributes) tags into HTML output. Defaults to `false`.

* `--integrity` <br>
Add [integrity attributes](#preload-tags-and-integrity-attributes) when injecting [module preload](#preload-tags-and-integrity-attributes) tags into HTML output. Defaults to `false`.

* `--freeze` <br>
Treat the initial import map as _frozen_, i.e. no existing version resolutions in the map will be changed during the link. Defaults to `false`.

* `--stdout` <br>
Output the resulting map to `stdout` instead of the output file. Defaults to `false`.

## jspm install

`$ jspm install [flags] [...packages]`

Installs packages into an import map, along with all of the dependencies that are necessary to import them. By default, the latest versions of the packages that are compatible with the local `package.json` are installed, unless an explicit version is specified. The given packages must be valid package specifiers, such as `npm:react@18.0.0` or `denoland:oak`. If a package specifier with no registry is given, such as `lit`, the registry is assumed to be NPM. Packages can be installed under an alias by using specifiers such as `myname=npm:lit@2.1.0`. An optional subpath can be provided, such as `npm:lit@2.2.0/decorators.js`, in which case only the dependencies for that subpath are installed.

If no packages are provided, all `imports` in the initial map are _reinstalled_.

### Examples

* `jspm install` <br>
Reinstalls all of the `imports` in `importmap.json`.

* `jspm install lit` <br>
Installs the latest compatible version of `npm:lit` into `importmap.json`.

* `jspm install npm:react@18.2.0` <br>
Installs `npm:react` with the specified version `18.2.0` into `importmap.json`.

* `jspm install -p deno denoland:oak` <br>
Installs the latest compatible version of `oak` from the `denoland` registry into `importmap.json`. Note that this requires the use of the `deno` [provider](#providers).

* `jspm install alias=react` <br>
Installs the latest compatible version of `npm:react` into `importmap.json` under the alias `alias`.

* `jspm install npm:lit@2.2.0/decorators.js` <br>
Installs the exports subpath `./decorators.js` of `npm:lit@2.2.0` into `importmap.json`.

### Flags

* `-m, --map <file>` <br>
File containing initial import map. May be JSON, in which case the file itself is taken to be the map, or HTML, in which case the map is parsed from any existing `<script type="importmap">` tag in the file. Defaults to `importmap.json`.

* `-o, --output <file>` <br>
File to output the resulting import map into. May be JSON, in which case the map is written directly into the file, or HTML, in which case the map is injected into the file as a `<script type="importmap">` tag. The resulting map will always contain the initial map with the given packages installed into it. Defaults to the value of the `--map` flag.

* `-p, --provider <provider` <br>
Provider to resolve dependencies against in the resulting map - see the [providers](#providers) section. Only a single provider may be selected. Defaults to `jspm.io`.

* `-e, --env <environment>` <br>
Conditional environments to apply in the resulting map - see the [environments](#environments) section. Multiple environment flags may be provided.

* `-r, --resolution <resolution>` <br>
Resolution overrides to apply in the resulting map - see the [resolutions](#resolutions) section. Multiple resolution flags may be provided.

* `--cache <mode>` <br>
Cache mode to use for resource fetches. Can be `online` to use cached resources when they are fresh, `offline` to use cached resources even if they are not fresh, and `no-cache` to disable caching entirely. Defaults to `online`.

* `--preload` <br>
Inject [module preload](#preload-tags-and-integrity-attributes) tags into HTML output. Defaults to `false`.

* `--integrity` <br>
Add [integrity attributes](#preload-tags-and-integrity-attributes) when injecting [module preload](#preload-tags-and-integrity-attributes) tags into HTML output. Defaults to `false`.

* `--freeze` <br>
Treat the initial import map as _frozen_, i.e. no existing version resolutions in the map will be changed during the link. Defaults to `false`.

* `--stdout` <br>
Output the resulting map to `stdout` instead of the output file. Defaults to `false`.

## jspm update

`$ jspm update [flags] [...packages]`

Updates packages in an import map to the latest versions that are compatible with the local `package.json`. The given packages must be valid package specifiers, such as `npm:react@18.0.0`, `denoland:oak` or `lit`, and must be present in the initial import map.

### Examples

* `jspm update` <br>
Updates all dependencies in `importmap.json` to their latest compatible versions.

* `jspm update react-dom` <br>
Updates `react-dom` and its dependencies to their latest compatible versions.

### Flags

* `-m, --map <file>` <br>
File containing initial import map. May be JSON, in which case the file itself is taken to be the map, or HTML, in which case the map is parsed from any existing `<script type="importmap">` tag in the file. Defaults to `importmap.json`.

* `-o, --output <file>` <br>
File to output the resulting import map into. May be JSON, in which case the map is written directly into the file, or HTML, in which case the map is injected into the file as a `<script type="importmap">` tag. The resulting map will always contain the initial map with the given packages updated to their latest versions. Defaults to the value of the `--map` flag.

* `-p, --provider <provider` <br>
Provider to resolve dependencies against in the resulting map - see the [providers](#providers) section. Only a single provider may be selected. Defaults to `jspm.io`.

* `-e, --env <environment>` <br>
Conditional environments to apply in the resulting map - see the [environments](#environments) section. Multiple environment flags may be provided.

* `-r, --resolution <resolution>` <br>
Resolution overrides to apply in the resulting map - see the [resolutions](#resolutions) section. Multiple resolution flags may be provided.

* `--cache <mode>` <br>
Cache mode to use for resource fetches. Can be `online` to use cached resources when they are fresh, `offline` to use cached resources even if they are not fresh, and `no-cache` to disable caching entirely. Defaults to `online`.

* `--preload` <br>
Inject [module preload](#preload-tags-and-integrity-attributes) tags into HTML output. Defaults to `false`.

* `--integrity` <br>
Add [integrity attributes](#preload-tags-and-integrity-attributes) when injecting [module preload](#preload-tags-and-integrity-attributes) tags into HTML output. Defaults to `false`.

* `--freeze` <br>
Treat the initial import map as _frozen_, i.e. no existing version resolutions in the map will be changed during the link. Defaults to `false`.

* `--stdout` <br>
Output the resulting map to `stdout` instead of the output file. Defaults to `false`.

## jspm uninstall

`$ jspm uninstall [flags] [...packages]`

Uninstalls packages from an import map. The given packages must be valid package specifiers, such as `npm:react@18.0.0`, `denoland:oak` or `lit`, and must be present in the initial import map.

### Examples

* `jspm uninstall lit lodash` <br>
Removes `lit` and `lodash` from `importmap.json`, along with any dependencies unique to them.

### Flags

* `-m, --map <file>` <br>
File containing initial import map. May be JSON, in which case the file itself is taken to be the map, or HTML, in which case the map is parsed from any existing `<script type="importmap">` tag in the file. Defaults to `importmap.json`.

* `-o, --output <file>` <br>
File to output the resulting import map into. May be JSON, in which case the map is written directly into the file, or HTML, in which case the map is injected into the file as a `<script type="importmap">` tag. The resulting map will always contain the initial map with the given packages uninstalled from it. Defaults to the value of the `--map` flag.

* `-p, --provider <provider` <br>
Provider to resolve dependencies against in the resulting map - see the [providers](#providers) section. Only a single provider may be selected. Defaults to `jspm.io`.

* `-e, --env <environment>` <br>
Conditional environments to apply in the resulting map - see the [environments](#environments) section. Multiple environment flags may be provided.

* `-r, --resolution <resolution>` <br>
Resolution overrides to apply in the resulting map - see the [resolutions](#resolutions) section. Multiple resolution flags may be provided.

* `--cache <mode>` <br>
Cache mode to use for resource fetches. Can be `online` to use cached resources when they are fresh, `offline` to use cached resources even if they are not fresh, and `no-cache` to disable caching entirely. Defaults to `online`.

* `--preload` <br>
Inject [module preload](#preload-tags-and-integrity-attributes) tags into HTML output. Defaults to `false`.

* `--integrity` <br>
Add [integrity attributes](#preload-tags-and-integrity-attributes) when injecting [module preload](#preload-tags-and-integrity-attributes) tags into HTML output. Defaults to `false`.

* `--freeze` <br>
Treat the initial import map as _frozen_, i.e. no existing version resolutions in the map will be changed during the link. Defaults to `false`.

* `--stdout` <br>
Output the resulting map to `stdout` instead of the output file. Defaults to `false`.

## jspm clear-cache

`$ jspm clear-cache`

Clears the global module fetch cache, for situations where the contents of a dependency may have changed without a version bump. This can happen during local development, for instance.

# Configuration

## Environments

Environments allow for the resolution of [conditional exports](https://nodejs.org/dist/latest-v19.x/docs/api/packages.html#conditional-exports) in a package. For instance, some packages may export different modules under a particular subpath depending on whether the environment is Node.js, the browser, or Deno. Multiple environments can be set for a particular operation, and resolution will follow the rules linked in the Node.js documentation.

The default environments for all operations are `development`, `browser` and `module`. To configure different environments, you can provide one or more `-e` or `--env` flags. Environments like `development` and `production` are _modal_, meaning that setting one will override the other. To disable the default `browser` or `module` environments, you can set the `no-browser` or `no-module` environments respectively.

The environments used to generate a particular import map are recorded in the resulting map, so specifying the environments for a series of operations is only necessary for the first one.

### Examples

* `diff <(jspm i axios --stdout) <(jspm i axios -e no-browser --stdout)` <br>
Compares the import maps for `axios` in a browser environment (the default), and a non-browser environment:

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

Providers are used to resolve package _specifiers_ (such as `npm:react@18.2.0`) to package _resources_ (such as [https://ga.jspm.io/npm:react@18.2.0/](https://ga.jspm.io/npm:react@18.2.0/package.json)). The default provider for all operations is `jspm.io`, which uses the [jspm.io](https://jspm.io) CDN for package resolutions. To configure a different provider, you can provide a `-p` or `--provider` flag. The list of supported providers is:

* `jspm.io`
* `jspm.io#system`
* `nodemodules`
* `esm.sh`
* `unpkg`
* `jsdelivr`
* `skypack`
* `deno`

Most of these providers will resolve against their corresponding CDNs. For instance, `esm.sh` uses the [esm.sh](https://esm.sh) CDN, `unpkg` uses the [UNPKG](https://unpkg.com) CDN, and so on.

The `jspm.io#system` provider also uses the [jspm.io](https://jspm.io) CDN, but the resolved packages use the [SystemJS](https://github.com/systemjs/systemjs) module format rather than [ESM](https://nodejs.org/api/esm.html).

The `nodemodules` provider resolves packages against the local `node_modules` folder, allowing you to generate import maps for local development. Note that this may not work in runtimes like the browser if you have CommonJS dependencies.

### Examples

* `jspm install -p nodemodules lit` <br>
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

Resolutions are used to remap package _names_ to particular package _specifiers_. For instance, the latest version of one of your secondary dependencies may be broken, and you want to pin it to an older version, or even to a different package altogether. To do this, you can provide one or more `-r` or `--resolution` flags, with arguments `[package_name]=[package_version]` or `[package_name]=[package_specifier]`. Package specifiers can take the full syntax described under [`jspm install`](#jspm-install).

When a resolution is set, _all_ dependencies on that package will take the given remapping, no matter what the the resolution context is. Note that this may cause packages to break in unexpected ways if you violate their dependency constraints.

### Examples

* `jspm install react@latest -r react=npm:preact@10.13.2` <br>
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

Using an import map in the browser can lead to a lengthy cycle of fetching a module, analysing its static imports against the import map, fetching _those_ modules, analysing _their_ static imports against the import map, and so forth. If you know that all of the mappings are going to be fetched at some point in a page's execution, you can use [preload tags](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel/preload) to instruct the browser to fetch all of the resources up-front. Preload tags can be automatically injected into any HTML outputs using the `--preload` flag.

[Integrity attributes](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) instruct the browser to verify fetched resources against a hash, to make sure that they haven't been tampered with in-transit. This protects your page against man-in-the-middle attacks, and can be automatically injected into any HTML outputs using the `--integrity` flag.
