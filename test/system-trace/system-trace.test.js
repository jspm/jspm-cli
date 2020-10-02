import { jspm } from '../test.js';
import { strictEqual, deepStrictEqual } from 'assert';

const { code, stdout, stderr } = await jspm(['cast', './sandbox.js', '-f', 'json'], import.meta.url);
strictEqual(code, 0);
strictEqual(stderr, '');
deepStrictEqual(JSON.parse(stdout), [
  "https://ga.system.jspm.io/npm:lit-html@1.2.1/lib/directive.js",
  "https://ga.system.jspm.io/npm:lit-html@1.2.1/lib/dom.js",
  "https://ga.system.jspm.io/npm:lit-html@1.2.1/lib/part.js",
  "https://ga.system.jspm.io/npm:lit-html@1.2.1/lib/template.js",
  "https://ga.system.jspm.io/npm:lit-html@1.2.1/_/75a6e768.js",
  "https://ga.system.jspm.io/npm:lit-html@1.2.1/lib/template-factory.js",
  "https://ga.system.jspm.io/npm:lit-html@1.2.1/lib/render.js",
  "https://ga.system.jspm.io/npm:lit-html@1.2.1/lit-html.js",
  "https://ga.system.jspm.io/npm:lit-html@1.2.1/directives/unsafe-html.js",
  "https://ga.system.jspm.io/npm:codemirror@5.56.0/lib/codemirror.js",
  "https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/_/e00d42bc.js",
  "https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/_/0859a6e8.js",
  "https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/util.js",
  "https://ga.system.jspm.io/npm:base64-js@1.3.1/index.js",
  "https://ga.system.jspm.io/npm:ieee754@1.1.13/index.js",
  "https://ga.system.jspm.io/npm:buffer@5.6.0/index.js",
  "https://ga.system.jspm.io/npm:codemirror@5.56.0/mode/javascript/javascript.js",
  "https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/assert.js",
  "https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/buffer.js",
  "https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/_/0440de41.js",
  "https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/events.js",
  "https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/_/95a9034e.js",
  "https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/stream.js",
  "https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/zlib.js",
  "sandbox.js"
]);
