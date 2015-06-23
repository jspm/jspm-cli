jspm delegates all specific repository operations including lookups, downloads and build operations to registry modules.

For example, the [jspm registry](https://github.com/jspm/registry-endpoint), [GitHub registry](https://github.com/jspm/github/), or [npm registry](https://github.com/jspm/npm).

Custom registries can be easily created by exporting a new package following this Registry API.

Please do ask questions or create suggestions to help make this documentation better.

# Registry API Version 1.7

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

#### download (packageName, version, hash, meta, dir)
```
  -> Promise pjson
```

* Downloads into `dir`
* Only needs to return the package.json object if no `getPackageConfig` hook is provided.

#### getPackageConfig (packageName, version, hash, meta), optional
```
  -> Promise pjson, always takes preference over download pjson
```
* Allows for downloads not to block dependency tree discovery

#### processPackageConfig (pjson, packageName), optional
```
  -> Promise pjson
```

* Used to apply modification operations to the package.json file prior to build operations.
* Called before reading dependencies, allowing for registry-specific custom dependency formats to be converted into jspm-form here.
* This function, as well as the build, are separated from the transport implementations to enable linking workflows.
* Package.json provided already has overrides added, and the `jspm` property applied as an override. The `jspm` property containing the override that was applied is still provided.

#### build (pjson, dir), optional
```
  -> optional array of build warnings to be saved under `.jspm.error` in the package
```
* Build can modify the pjson object, which is then finally saved to `.jspm.json`.
* The main entry point can still be modified in the package.json.
* Additional dependencies can be added to the package.json, in which case they will be downloaded after build.
* Dependencies cannot be modified or removed though.

#### getOverride(registry, packageName, versionRange, override)

```
  -> override
```

* **For the default registry only (jspm registry).**
* The registry can also provide overrides for all packages for all other registries, as well as the locate hook which allows the registry locating.
* It is configured through `jspm config defaultRegistry registryName`.

#### static packageFormat

A regular expression that can be used to verify a package path for the registry.

For example, for the path `github:components/jquery@1.2.3/some/path`, it should be able to match `components/jquery@1.2.3/some/path`.

If using capturing groups, the first capturing group should return the package name part (`components/jquery@1.2.3`). If not using capturing groups, the regular expression should match just this package name part. This is used by jspm to be able to separate the package name from the subpath.

For example, both `/^[^\/]+\/[^\/]+/` and `/(^[^\/]+\/[^\/]+)(\/.+)?/` would be valid for the GitHub registry.

If a package does not pass this format regular expression, an error will be thrown.

If no value is provided, the default is taken to be `/^[^\/]+/`.

#### static configure (config, ui), optional
```
  -> Promise for config
```

#### static remote, optional
```
  -> remote URL used for jspm setmode remote and injection
```
* Static property