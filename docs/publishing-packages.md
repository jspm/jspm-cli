Code published for jspm can fall into three main scenarios:

* [Writing a library for consumption in jspm and other environments](#writing-a-library-for-consumption-in-jspm-and-other-environments)
* [Publishing jspm-style packages to npm](#publishing-es6-to-npm)
* [Writing a library or application for usage just with jspm](#writing-a-library-or-application-for-usage-just-with-jspm)

Each of these scenarios has pro's and con's and the one that we feel you should focus most on is the third one.

## Writing a library for consumption in jspm and other environments

This is the common case if you're writing a piece of utility code that you want to be available to as many users as possible.

Currently the best option for this scenario is to write a package in the npm-style with npm-style dependencies and **publish that package to npm**. You can then test against the jspm environment and if necessary add any custom [jspm config properties](https://github.com/jspm/registry/wiki/Configuring-Packages-for-jspm) that may be needed to make it work in jspm, but the primary environment and publishing target is npm.

## Publishing jspm-style packages to npm

> This approach is not recommended, use the [Writing a library or application for usage just with jspm](#writing-a-library-or-application-for-usage-just-with-jspm) scenario instead.

If you really want to use npm for jspm-style code, set the `jspmNodeConversion` property to false in the package.json. This will disable the usual operations that attempt to convert from Node and npm style code into jspm-compatible code:

```json
{
  "jspmNodeConversion": false,
  "jspm": {
    "format": "es6",
    "dependencies": {
    }
  }
}
```

Then you can publish ES6 (or use other formats too) and jspm-style dependencies in your package.json fine on npm. You can choose to wrap the above with a `jspm` property as you wish.

## Writing a library or application for usage just with jspm

In this scenario, you're writing a library or application that is specifically taking advantage of jspm features such as:

* Using jspm plugins
* Supporting multi-format module loading
* Supporting dependencies from multiple registries
* Lazy-loading with `System.import`
* Building on top of jspm API features

For this workflow, it is advisable to publish your code to GitHub, and tagging semver versions for install:

```
  git tag v0.1.0
  git push origin v0.1.0
```

With the above, you can publish ES6 directly (not recommended until uglify supports ES6), or any other module format, and take advantage of all jspm features.

That is all you need to do to make your package installable by anyone with `jspm install github:user/repo@0.1.0`.

> Note that the `v` prefix in the version tag is optional.

It is advisable to ensure the following package.json properties are set when publishing jspm packages to GitHub:

* `format`: The module format you've written your package in - `esm`, `amd`, `cjs` or `global`.
* `directories.lib`: A subdirectory to install your package from, all other directories and files are then ignored and paths are relative to this folder.
* `main`: The main entry point for your package. If using a `directories.lib` the main is relative to this folder.
* `registry`: Typically set this to `jspm` as the registry you have written your package for.
* `jspm.dependencies`: jspm-style dependencies for your project.

Further information about package.json configuration can be [read at the configuration guide](https://github.com/jspm/registry/wiki/Configuring-Packages-for-jspm).

#### Example Publishing Workflow

Say I want to create an ES6 package that uses the CSS and JSX plugins to export a React component:

```
jspm init -y
jspm install css jsx react@0.13.0-beta.1
```

By default the `lib` folder is the folder that is set as `directories.lib` and is what users will be requiring from.

So edit `lib/index.jsx`:

```javascript
import './style.css!';
import React from 'react';
export default class Component extends React.component {
  render() {
    return <div>Hello {this.props.name}</div>;
  }
}
```

We can test this package locally in the browser with `System.import('app/index.jsx!')`.

Then to publish set the package.json `main` to `index.jsx!`, and the package.json `format` to `es6`.

Because this package will only be available for jspm users, we can also write all the properties at the base-level and add a `registry: jspm` property instead. This gives us:

```json
{
  "directories": {
    "lib": "lib"
  },
  "main": "index.jsx!",
  "format": "es6",
  "registry": "jspm",
  "dependencies": {
    "css": "^0.1.0",
    "jsx": "^0.1.1",
    "react": "0.13.0-beta.1"
  }
}
```

Publishing this package under a `v0.1.0` version tag to GitHub then allows users to easily load this component with:

```
  jspm install react-component=github:my/react-component@0.1.0

ok   Installed react-component as github:my/react-component@0.1.0 (0.1.0)
```

```javascript
  import reactComponent from 'react-component';
```

Sub-requires can also be made from inside the package if we wanted other modules in the `lib` folder to be available to users:

```javascript
  import AnotherComponent from 'react-component/another-component.jsx!';
```
