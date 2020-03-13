import { html, render } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import CodeMirror from 'codemirror';
import util from 'util';
import { Buffer } from 'buffer';
import 'codemirror/mode/javascript/javascript.js';
import zlib from 'zlib';

// Disabled: No dynamic import() support in jshint!?
// import jshint from 'jshint';
// import 'codemirror/addon/lint/lint.js';
// import 'codemirror/addon/lint/javascript-lint.js';
// window.JSHINT = jshint.JSHINT;

const examples = {
  Babel: '#H4sIAAAAAAAAA4VSTWsCMRC976+YSmFbqZtjQVcRitBDC4LeSsFsMmpkNwlJdusi+9+bDyv05CEw82bem5dJyDiDMZysbmBDJa/U2ecB2h6FBZsgwDOy1qGF1QYaxdvah52g09AYTvnAFXO9Rji6pl5EyDIjtIOAzkeJNIoVgKIoXJBHLpwywBRHD0UWSbQkUSneXyklFx0IPh8xJR0VEs1oURIP/tUZlR21qSWGoZ6iJEZuauGsTsi8uSPe7lj1YEWj6x5aK+QBosMfQ7VGE7yRLPNlZRxUtMIa9kY1kB+d03ZKCMeuCFsshCLL2ECYMrh8zWf/aOu6PQi5NkorS+u3mlobEjRO+J3e1dSRPtFX/oQFgZgmhTgv8zuyDi5xsTDAPI0unKHS7pVpnnYZQKTCGi4+vmZXJ71n5B2tW8x9bch2L7EpzbZT+Lp/k+9sePZG/K9oG5SuCLsvhPTP9r79/PD6u1IbXDxegsWhJCHZzbJfV7knuo4CAAA=',
  Babylon: '#H4sIAAAAAAAAA4VSWY/TMBB+z68Y+hJ3FZyWFYu021bQqrBI5RBdIcGbGw+Nq8SObCfd8Ovx0WMpIKREcb5rZmznVwlcwc40NayZ5Bv16P499FAKAyZCgI9YtBYNLNdQK95WbtkJduuF/p0846qwfYNQ2rqaBcgUWjQWPDodRNMgMACUUuvjkQurNBSKo4OCK4+2GLFRvD9YJlx0IPh0UChpmZCoB7NJ7sAjXzDZMRMlYen5uIph+SnNv8sdFq65Ek8zbnpojZBbCK3tNWsa1L6pPElE3ShtYf5m/m316SP80KqGtLS2Mbd5zrGjfgOpUPmGbfpKyZ15fZ3eJYlr1lg4tDYFt0ltjdLSLdplhX45799zkkZFOrw7OFBu3YjOIXF/rEqXASRRm4HVLQ5PNUyBfxjWHiMxa/ikmxo1+6yMsELJC8tXtytKX5NRBi8zeD4enVqKtgv5W424CISfwX/HaXZRIYu9+aCAU4P2gWm3BeSiKv2OWpHhWcmsZUW5cCeuVfWPwSuxLe3/pxlncJ4leC6091gL05SoRbHyNEmDys/zW4nzOAGmQlqUjupd3oi+Oh+Iz/IncizwAU1JFxqZxXXgSBo1vsT4JoMX5+hI0OZQk/rw8bH7rVat5H9Pfhc4kkaNT74Jz5PsJF4Iqlv5BSVHvVKqIWQI01nUUB3gcBB7IbnaU8b5snO3dSWMm9ZxqUYjfqLLj8ZjZkCd7xffqnkvVwQAAA==',
  'lit-html': '#H4sIAAAAAAAAA0VRy27CMBC85yu2USUeovEdkpyK1HPhAzD20hjFD9mbQIT498ZxSQ+W1jO745k1W2ewhmtwGg7cyLO9j/cIHRsVICQI8I6iIwywP4C2smvHsld8GxvjKd+kFTQ4hIZ0W09QEF45gohWeRrKJwagKAqK8igVWQ/CShyhaYqlsSRxtnL4Gyml6kHJKhfWEFcGfV6XbARfvOCm5yG1TGXkU5XE2KwWz/6KYjTX4JzxPEAXlPmBydrNc+fQR1Msy5R21hM8YroNeDQS/RMu3mpYNEQubBmT2Bdxj4WyrFX0EXsXuyxjDD7xMjoGDoTatZwQLp0RpKzJxjiBQA/HF1PB0nCNK6jqaZmn0tVf2LYW3h+ReJbM1aek+z0ZmVLMyjdFDQSrESQnniWvy/8HlovZ3GoD47d1Gg0VcTmrXfYLR09mNA8CAAA=',
  'Material UI': '#H4sIAAAAAAAAA5VTsW7bMBDd9RVXL7IDW0o7dHBsI03ioUPaIPZWdKDFi8VEFAnypFoo+u85io6NBHWLDITId/fevTtS+VkCZ/DorYaVqOXG7PgcoHWpPPgIAe6waAg9LFegjWwq3rZKTENiWLMP0hTUWYSSdLXoIV84ZQkCOh9E0qCPAGRZRkEepSLjoDASGepZeaRFiY2R3Z4yk6oFJeeDwtQkVI1usJjlDL7EC1G3wseUfhvicRfF8oNaWMtHLNhciYceNx00XtVb6K39csJadMFUniRKW+MI7lEw6cEZDWlJZP00zyW2WRhfpkzuQvzy4+f04hXj5vvt/0gTafQr4m2j1iVqvHOmVRLdPwS0IHRKVJNGXZ5nn85zTx1fUP5W4ij+xdor8S7JyDgq3HDCnSqe3mfsyGKlhG/S915gDsMRzBfwI4E4sazgqRAuK7Zf0zBWzyQ+iKaiMfzmPIAn7KaQkqIKN+xt3IP9keF1+O4xxZWuK+H9N6HxXm1L4gTdKH6zfhKCk1q0aitI8RZ3lh/ERBuHKbP/jMYnTB2b+bsxyXEbm402SlXTGneh+HXFASADK6zCOxT9QGO95CfP5uXdZA5rvrrhCQ9vr/jopG6qKpY9MdCYMuKUvkOeRRNC2RZpn3XVfZXD9PC/paNkdPEMumIlDi8EAAA=',
  Tensorflow: '#H4sIAAAAAAAAA21TTU/cMBC951dM97JZFDksBVUKLOKC2kOrVsr2hDh44wlrlNjGniybIv57xzFLF6mHRM58PL/3ZlKeZHACj8H1UEujNnbP3zG03uoAIYUA99gMhAFua+itGjo+7rSsYmF8rj4p29DoELbUd9dTKDReO4IYXc1S02zKAAghKMKj0mQ9NFYhh6auMrUliI1V41vLldI70Go1a6whqQ362fVVycFDvpFmJ0MqmY4xn04JrHxHi8/tIzZMbovvGjcjDEGbB5ioPXvpHPpIqswy3TvrubyF1tse5lsiF6qyVLgT0TuhbXlDaIL1bWefS2ofw82pWJ6K0/llljHnQNE47GDFKCLg04CGtOzyxWU2JYRUKudUJ0f0QSgGw/xlMJpCBcsCtHED1VvpsIK75f3rghuzsoRfHp30OElJN7RsKXn2iMVUUDtsdDtO+c6GACx3+rCOdK//RI2JQGN7pzu+NJZVMO9RmvppYHB167318+JfD6fDg5q/vpH4ijwQSWym7fk1Gr6AdANKkvzAR7x5sQ/JiOTZmcrvWOJZAZ8LOL8v4O68gOU9g6fq8X/VXHpRwJfj6khlHW86cuMwU5zIHLS2mvJ9KBh5wauIJs8XsLqGlwyAMX6HYz/JgrLsf4seTcPGGZBJmbPa0FHlVgYzJwiIBjbIurFKgD8dJk4bb58DeuDFIWu7EMG5PA1kIB4xN/C/NPS8HiJurNCGvf22/vGdPUjkHU9EN5R/cOQiGrGcjGBJtibPuuN28Yz+AvJQmC/lAwAA',
  'Vue.js': '#H4sIAAAAAAAAAz1QsW7DIBTc+YoXd3AbVWZ3bG+RMrRTos4h8BoT2YAAO7Ei/3vBNB5Ax92744BuCWzh5kwPR6bERT/COVKnVjpwiQJ8IB88Otgfoddi6AIcJSvjYFzVRmjuJ4PQ+r5rFspxK42HyNZZMmWLAlAUhY/xKKTXFrgWGKjFRZMtRVy0mP4tlZAjSFFnXCvPpEKbNRUN5EvnTI3MpZEFRj2hFEbXtLj2N+ShXIvrGy8TDE6qKyzV7pYZgzaWooTI3mjr4WdA+LW6h7z13riSUoFjET+vkJqOA4ZCzkeQ7whZmxZShf1w+v6CGs6VaZ5P6NE5dkWY54qa5hzGFd7jBe9PAoBdCfnbGpB/Bk4wz0qIKrzcYeiAXaejL9TY5EGcyfyx+wP6CeLh1gEAAA=='
};

const sandboxTpl = () => html`
<style>
  .editor {
    position: absolute;
    top: 3.5em;
    left: 0;
    width: 50%;
    height: calc(100% - 3.5em);
  }
  .codemirror {
    height: 100%;
  }
  .CodeMirror {
    background: transparent;
    height: 100%;
  }
  .editor-bar {
    width: 0;
    height: 3em;
    position: absolute;
    top: 0;
    left: 50%;
    z-index: 12;
  }
  .editor-bar .inner {
    width: 12em;
    margin-left: -6em;
    margin-top: 1.2em;
  }
  .editor-bar select {
    float: left;
    width: 8em;
  }
  .editor-bar button {
    float: right;
    padding-left: 1em;
    margin-top: 0.05em;
    z-index: 13;
    cursor: pointer;
    color: #666;
    text-shadow: 1px 1px #efefef;
    background: transparent;
    border: none;
    outline: none;
  }
  .editor-bar button:hover {
    color: #222;
    text-shadow-color: #fff;
  }
  .editor-bar button[disabled] {
    cursor: wait;
    color: #aaa;
  }
  .output {
    position: absolute;
    top: 3.5em;
    right: 0;
    width: 50%;
    height: calc(100% - 3.5em);
    border-left: 1px solid #eee;
  }
  .output .log {
    font-size: 1em;
    background-color: #444;
    color: #eee;
    overflow-y: scroll;
    height: 30%;
  }
  .output .log .item {
    border-bottom: 1px solid #777;
    padding-bottom: 0.5em;
    padding: 0.5em 2em;
    margin: 0;
    white-space: pre-wrap;
  }
  @media screen and (max-width: 850px), screen and (max-device-width: 850px) {
    .editor {
      width: 100%;
    }
    .output {
      left: 0;
      top: calc(3.5em + 50%);
      height: calc(50% - 3.5em);
      width: 100%;
    }
    .topbar ul.toplinks {
      display: none;
    }
    .editor-bar {
      left: 70%;
    }
  }
</style>
<div class="editor-bar">
  <div class="inner">
    <select class="examples">
      <option value="">Examples</option>
      ${unsafeHTML(Object.entries(examples).map(([name, url]) => `<option value="${url}">${name}</option>`).join(''))}
    </select>
    <button class="run">&#9654;&nbsp;Run</button>
  </div>
</div>
<div class="editor">
  <div style="width: 100%; height: 100%;">
    <div class="codemirror"></div>
  </div>
</div>
<div class="output">
  <div style="position: absolute; width: 100%; height: 100%; z-index: 11;">
    <div class="browser-wrapper" style="width:100%; height: 70%; background-color:#fff"></div>
    <div class="log"></div>
  </div>
</div>
`;

let editor, sandbox, curHash, curJs;
function initSandbox (contents) {
  if (!contents) {
    const hash = location.hash.slice(1);
    if (hash) {
      curHash = hash;
      try {
        contents = hashToSource(hash);
      }
      catch (e) {
        console.error(e);
        contents = hashToSource(examples.Babel);
      }
    }
    else {
      contents = hashToSource(examples.Babel);
    }
  }
  sandbox = document.createElement('div');
  sandbox.className = 'sandbox';
  render(sandboxTpl(), sandbox);
  
  const container = document.body.querySelector('.container');
  container.appendChild(sandbox);

  editor = CodeMirror(sandbox.querySelector('.codemirror'), {
    lineNumbers: true,
    value: contents,
    mode: "javascript",
    // gutters: ["CodeMirror-lint-markers"],
    // lint: {
    //  esversion: '8'
    // }
    scrollbarStyle: 'null',
    tabSize: 2,
  });

  const browserWrapper = sandbox.querySelector('.browser-wrapper');
  const logWrapper = sandbox.querySelector('.log');

  window.addEventListener('popstate', function () {
    const hash = location.hash.slice(1);
    if (hash && hash !== curHash) {
      editor.setValue(curJs = hashToSource(hash));
      curHash = hash;
    }
  });

  let selectChange = false;
  editor.on('change', () => {
    if (!selectChange)
      select.value = '';
  });

  function run () {
    let loading = true;
    button.disabled = true;

    const script = document.createElement('script');
    script.type = 'module';
    const js = editor.getValue();

    if (curJs !== js) {
      curHash = '#' + zlib.gzipSync(new Buffer(js)).toString('base64');
      if (location.hash !== curHash) {
        window.history.pushState(null, document.title, curHash);
      }
    }
    curJs = js;

    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, {
      margin: '0',
      padding: '0',
      borderStyle: 'none',
      height: '100%',
      width: '100%',
      marginBottom: '-5px', // no idea, but it works
      overflow: 'scroll'
    });
    const blobUrl = URL.createObjectURL(new Blob([
`<!doctype html><style>body{cursor:wait}</style><script type="module">window.parent.jspmSandboxStarted();${js.replace(/<\/script>/g, '&lt;\/script>')/*UNSAFE!!*/}
</script>
<script type="module">
window.parent.jspmSandboxFinished();
</script>
<script>
window.onerror = function (msg, source, line, col, err) {
  window.parent.jspmSandboxError(msg, source, line, col, err);
};
window.console = window.parent.jspmConsole;
</script>
<body style="margin: 0; padding: 0; height: 100%; background-color: #fff">
  <canvas id="canvas" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" touch-action="none"></canvas>
  <div id="container"></div>
</body>
`], { type: 'text/html' }));
    iframe.src = blobUrl;
    browserWrapper.innerHTML = '';
    browserWrapper.appendChild(iframe);

    let started = false;
    window.jspmSandboxStarted = function () {
      started = true;
    };
    window.jspmSandboxFinished = function () {
      if (!started) {
        if (loading) {
          jspmLog('Network error loading modules. Check the browser network panel.');
          loading = false;
          button.disabled = false;
          iframe.contentDocument.body.style.cursor = 'default';
        }
      }
      else {
        loading = false;
        button.disabled = false;
        iframe.contentDocument.body.style.cursor = 'default';
      }
    };
    window.jspmSandboxError = function (msg, source, line, col, err) {
      if (loading) {
        loading = false;
        button.disabled = false;
        iframe.contentDocument.body.style.cursor = 'default';
      }
      let parts = err.stack.split(blobUrl);
      if (parts.length === 1) {
        if (line === 1) col = col - 72;
        parts = [`${msg} sandbox:${line}:${col}`];
      }
      jspmLog(parts.join('sandbox'), { color: 'red' });
    };
    // TODO: support the rest of the console API
    window.jspmConsole = Object.assign(Object.create(null), logWrapper, {
      log (arg) {
        let content = '';
        for (let i = 0; i < arguments.length; i++) {
          content += util.inspect(arguments[i], { depth: 0 }) + (i < arguments.length - 1 ? ' ' : '');
        }
        jspmLog(content.replace(/\\n/g, '\n'));
        window.console.log.apply(logWrapper, arguments);
      },
      error (err) {
        let parts = (err && err.stack || err.toString()).split(blobUrl);
        jspmLog(parts.join('sandbox'), { color: 'red' });
      }
    });
    function jspmLog (content, style) {
      const newItem = document.createElement('pre');
      if (style)
        Object.assign(newItem.style, style);
      newItem.className = 'item';
      newItem.innerHTML = content;
      logWrapper.appendChild(newItem);
      logWrapper.scrollTop = logWrapper.scrollHeight;
    }
  }

  const button = sandbox.querySelector('button.run');
  button.addEventListener('click', run);
  window.jspmLog = function (content) {
    logWrapper.innerHTML += '<pre class="item">' + content.replace(/</g, '&lt;') + '</pre>';
  };

  const select = document.body.querySelector('select.examples');
  select.addEventListener('change', () => {
    selectChange = true;
    editor.setValue(hashToSource(select.value.slice(1)));
    selectChange = false;
  });

  if (curHash)
    run();
}

function hashToSource (hash) {
  return zlib.gunzipSync(new Buffer(hash, 'base64')).toString('utf8');
}

initSandbox();
