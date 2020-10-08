# jspm 3.0 CLI Release Preview

> Thank you for testing the jspm 3.0 CLI private release preview!
> NOTE: DO NOT SHARE THIS PAGE PUBLICLY

## Getting Started

This guide will follow through a very simple scenario of adding web component packages, running them in the browser, then building for SystemJS.

For build and setup instructions see the main CLI repo readme file.

### Adding Packages

To add any package from npm, use `jspm add`. This command also supports subpaths of packages.

For the example, add a web component to start:

```
jspm add @material/mwc-button
```

This will populate these packages into the file at `jspm.importmap`.

### Setting up the HTML

To run these packages in Chrome with the _Experimental Web Platform Features_ flag, first setup the boilerplate HTML page:

app.html
```html
<!doctype html>
<script type="importmap">
</script>
<script type="module">
import '@material/mwc-button';
</script>
<body>
  <mwc-button @click="${this.openDialog}" label="Click Me!" raised></mwc-button>
</body>
```

Ideally, we would use `<script type="importmap" src="jspm.importmap">` in the above, but unfortunately Chrome doesn't yet support this.

Instead we need to tell jspm to copy the importmap into our HTML page. We can do this with the `--out` flag of `jspm install`:

```
jspm install -o app.html
```

This tells jspm to copy every installed package into the `app.html` import map.

> The distinction between `jspm install` and `jspm add` is just like Yarn - `add` creates a new entry in the import map, while `install` will validate the whole existing install tree.

The `<script type="importmap">` section in the HTML file will now be populated.

### Running the app

Use any local HTTP server to run the app.

For `http-server` try:

```
npx http-server -c-1
```

> The `-c-1` flag here is important so the HTTP server doesn't cache the local files as we make changes.

Navigate to `http://localhost:8080/app.html` in the browser to see the functional web component application.

_That's the overall workflow for developing apps with modules!_

### Dynamic Import

Let's add some new packages to this application, but this time instead of copying the `jspm.importmap` we can actually add a new package directly into the page import map itself:

```
jspm add -m app.html lit-element @material/mwc-dialog
```

> The `-m` (or `--import-map`) flag tells jspm which import map to install / add into, which can be any JSON or HTML page with an import map.

Let's create our own web component in a new JS module called `app.js`:

```js
```js
import '@material/mwc-button';
import { LitElement, html } from 'lit-element';
class MyApp extends LitElement {
  static get properties() {
    return {
      dialogOpen: { type: Boolean }
    };
  }
  async openDialog () {
    await import('@material/mwc-dialog');
    this.dialogOpen = true;
  }
  render() {
    return html`
      <mwc-button @click="${this.openDialog}" label="Click Me!" raised></mwc-button>
      ${this.dialogOpen ? html`
        <mwc-dialog id="myDialog" open @closed=${() => this.dialogOpen = false}>
          <div>Discard draft?</div>
          <mwc-button slot="primaryAction" dialogAction="discard">Discard</mwc-button>
          <mwc-button slot="secondaryAction" dialogAction="cancel">Cancel</mwc-button>
        </mwc-dialog>
      ` : ''}
    `;
  }
}
customElements.define('my-app', MyApp);
```

To load and use this component, remove the previous `<script type="module">` tag and add the following to the HTML page:

```html
<script type="module" src="app.js">
<body>
  <my-app></my-app>
</body>
```

Try it out with the same HTTP server to see this in action.

Note the dynamic import `await import('@material/mwc-dialog)` loads the dialog component only when the button is pressed.

### SystemJS Conversion

To run this application in browsers that don't support import maps (most browsers), we need to convert the application into SystemJS.

To do this we need to:

1. Update the import map to reference SystemJS modules
2. Include SystemJS in the page
3. Build our local code into the SystemJS module format
4. Reference our built SystemJS code

#### 1. Switching to System Import Map

To convert the import map to run against the SystemJS CDN use the following command:

```
jspm install --system -m app.html
```

This tells jspm to install the entire import map, but to switch into the SystemJS CDN mode. The import map is used from the `app.html` file and saved back into this file.

All references to `https://ga.jspm.io` will then be converted into references to `https://system.ga.jspm.io`.

#### 2. Including SystemJS

SystemJS can be included in any way you like, but if you want to use the version from the jspm CDN, use the following command to get the script tag HTML:

```
jspm locate systemjs/s.js --system -c
```

Which outputs:

```html
<script src="https://ga.system.jspm.io/npm:systemjs@6.6.1/dist/s.min.js" integrity="sha384-fNLxbFH9hT5mhtd6OSPEPv8pEHS8nFVmSwXSbDfJLVR35y4+4bxpsYf/Ui3D0Af6" crossorigin="anonymous"></script>
```

Copy this script tag into the top of the `app.html` HTML page above the import map.

* The `--system` flag makes sure to use SystemJS from the `https://system.ga.jspm.io` CDN so we use the same CDN.
* The `-c` flag copies the result to the clipboard so we can easily paste it into the page.
* The `-f` flag can customize the output of the locate command, eg `-f style` is another option useful for locating stylesheets in packages.
* By default the script tag includes integrity. This can be disabled with `--no-integrity`.

> `s.js` is a smaller SystemJS build we are referencing here. This is available as it is in the `"exports"` field for SystemJS.
> To list the exports field for any package, you can use `jspm ls systemjs` to see what is available in the exports for a package.

#### 3. Building an Application for SystemJS

To build our local `app.js` file into SystemJS, use `jspm build`:

```
jspm build ./app.js -f system
```

This will output the built SystemJS module to `dist/app.js`.

* `-f system` tells it to build for SystemJS. Otherwise ES modules are assumed by default.
* The `./` before `./app.js` **is important to include**, otherwise it will think we are trying to build a package called `app.js`. This works just like module specifiers themselves.
* Use `--watch` or `-w` for a watched build.
* There are many other build options, see the `src/cli.ts` file for more info.

> Note that `jspm build` will do full build chunking for multiple entry points and dynamic imports.

#### 4. Referencing the SystemJS Build

Update the HTML page to refer to this SystemJS build instead of the `app.js` module from before:

```html
<script src="dist/app.js"></script>
```

Note that the script tag should not use `"type": "module"` as we are loading a SystemJS module instead.

_Loading the same page in the browser, we now have an application that will work in all older browsers via SystemJS._

### Cast Optimization

The jspm CDNs are highly optimized for production - each package is built and minified and served with far future expires, compression and HTTP/2 over Google Cloud CDN for the fast SystemJS s.js loader.

There is one optimization that we still need to implement though, and that is flattening all the dependencies to load at the same time instead of as a waterfall as they are loaded.

We can do this using the `jspm cast` optimization process.

Remove the previous `<script src="dist/app.js">` script tag. Then lets use `jspm cast` to set up the page load for us:

```
jspm cast -m app.html ./dist/app.js
```

This tells jspm that we want to load the `./dist/app.js` file in the page, and it will then automatically put all the right script tags into the page.

* Each script tag will have integrity and cross-origin attributes added automatically (these can be disabled with `--no-integrity` or `--no-crossorigin`)
* Only those scripts that load on initial page load are included
* The scripts that are loaded with dynamic import are populated in a separate `"integrity"` and `"depcache"` attributes in the SystemJS import map.
  This allows SystemJS to still avoid the dependency waterfall when clicking the button and also to continue to provide the integrity for those dynamic scripts.

`jspm cast` can be run again or with any other files. Each time it is run it will replace what was added before so you don't have to edit the HTML manually again.

If we want a smaller HTML output we can run:

```
jspm cast -m app.html ./dist/app.js -M
```

The `-M` flag tells jspm to minify the output import map, and applies to all import map altering commands.

### Next Steps

That's the very quick overview of jspm 3.0. The CLI has other features and aspects which will be fleshed out further in future guides and API documentation.

Post your questions and feedback in the **cli-beta** discussion page on Discord.

> Reminder: While this work is still unreleased, please do not share any of this publicly.