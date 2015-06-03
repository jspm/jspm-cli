* [Install Variations](#install-variations)
* [Requiring Packages](#requiring-packages)
* [Reproducible Installs](#reproducible-installs)
* [Updating Packages](#updating-packages)
* [Inspecting Dependencies](#inspecting-dependencies)
* [Resolving Conflicts](#resolving-conflicts)
* [Uninstalling and Cleaning](#uninstalling-and-cleaning)
* [Other Options](#other-options)
* [Resolution Algorithm](#resolution-algorithm)

### Install Variations

#### Naming

Install aliases from the [jspm registry](https://github.com/jspm/registry/blob/master/registry.json):

```
  jspm install jquery
```

This is equivalent to writing:

```
  jspm install jquery=github:components/jquery
```

(`jspm install github:components/jquery` will install into the name `components/jquery` by default otherwise).

Multiple installs can be performed by separating installs with a space:

```
  jspm install jquery bootstrap
```

Install from npm:

```
  jspm install npm:immstruct
```

installs `immstruct`.

When installing from npm, various build operations are applied to convert Node-style requires into jspm-compatible requires. Sometimes this will break, in which case [please post an issue](https://github.com/jspm/npm/issues).

[Read more about configuring installed packages for jspm here](https://github.com/jspm/registry/wiki/Configuring-Packages-for-jspm).

#### Versioning

Install exact versions of packages by specifying the version in the install command:

```
  jspm install jquery@2.1.0
```

This can equally be written:

```
  jspm install jquery=2.1.0
```

Any version tag or branch can be installed this way for GitHub and npm. Commit-based installs are not supported for the GitHub registry currently.

Install a version range with - 

[Semver compatibility range](https://github.com/npm/node-semver#caret-ranges-123-025-004):

```
  jspm install jquery@^2.1.0
```

[Tilde compatibility range](https://github.com/npm/node-semver#tilde-ranges-123-12-1):

```
  jspm install jquery@~2.1.0
```

Arbitrary ranges `x`, `x.y`:

```
  jspm install jquery@2
```

These are the only allowed forms. A literal `x` in ranges and arbitrary version ranges (`>`) are not supported by jspm.

### Requiring Packages

Once installed, you can require the package directly by the exact name you installed it into:

```
  jspm install github:components/jquery
```

```
  require('components/jquery');
  require('components/jquery/submodule.js'); // corresponds to /submodule.js in the package path
```

Alternatively, we could have aliased jquery on install:

```
  jspm install jquery=github:components/jquery
```

```
  require('jquery');
  require('jquery/submodule.js');
```

It is possible to use any names for dependencies in jspm without conflict because each package (including your own code) is given its own completely unique namespace for referring to dependencies. `jquery` can refer to a completely different thing in your own code that a third-party dependency may expect from a `require('jquery')` in its own code.

The way this is handled is through [SystemJS contextual map config](https://github.com/systemjs/systemjs/wiki/Map-Configuration), which forms the bulk of the configuration file.

> Note everything you import must be directly installed by name into your application. Even if you load a package which depends on jQuery, you still need to install jQuery manually if you want to be able to require it in your own code.

### Reproducible Installs

All install ranges are saved in the `package.json` file, with the exact version solution saved in to `config.js`. Both of these files should be checked into version control.

To reproduce an install of the `package.json` to the exact version ranges in the `config.js` file, use `jspm install` with no arguments:

```
  jspm install
```

### Updating Packages

To update all installed packages within their version ranges use:

```
  jspm update
```

To update a specific package only:

```
  jspm update jquery
```

### Inspecting Dependencies

To inspect all installed dependencies use `jspm inspect`:

```
  jspm inspect
  Installed Versions

        github:components/jquery 2.1.3
         github:jspm/nodelibs-fs 0.1.1
    github:jspm/nodelibs-process 0.1.1
       github:jspm/nodelibs-util 0.1.0
     github:systemjs/plugin-json 0.1.0
               npm:eventemitter3 0.1.6
                   npm:immstruct 1.3.1
                   npm:immutable 3.6.2
                    npm:inherits 2.0.1
                     npm:process 0.10.0
                        npm:util 0.10.3
     
  To inspect individual package constraints, use jspm inspect registry:name.
```

You can inspect just forks with `jspm inspect --forks` or `jspm inspect -f`

To see the install constraints for a given dependency use `jspm inspect registry:name`:

```
  jspm inspect npm:util
     
  Installed versions of npm:util
     
    github:jspm/nodelibs-util@0.1.0
      util 0.10.3 (^0.10.3)
```

This shows us all parent dependencies, and the version range they have installed the sub-dependency to.

### Resolving Conflicts

It is fine to change dependency versions of dependencies within the `config.js` file manually to alter resolutions.

If there is a scenario where you want all versions of a package to resolve to exactly a given version, you can use `resolve --only`:

```
  jspm resolve --only registry:package@version
```

This will ensure that the version solution given is used in all constraints, regardless of whether those constraints are broken.

Be very careful using this, as once a version constraint has been broken, say using `jquery@2.1.1` in a range accepting `jquery@^1`, jspm will no longer alter that dependency and consider it manually overridden.

### Uninstalling and Cleaning

To uninstall a package:

```
  jspm uninstall jquery
       Clearing configuration for github:components/jquery@2.1.3
       Removing package files for github:components/jquery@2.1.3
  
  ok   Uninstall complete.
```

The package will be removed from the package.json and the package files will also be removed so long as there are no other packages depending on them.

Run `jspm clean` at any time to perform this same clearing operation.

### Other Options

Use `-o` or `--override` to force-set the package override for a package that needs extra configuration. See https://github.com/jspm/registry#testing-package-overrides.

Use `-f` or `--force` with the install command to ensure the cache is completely refreshed for all installs. Usually this is unnecessary but can be useful if you've made manual edits or have patched registry endpoint code.

### Resolution Algorithm

jspm's version resolution algorithm considers every installation process as a tree operation on an existing install tree being merged with a new install tree.

When doing a new install the primary dependency being installed (the dependency stored in the package.json) is always installed to its latest version. Any other forks of this package in the existing are always tested for upgrades to this version if possible. This is done to ensure that the code you develop is using dependency versions free of bugs. There is no back-tracking constraint-solving here because ironing out bugs is the primary requirement.

Back-tracking does still come into play when looking at sub-dependencies, which are allowed to back-track to minimize forks. If a published package bug fix had needed to push out a bug fix patch for a dependency, it should have bumped its dependency range, so it is assumed that sub-dependencies can be pushed back to their lowest versions so far as is needed within constraint solving.

In this way, these resolution solutions are all handled greedily on a case-by-case basis within these trees by the install algorithm.

If the install causes an existing dependency to break because of new resolutions, you can revert and install with `jspm install --lock newpackage`. This will then not alter any of the existing resolutions in the tree at all, only performing deduping in the new tree.

For further interest, the code for the resolution algorithm can be found in https://github.com/jspm/jspm-cli/blob/master/lib/install.js#L71.