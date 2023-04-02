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
