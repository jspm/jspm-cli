import { jspm, looseEqual } from '../test.js';
import { strictEqual } from 'assert';

const { code, stdout, stderr } = await jspm(['preload', './sandbox.js'], import.meta.url);
strictEqual(code, 0);
strictEqual(stderr, '');
looseEqual(stdout, `<script src="https://ga.system.jspm.io/npm:lit-html@1.2.1/lib/directive.js"></script>
<script src="https://ga.system.jspm.io/npm:lit-html@1.2.1/lib/dom.js"></script>
<script src="https://ga.system.jspm.io/npm:lit-html@1.2.1/lib/part.js"></script>
<script src="https://ga.system.jspm.io/npm:lit-html@1.2.1/lib/template.js"></script>
<script src="https://ga.system.jspm.io/npm:lit-html@1.2.1/_/75a6e768.js"></script>
<script src="https://ga.system.jspm.io/npm:lit-html@1.2.1/lib/template-factory.js"></script>
<script src="https://ga.system.jspm.io/npm:lit-html@1.2.1/lib/render.js"></script>
<script src="https://ga.system.jspm.io/npm:lit-html@1.2.1/lit-html.js"></script>
<script src="https://ga.system.jspm.io/npm:lit-html@1.2.1/directives/unsafe-html.js"></script>
<script src="https://ga.system.jspm.io/npm:codemirror@5.56.0/lib/codemirror.js"></script>
<script src="https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/_/e00d42bc.js"></script>
<script src="https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/_/0859a6e8.js"></script>
<script src="https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/util.js"></script>
<script src="https://ga.system.jspm.io/npm:base64-js@1.3.1/index.js"></script>
<script src="https://ga.system.jspm.io/npm:ieee754@1.1.13/index.js"></script>
<script src="https://ga.system.jspm.io/npm:buffer@5.6.0/index.js"></script>
<script src="https://ga.system.jspm.io/npm:codemirror@5.56.0/mode/javascript/javascript.js"></script>
<script src="https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/assert.js"></script>
<script src="https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/buffer.js"></script>
<script src="https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/_/0440de41.js"></script>
<script src="https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/events.js"></script>
<script src="https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/_/95a9034e.js"></script>
<script src="https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/stream.js"></script>
<script src="https://ga.system.jspm.io/npm:@jspm/core@2.0.0-beta.7/nodelibs/zlib.js"></script>
<script src="*/sandbox.js"></script>
`);
