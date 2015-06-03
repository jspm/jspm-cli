When developing multiple packages locally, `jspm link` allows these local packages to be made available for installation through jspm.

> There are some differences to standard linking workflows when linking with jspm, so its advisable to read these notes carefully.

Linked packages are linked into a full registry, package and version name like `github:my/repo@dev`. Ideally this is the registry name that will be published so that linked packages can be replaced with their published counterparts easily.

### 1. Use `jspm link` to add a package to the global link cache

```
  cd my-local-package
  jspm link github:my/repo@dev
ok   Package linked.
```

If you include the `name`, `registry` and `version` properties in the package.json, we don't need to provide the name when using `jspm link`:

```json
{
  "name": "my/repo",
  "version": "dev",
  "registry": "github"
}
```
```
  jspm link
ok   Package linked.
```

Note that because registries apply arbitrary build operations to packages, and jspm also does some build operations, every code change to the local package requires `jspm link` be run again from that folder. A watch task could be set up to manage this, an issue for creating this project is being tracked at https://github.com/jspm/jspm-cli/issues/481.

When linking over an existing package, jspm will ask to confirm the relink. Because this is a common workflow, it is advisable to use:

```
  jspm link github:my/repo@dev -y
```

to auto-confirm this prompt.

### 2. Use `jspm install --link` to install a package from the global link cache

```
  cd my-jspm-app
  jspm install --link github:my/repo@dev
```

The linked package will be symlinked into `jspm_packages`, and its dependencies will be installed down the tree.

If linking packages that depend on eachother, start with the lowest in the dependency tree first.

> If the package doesn't yet belong to a registry, it is also possible to link into the jspm registry itself with a name like `jspm link jspm:mypkg@dev`. Then this can be installed with `jspm install --link mypkg@dev`.

### 3. Use `jspm install --unlink` to replace a linked install with the published package

```
  jspm install --unlink github:my/repo@dev
```

This will then replace the symlinked package with an installed version from the original repo on GitHub, undoing the linking operation.