The goal of jspm is to enable an open and interoperable package management ecosystem.

Packages loaded through jspm declare the `registry` property in their package.json, indicating which registry name is responsible for that package.

This then enables jspm to know what is meant by the `dependencies` property in the package.json. A value of `"lodash": "^3.2.0"` has meaning for the npm registry, which can be very different from other registries.

In addition, edge-case dependency values can then be converted into jspm values. For example, npm installs from GitHub repos with the syntax `git+ssh://git@github.com:npm/npm.git#v1.0.27`, which can then be converted internally into the jspm-compatible `github:npm/npm@1.0.27`.

These dependency conversions are handled by the endpoint itself using the [processPackageConfig hook](https://github.com/jspm/jspm-cli/wiki/Endpoint-API#processpackageconfig-pjson-optional) of the Endpoint API.

In future the `registry` property is planned to support [automated publishing workflows](https://github.com/jspm/jspm-cli/issues/249) as well.

Some important edge cases of this registry handling are:

* Packages without any `registry` property on GitHub will have their dependencies ignored.
* Packages on GitHub that set `"registry": "npm"` will have their sources run through the npm conversion build process provided by the `build` hook of the npm registry endpoint in jspm. The same applies for linked packages.
* Packages on GitHub that want to load dependencies from GitHub can set `"registry": "github"`.
* A generic registry property, `"registry": "jspm"` allows packages simply to indicate to jspm that they are jspm-compatible. Non-canonical dependency names (eg `"jquery": "*"`) are then taken looked up in the jspm registry (through aliasing, resolves to `github:components/jquery`).

The jspm registry itself is very much a convenience to fill a gap. Over time the goal is for this service to decrease in usage towards deprecation. In this way, the only servers one relies on are the servers one chooses to rely on as a publisher or consumer.