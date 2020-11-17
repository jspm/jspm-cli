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

### CLI Build

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

### API Build

```
npm run build-api
```

creates a `dist/api.js` file that can be imported to get the programattic API, with dependencies externalized.

This can then be installed with the jspm CLI for the browser via:

```js
jspm install jspm=./dist/api.js
```

(will give warnings as it's not got proper dependency declarations yet)

#### API Example

Here's an install API example:

```js
import { utils, TraceMap } from 'jspm';

(async () => {

  const inSource = `
  <!doctype html>
  <script type="importmap">
  {}
  </script>
  `;

  const scripts = utils.readHtmlScripts(inSource);
  const mapStr = inSource.slice(scripts.map[0], scripts.map[1]);
  const mapJson = JSON.parse(mapStr);

  const traceMap = new TraceMap(utils.baseUrl, mapJson);
  const opts = {
    system: false,
    clean: true
  };
  await traceMap.add('react', opts);

  const newMapStr = '\n' + traceMap.toString();
  const outSource = inSource.slice(0, scripts.map[0]) + newMapStr + inSource.slice(scripts.map[1]);
  console.log(outSource);
})();

```

## Tests

```
npm run test
```

Tests require Node.js 14+.

### License

Apache-2.0
