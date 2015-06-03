* [Using Plugins](#using-plugins)
* [CSS](#css)
* [Compiler Plugins](#compiler-plugins)
* [Resource Plugins](#resource-plugins)

### Using Plugins

[SystemJS plugins](https://github.com/systemjs/systemjs#plugins) are installed like any other dependency in jspm, 
[and can be found listed at the top of the jspm registry](https://github.com/jspm/registry/blob/master/registry.json#L2).

Plugins are installed by name:

```
  jspm install css
```

To use a plugin, add a `!` to the end of a require:

```javascript
import './some/style.css!';
```

The plugin name is taken from the extension name. You can also add any plugin name after the `!` to load with a different plugin than the extension name:

```
  jspm install json
```

```javascript
import config from './config-service!json';
```

Plugins can also be used in dynamic imports - `System.import('component.jsx!')`;

> Plugins should always be declared as dependencies of the package they are used in - they are contextual modules just like any other dependency.

### CSS

CSS is supported in jspm through the `css` plugin:

```
  jspm install css
```

CSS can then be declared as a dependency in the tree:

```javascript
import './component.css!';
```

CSS should always be a dependency in your package.json if sharing a package that has CSS plugin requires of this form.

#### CSS Builds

The CSS plugin will inline and combine CSS requires into the bundle output when using `jspm bundle`. The following options can be added to the jspm `config.js` file to alter this behaviour further:

* `buildCSS: false` add this option to opt-out of CSS inlining, and instead have the CSS loaded as separate files in production.
* `separateCSS: true` add this option to create a `bundle.js` AND a `bundle.css` file which can be included with a separate link tag.

If using CSS imports, it is advisable to follow [modular CSS best practises](https://github.com/systemjs/plugin-css#modular-css-concepts).

Read more at the CSS plugin project page - https://github.com/systemjs/plugin-css.

### Compiler Plugins

Compiler plugins are plugins like [jsx](https://github.com/floatdrop/plugin-jsx) (as well as json and text) allow you to load other languages into JavaScript. These provide implementations of the `translate` hook, which makes them **buildable**.

That is, when using `jspm bundle` compilations will be inline automatically, and the plugin itself will not be used in production. When in development, the plugin can optionally support in-browser compilation.

> Separate file production of compiler plugins using pre-compilation is not currently supported, although this is a feature that is planned for implementation in future. For now only use compiler plugins if you're using jspm bundling.

### Resource Plugins

These are plugins that are used to load production resources. For example, using the CSS plugin with builds disabled or the [image](https://github.com/systemjs/plugin-image) plugin. The plugin does not build at all, and runs in production.