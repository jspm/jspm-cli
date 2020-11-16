import { jspm } from '../test.js';
import { strictEqual, deepStrictEqual } from 'assert';

const { code, stdout, stderr } = await jspm(['link', './sandbox.js', '-so'], import.meta.url);
strictEqual(stderr, '');
strictEqual(code, 0);
deepStrictEqual(stdout, `<script type="systemjs-importmap">
{
  "imports": {
    "codemirror": "https://ga.system.jspm.io/npm:codemirror@5.56.0/lib/codemirror.js",
    "codemirror/mode/javascript/javascript.js": "https://ga.system.jspm.io/npm:codemirror@5.56.0/mode/javascript/javascript.js",
    "lit-html": "https://ga.system.jspm.io/npm:lit-html@1.2.1/lit-html.js",
    "lit-html/directives/unsafe-html.js": "https://ga.system.jspm.io/npm:lit-html@1.2.1/directives/unsafe-html.js"
  },
  "scopes": {
    "../": {
      "buffer": "https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/buffer.js",
      "util": "https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/util.js",
      "zlib": "https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/zlib.js"
    }
  }
}
</script>
<script src="sandbox.js" jspm-link></script>

`);
