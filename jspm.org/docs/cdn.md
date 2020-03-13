# CDN Documentation

**Current CDN Version: Gamma / "gma"**

## CDN URLs

jspm is an _optimizing CDN_. All packages loaded through the jspm CDN are optimized.

There are three primary variants of the jspm CDN:

1. `https://gma.jspm.dev/`: Development CDN. Serves optimized ES modules with version resolutions inlined and no need for import maps. Useful for quick experimentation workflows only - **zero stability guarantees**.
2. `https://gma.jspm.io/`: ES Module CDN. Serves optimized ES modules for use with import maps. **Production-ready, 99.99% uptime guarantee, 100% backwards compatibility guarantee.**
3. `https://gma.jspm.systems/`: System CDN. Services optimized System modules for use with import maps. **Production-ready, 99.99% uptime guarantee, 100% backwards compatibility guarantee.**

Every new major release of the jspm CDN code gets a three letter version prefix. The current version is Gamma - "gma".

You can directly access `https://jspm.dev` in development workflows, it will just redirect to the current major version prefix.

### URL Format

For all CDNs, the paths take the following form:

```
/[registry]:[package-name]@[version]/[path]
```

* `registry` is included because other registries other than `npm` may be supported in future - npm isn't given special treatmeny by jspm.
* `package-name` is the package name in the registry (scoped or unscoped).
* `version` is the semver version of the package. When using the development CDN, the version is optional, version shortcuts are provided and tagged version aliases are also supported.
* `path` is the path to the module within the package. The path corresponds to the published path of the modules within the package.

## Package Structure

The public interface of packages is defined by the `"exports"` field.

To write a package for jspm, the best approach is to just always define an `"exports"` field for the package.

Packages not using the `"exports"` field have their exports inferred from a comprehensive automated package analysis. There is no control over this automated process, which is why the `"exports"` field is recommended though.

### Package Exports

The exports of a package define its public interface - the modules it exposes to public importers.

Any module which is defined as an export will be guaranteed to exist at its defined path in the optimized package output.

Any private module - a module not defined as an export, but only used internally, will likely not be available as a path of the optimized package as it will be optimized into approached common chunking by the optimization process.

Other files in the package such as the package.json file, CSS files, images etc will also not be included as paths of the optimized package _unless_ they were
made available as package exports.

Non-JS files can be defined by package exports just like JS files.

In addition folder exports will expose all files in the folder - both JS and non-JS, such that the JS files will all be optimized, while the non-JS files will be exposed in the optimized package.

### Dynamic Import

Dynamic imports to external packages are supported fine.

Dynamic imports to internal modules will work fine so long as those internal dynamic import expressions are traceable.

Basic expressions can be analyzed, but more complex multi-line expressions may not be understood by the compiler.

In these cases, it is advisable to ensure that the internal module is exposed as an export _somehow_.

For example, via a self internal resolution.

### import.meta.url

`import.meta.url` is supposed fine for entry modules.

For private modules, `import.meta.url` will be _shimmed_ to refer to the original path the private module came from. This way, relative handling with `import.meta.url`
will continue to work out correctly as if the original module structure were still in place.
