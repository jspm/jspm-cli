# JSPM 3.0 CLI Release Preview

> Thank you for testing the JSPM 3.0 CLI private release preview!
> NOTE: DO NOT SHARE THIS PAGE PUBLICLY

This guide will follow through a very simple scenario of adding web component packages, running them in the browser, then building for SystemJS.

For build and setup instructions see the main CLI repo readme file.

## Native Development Workflow

### Adding Packages

To add any package from npm, use `jspm add`. This command also supports subpaths of packages.

For the example, add a web component to start:

```
jspm add @material/mwc-button
```

This will populate these packages into the primary manifest file at `jspm.importmap`.

### Create an Entry Point

Let's create an application entry point called `app.js`:

app.js
```js
import '@material/mwc-button';
```

Loading this dependency will register the `<mwc-button>` Web Component custom element.

### Setting up the HTML

To run this application, set up the boilerplate HTML page:

app.html
```html
<!doctype html>
<script type="importmap"></script>
<body>
  <mwc-button @click="${this.openDialog}" label="Click Me!" raised></mwc-button>
</body>
```

By adding an empty import map we create a placeholder for linking the import map into the page.

> Ideally, we would use `<script type="importmap" src="jspm.importmap">` in the above, but unfortunately Chrome doesn't yet support this.

To insert the dependency configuration into the page, run `jspm link`:

```
jspm link ./app.js -o app.html
```

> * The `./` before `./app.js` **is important to include**, otherwise it would be an external package called `app.js`. This works just like module specifiers themselves.

This tells JSPM to copy every dependency needed by `app.js` into the `app.html` import map.

### Running the App

Use any local HTTP server to run the app.

For `http-server` try:

```
npx http-server -c-1
```

> The `-c-1` flag here is important so the HTTP server doesn't cache the local files as we make changes.

In Chromium browsers, ensure the _Experimental Web Platform Features_ flag is enabled from the `chrome://flags` page.

Navigate to `http://localhost:8080/app.html` in the browser to see the functional web component application.

### Adding New Dependencies

It isn't actually necessary to run `jspm add` for every new dependency. Instead if just running `jspm link` again,
will automatically install the dependencies for us.

For example, updating `app.js` to use more dependencies:

app.js
```js
import '@material/mwc-button';
import { LitElement, html } from 'lit-element';

class MyApp extends LitElement {
  static get properties () {
    return {
      dialogOpen: { type: Boolean }
    };
  }
  async openDialog () {
    await import('@material/mwc-dialog');
    this.dialogOpen = true;
  }
  render () {
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

> Note there is a dynamic `import()` in the above which only pulls in the `mwc-dialog` component when it is used. This lazy loading approach an important best practise for optimal page loading as the dependency is not loaded at all by the user during initialization and instead only when they need it.

Updating the HTML to run as a single page Web Component:

app.html
```html
<!doctype html>
<script type="importmap"></script>
<body>
  <my-app></my-app>
</body>
```

Now we run the same single `jspm link` command to get the updated import map:

```
jspm link app.js -o app.html
```

In this way, `jspm link` can be thought of as an _"install + link"_ operation.

The new dependencies `lit-element` (and its dependencies), as well as the dynamic dependency `@material/mwc-dialog` are installed on-demand into the primary `jspm.importmap` version manifest, and the full dependency map is linked into the page.

Navigate to the local server as before to execute the application. Watch the network tab when clicking the button to see the dialog component loaded on-demand via dynamic `import()`.

### Summary

With this workflow, it is possible to prototype an application in native modules and import maps directly in Chromium browsers.

* Local modules can be edited and the page refreshed with no other build steps being necessary.
* When adding new dependencies, rerun the `jspm link` command to update the import map.
* All externally linked dependencies are cached in the browser cache with far-future expires for fast refreshing.

_That's the full native ES module dev workflow!_

## TypeScript Development Workflow

For larger applications TypeScript is often preferable for development.

This workflow demonstrates the same style of development to the above but for TypeScript modules, using SystemJS as the in-browser local application TypeScript processor, while continuing to use optimized external dependencies loads from the JSPM CDN.

### TypeScript Application Example

Renaming the `app.js` from the previous example to `app.ts`, it is just necessary to add the type of the `dialogOpen` field for TypeScript:

```js
// ...
class MyApp extends LitElement {
  dialogOpen: boolean;
// ...
```

_When importing TypeScript dependencies, always use the `.ts` extension (the TypeScript checker doesn't like this so use `// @ts-ignore` as necessary)._

Create a `tsconfig.json` file and a `deps.d.ts` file:

tsconfig.json
```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "esnext"
  }
}
```

deps.d.ts
```js
declare module 'lit-element' {
  export function html (strings: TemplateStringsArray, ...values: unknown[]): unknown
  export class LitElement extends HTMLElement {}
  export function property (options?: { attribute?: boolean|string, type?: unknown, converter?: unknown, reflect?: boolean, hasChanged?(value, oldValue): boolean, noAccessor?: boolean })
}
declare module '@material/mwc-button';
declare module '@material/mwc-dialog';
```

To load external types, use `npm install` for typing information as per standard TypeScript workflows.

> Note: JSPM does not read the `tsconfig.json` or `.d.ts` declaration files - this is only for the TypeScript checker, which does not run in the browser in SystemJS. The workflow works equivalently in SystemJS with just the `.ts` files.

### TypeScript Browser Linking

Running this TypeScript in the browser, is actually just the same as the previous workflow running `jspm link`:

```
jspm link ./app.ts -o app.html
```

When JSPM detects that we are using TypeScript it will then automatically include SystemJS and the SystemJS Babel plugin in the page,
and it will also convert the import map into a SystemJS compatible import map.

With the `npx http-server -c-1` local server or similar running, navigating the `app.html` in the browser will load the full application.

Note that by SystemJS this version of the application no longer needs the _Experimental Web Platform Features_ flag and will run in any browser.

> To make JSPM link with SystemJS you can always add the `--system` or `-s` flag to `jspm link` to apply this workflow even when not working with TypeScript.

### Summary

With only `jspm link`, SystemJS provides an in-browser development workflow for TypeScript, providing the same edit refresh workflow as native modules without any other custom steps being necessary.

_Note that this workflow is not suitable for production, and is for development only._

## Build Workflow

To build an application for ES modules browsers, use `jspm build`:

```
jspm build ./app.ts --inline --production -o test.html
```

* The `-o test.html` argument will will update the HTML for using the built sources, just like with `jspm link`.
* The `--inline` / `-i` flag will include all dependencies in the build files so that no import maps are necessary in production.
* The `--production` / `-p` flag will make sure that the production resolution variations of all dependencies are used.
* The `--watch` / `-w` flag can be added for a watched build.

Full code splitting builds are performed with RollupJS and multiple entry point arguments can be provided as well.

Note that the dynamic import code is automatically moved into its own chunk loaded on demand.

## CDN Build Workflow

As an alternative to a full build workflow, you can run a build that uses the `jspm.io` CDN in production for hosting fully optimized dependencies with the very fast the Google Cloud CDN and Cloud Storage.

The benefit of this type of build is that you can regularly deploy updates without triggering full cold refreshes for your users, since all dependency packages remain fully cached with far-future expires.

This is the build that is done when omitting the `--inline` flag:

```
jspm build ./app.ts --production -o test.html
```

In addition to linking in the build, the `--production` flag will enable the following linking optimizations (all of these also being arguments to `jspm link`):

* `--system`: Builds for the SystemJS module format and links the build with SystemJS.
* `--preload`: `<script>` tags are populated in dependency order for all static deep module loads to avoid a latency waterfall.
* `--integrity`: Includes an integrity attribute on all embedded scripts (including preloaded scripts). For scripts only loaded dynamically, populates this integrity metadata in the SystemJS import map.
* `--crossorigin`: The crossorigin attribute is added to all scripts as a formality since cross-site cookies will likely soon be disabled in all browsers anyway.
* `--depcache`: For dynamically loaded modules, the depcache field in the import map is used to populate dependency information that avoids any possible waterfall loading for chunks.

For a slightly smaller HTML output, add the `-M` flag to minify the output import map.

## Development Build Workflow

Running in-browser ES Module or TypeScript compilation with SystemJS can start to slow down the development refresh cycle as the amount of
user code increases (although dependencies don't add to this overhead as they are optimized by the CDN).

For a fast development workflow that can scale for large applications, use a watched `jspm build` for development:

```
jspm build ./app.ts -o app.html --watch
```

This is identical to the production workflow, just excluding the `--production` flag.

## Next Steps

That's the very quick overview of JSPM 3.0. The CLI has other features and aspects which will be fleshed out further in future guides and API documentation.

Post your questions and feedback in the **cli-beta** discussion page on Discord.

> Reminder: While this work is still unreleased, please do not share any of this publicly.
