import { jspm } from '../test.js';
import { strictEqual, deepStrictEqual } from 'assert';

const { code, stdout, stderr } = await jspm(['link', './sandbox.js', '-so'], import.meta.url);
strictEqual(code, 0);
strictEqual(stderr, '');
deepStrictEqual(stdout, `<script type="systemjs-importmap">
{
  "imports": {
    "buffer": "https://ga.system.jspm.io/npm:buffer@5.6.0/index.js",
    "codemirror": "https://ga.system.jspm.io/npm:codemirror@5.56.0/lib/codemirror.js",
    "codemirror/mode/javascript/javascript.js": "https://ga.system.jspm.io/npm:codemirror@5.56.0/mode/javascript/javascript.js",
    "lit-html": "https://ga.system.jspm.io/npm:lit-html@1.2.1/lit-html.js",
    "lit-html/directives/unsafe-html.js": "https://ga.system.jspm.io/npm:lit-html@1.2.1/directives/unsafe-html.js",
    "util": "https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/util.js",
    "zlib": "https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/zlib.js"
  },
  "scopes": {
    "https://ga.system.jspm.io/": {
      "base64-js": "https://ga.system.jspm.io/npm:base64-js@1.3.1/index.js",
      "ieee754": "https://ga.system.jspm.io/npm:ieee754@1.1.13/index.js"
    }
  }
}
</script>
<script src="sandbox.js" jspm-link></script>
`);
