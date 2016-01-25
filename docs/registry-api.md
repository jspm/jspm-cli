jspm delegates all specific repository operations including lookups, downloads and build operations to registry modules.

For example, the [jspm registry](https://github.com/jspm/registry-endpoint), [GitHub registry](https://github.com/jspm/github/), or [npm registry](https://github.com/jspm/npm).

Custom registries can be easily created by exporting a new package following this Registry API.

Please do ask questions or create suggestions to help make this documentation better.

# Registry API Version 2.0

### Constructor

```
  new Registry(options, ui)
```

Options includes:

* `apiVersion` is the current registry API version string of the form `MAJOR`.`MINOR` (patch versions are not applicable to an API since all changes are public API changes).
* `versionString` represents the minor and major version of the registry package, which is used in the caching hash of packages. This can be altered and written to the instance allowing for custom registry cache invalidation - `this.versionString = options.versionString + '.53'`.
* `timeouts` an object containing timeouts for hooks. Values are in seconds that will apply before a registry hook call is retried automatically. The registry hook should cancel any requests after this timeout time as their responses won't be used after that. Registry promise errors will also result in a retry.
  * `timeouts.lookups` used for all lookup-style hooks, default is 60 seconds.
  * `timeouts.download` used for the download hook, default is 300 seconds.
  * `timeouts.build` used for the build hook, default is 300 seconds, with no retry.
* `tmpDir` is a folder the registry can use to store temporary files. This folder persists and is shared between installs.
* Any other options are as set from the registry-specific config.

### Error Handling

All hooks can reject with an error. By default all errors are assumed terminal and will abort the entire install.

#### Retriable Errors

Network errors that are retriable can be indicated by setting `e.retriable = true`, in which case the hook that failed will be re-called up to the limit.

#### Configuration Errors

Errors that are due to authentication and server configuration can be indicated via `e.config = true`. In these cases, the endpoint will run through reconfiguration before being initialized again with the new configuration for a retry.

### Methods

#### locate(packageName), optional

```
  -> Promise { notfound: true } / { redirect: 'new:package' } / undefined
```

#### lookup(packageName)
```
  -> Promise { notfound: true }
   / { versions: { 
         '1.2.3': { hash: 'asdf' }, 
         'branch-name': { hash: '8j3mjw8fwef7a', stable: false, meta: { custom: 'lookup data' } } 
     } }
```
* Version map object has hash as only required property.
* Stable set to false allows versions to opt-out of semver matching, and need exact matches only.
* meta can contain other lookup data that will be returned to the download function.
* Only versions that are valid semvers will be selected when doing version install ranges.

#### download (packageName, version, hash, meta, targetDir)
```
  -> Promise packageConfig
```

* Downloads into `targetDir`
* Only needs to return the package config if no `getPackageConfig` hook is provided.

#### getPackageConfig (packageName, version, hash, meta), optional
```
  -> Promise package config, always takes preference over download package config
```
* Allows for downloads not to block dependency tree discovery

#### processPackageConfig (packageConfig, packageName), optional
```
  -> Promise processed packageConfig
```

* Used to apply modification operations to the package configuration prior to build operations.
* The `dependencies` returned will be immediately used for preloading dependencies in parallel to downloads.
* This function, as well as the build, are separated from the transport implementations to enable linking workflows.
* Package configuration provided already has overrides included, and any `jspm` property merged in as well. The `jspm` property containing the derived override that was applied is still provided.

#### processPackage (packageConfig, packageName, packageDir), optional
```
  -> Promise processed packageConfig
```
* With the package files present, further configuration processing can be appiled before returning the final packageConfig.
* The main entry point can still be specified in the packageConfig
* Additional dependencies can be added to the packageConfig, in which case they will be downloaded after build.
* Dependencies cannot be modified or removed though due to preloading.

#### getOverride(registry, packageName, versionRange, override)

```
  -> override
```

* **For the default registry only (jspm registry).**
* The registry can also provide overrides for all packages for all other registries, as well as the locate hook which allows the registry locating.
* It is configured through `jspm config defaultRegistry registryName`.

#### static packageNameFormats

An array of wildcard expressions that can be used to match a given package name for this registry.

For example, for `github:components/jquery@1.2.3`, the package path format is `*/*`, where the `*` will not match deeply.

For npm, the package path formats are `['*', '@*/*']` to support normal names and scopes like `npm:@scope/name`.

This makes it possible to determine from any package expression like `npm:@some/package/path` which part of the expression describes the package name and which part describes a path within the package.

If no value is provided, the default is taken to be `['*']`.

#### static configure (config, ui), optional
```
  -> Promise for config
```

#### static remote, optional
```
  -> remote URL used for jspm setmode remote and injection
```
* Static property