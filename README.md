# jspm 3.0

ES Module Package Management

**In-Progress Pre-Release. DO NOT SHARE.**

### Getting Started

See the getting started guide at [docs/cli/guide.md](docs/cli/guide.md).

## Contributing

**Seeking contributors**

The project is still under heavy development, and the codebase reflects this in being very rough.

Simply using the project and sharing feedback is a huge help.

Bug fixes, improving test coverage and code quality or suggesting your own additions all welcome.

## Building

```
npm run build-node
```

builds `dist/index.js` which is the main CLI executable.

It is recommended to setup a symlink to this file in the PATH to get a live build running locally.

Something like:

```
ln -s ~/Projects/jspm/dist/index.js /usr/local/bin/jspm
```

For a watched build run

```
npm run watch-build-node
```

this is useful during development for faster rebuilds.

```
npm run build-browser
```

creates a `lib` folder with a version of jspm that can execute in the browser (when itself in turn installed with jspm).

## Tests

```
npm run test
```

Tests require Node.js 14+.

### License

Apache-2.0
