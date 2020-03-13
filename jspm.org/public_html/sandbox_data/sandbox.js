import{render as e,html as t}from"./lit-html.js";import{unsafeHTML as o}from"./unsafe-html.js";import n from"./codemirror.js";import r from"./util.js";import{Buffer as i}from"./buffer.js";import"./javascript.js";import s from"./zlib.js";const l={Babel:"#H4sIAAAAAAAAA4VSTWsCMRC976+YSmFbqZtjQVcRitBDC4LeSsFsMmpkNwlJdusi+9+bDyv05CEw82bem5dJyDiDMZysbmBDJa/U2ecB2h6FBZsgwDOy1qGF1QYaxdvah52g09AYTvnAFXO9Rji6pl5EyDIjtIOAzkeJNIoVgKIoXJBHLpwywBRHD0UWSbQkUSneXyklFx0IPh8xJR0VEs1oURIP/tUZlR21qSWGoZ6iJEZuauGsTsi8uSPe7lj1YEWj6x5aK+QBosMfQ7VGE7yRLPNlZRxUtMIa9kY1kB+d03ZKCMeuCFsshCLL2ECYMrh8zWf/aOu6PQi5NkorS+u3mlobEjRO+J3e1dSRPtFX/oQFgZgmhTgv8zuyDi5xsTDAPI0unKHS7pVpnnYZQKTCGi4+vmZXJ71n5B2tW8x9bch2L7EpzbZT+Lp/k+9sePZG/K9oG5SuCLsvhPTP9r79/PD6u1IbXDxegsWhJCHZzbJfV7knuo4CAAA=",Babylon:"#H4sIAAAAAAAAA4VSWY/TMBB+z68Y+hJ3FZyWFYu021bQqrBI5RBdIcGbGw+Nq8SObCfd8Ovx0WMpIKREcb5rZmznVwlcwc40NayZ5Bv16P499FAKAyZCgI9YtBYNLNdQK95WbtkJduuF/p0846qwfYNQ2rqaBcgUWjQWPDodRNMgMACUUuvjkQurNBSKo4OCK4+2GLFRvD9YJlx0IPh0UChpmZCoB7NJ7sAjXzDZMRMlYen5uIph+SnNv8sdFq65Ek8zbnpojZBbCK3tNWsa1L6pPElE3ShtYf5m/m316SP80KqGtLS2Mbd5zrGjfgOpUPmGbfpKyZ15fZ3eJYlr1lg4tDYFt0ltjdLSLdplhX45799zkkZFOrw7OFBu3YjOIXF/rEqXASRRm4HVLQ5PNUyBfxjWHiMxa/ikmxo1+6yMsELJC8tXtytKX5NRBi8zeD4enVqKtgv5W424CISfwX/HaXZRIYu9+aCAU4P2gWm3BeSiKv2OWpHhWcmsZUW5cCeuVfWPwSuxLe3/pxlncJ4leC6091gL05SoRbHyNEmDys/zW4nzOAGmQlqUjupd3oi+Oh+Iz/IncizwAU1JFxqZxXXgSBo1vsT4JoMX5+hI0OZQk/rw8bH7rVat5H9Pfhc4kkaNT74Jz5PsJF4Iqlv5BSVHvVKqIWQI01nUUB3gcBB7IbnaU8b5snO3dSWMm9ZxqUYjfqLLj8ZjZkCd7xffqnkvVwQAAA==","lit-html":"#H4sIAAAAAAAAA0VRy27CMBC85yu2USUeovEdkpyK1HPhAzD20hjFD9mbQIT498ZxSQ+W1jO745k1W2ewhmtwGg7cyLO9j/cIHRsVICQI8I6iIwywP4C2smvHsld8GxvjKd+kFTQ4hIZ0W09QEF45gohWeRrKJwagKAqK8igVWQ/CShyhaYqlsSRxtnL4Gyml6kHJKhfWEFcGfV6XbARfvOCm5yG1TGXkU5XE2KwWz/6KYjTX4JzxPEAXlPmBydrNc+fQR1Msy5R21hM8YroNeDQS/RMu3mpYNEQubBmT2Bdxj4WyrFX0EXsXuyxjDD7xMjoGDoTatZwQLp0RpKzJxjiBQA/HF1PB0nCNK6jqaZmn0tVf2LYW3h+ReJbM1aek+z0ZmVLMyjdFDQSrESQnniWvy/8HlovZ3GoD47d1Gg0VcTmrXfYLR09mNA8CAAA=","Material UI":"#H4sIAAAAAAAAA5VTsW7bMBDd9RVXL7IDW0o7dHBsI03ioUPaIPZWdKDFi8VEFAnypFoo+u85io6NBHWLDITId/fevTtS+VkCZ/DorYaVqOXG7PgcoHWpPPgIAe6waAg9LFegjWwq3rZKTENiWLMP0hTUWYSSdLXoIV84ZQkCOh9E0qCPAGRZRkEepSLjoDASGepZeaRFiY2R3Z4yk6oFJeeDwtQkVI1usJjlDL7EC1G3wseUfhvicRfF8oNaWMtHLNhciYceNx00XtVb6K39csJadMFUniRKW+MI7lEw6cEZDWlJZP00zyW2WRhfpkzuQvzy4+f04hXj5vvt/0gTafQr4m2j1iVqvHOmVRLdPwS0IHRKVJNGXZ5nn85zTx1fUP5W4ij+xdor8S7JyDgq3HDCnSqe3mfsyGKlhG/S915gDsMRzBfwI4E4sazgqRAuK7Zf0zBWzyQ+iKaiMfzmPIAn7KaQkqIKN+xt3IP9keF1+O4xxZWuK+H9N6HxXm1L4gTdKH6zfhKCk1q0aitI8RZ3lh/ERBuHKbP/jMYnTB2b+bsxyXEbm402SlXTGneh+HXFASADK6zCOxT9QGO95CfP5uXdZA5rvrrhCQ9vr/jopG6qKpY9MdCYMuKUvkOeRRNC2RZpn3XVfZXD9PC/paNkdPEMumIlDi8EAAA=",Tensorflow:"#H4sIAAAAAAAAA21TTU/cMBC951dM97JZFDksBVUKLOKC2kOrVsr2hDh44wlrlNjGniybIv57xzFLF6mHRM58PL/3ZlKeZHACj8H1UEujNnbP3zG03uoAIYUA99gMhAFua+itGjo+7rSsYmF8rj4p29DoELbUd9dTKDReO4IYXc1S02zKAAghKMKj0mQ9NFYhh6auMrUliI1V41vLldI70Go1a6whqQ362fVVycFDvpFmJ0MqmY4xn04JrHxHi8/tIzZMbovvGjcjDEGbB5ioPXvpHPpIqswy3TvrubyF1tse5lsiF6qyVLgT0TuhbXlDaIL1bWefS2ofw82pWJ6K0/llljHnQNE47GDFKCLg04CGtOzyxWU2JYRUKudUJ0f0QSgGw/xlMJpCBcsCtHED1VvpsIK75f3rghuzsoRfHp30OElJN7RsKXn2iMVUUDtsdDtO+c6GACx3+rCOdK//RI2JQGN7pzu+NJZVMO9RmvppYHB167318+JfD6fDg5q/vpH4ijwQSWym7fk1Gr6AdANKkvzAR7x5sQ/JiOTZmcrvWOJZAZ8LOL8v4O68gOU9g6fq8X/VXHpRwJfj6khlHW86cuMwU5zIHLS2mvJ9KBh5wauIJs8XsLqGlwyAMX6HYz/JgrLsf4seTcPGGZBJmbPa0FHlVgYzJwiIBjbIurFKgD8dJk4bb58DeuDFIWu7EMG5PA1kIB4xN/C/NPS8HiJurNCGvf22/vGdPUjkHU9EN5R/cOQiGrGcjGBJtibPuuN28Yz+AvJQmC/lAwAA","Vue.js":"#H4sIAAAAAAAAAz1QsW7DIBTc+YoXd3AbVWZ3bG+RMrRTos4h8BoT2YAAO7Ei/3vBNB5Ax92744BuCWzh5kwPR6bERT/COVKnVjpwiQJ8IB88Otgfoddi6AIcJSvjYFzVRmjuJ4PQ+r5rFspxK42HyNZZMmWLAlAUhY/xKKTXFrgWGKjFRZMtRVy0mP4tlZAjSFFnXCvPpEKbNRUN5EvnTI3MpZEFRj2hFEbXtLj2N+ShXIvrGy8TDE6qKyzV7pYZgzaWooTI3mjr4WdA+LW6h7z13riSUoFjET+vkJqOA4ZCzkeQ7whZmxZShf1w+v6CGs6VaZ5P6NE5dkWY54qa5hzGFd7jBe9PAoBdCfnbGpB/Bk4wz0qIKrzcYeiAXaejL9TY5EGcyfyx+wP6CeLh1gEAAA=="},d=()=>t`
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
      ${o(Object.entries(l).map(([e,t])=>`<option value="${t}">${e}</option>`).join(""))}
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
`;let a,c,p,u;function m(e){return s.gunzipSync(new i(e,"base64")).toString("utf8")}!function(t){if(!t){const e=location.hash.slice(1);if(e){p=e;try{t=m(e)}catch(e){console.error(e),t=m(l.Babel)}}else t=m(l.Babel)}(c=document.createElement("div")).className="sandbox",e(d(),c),document.body.querySelector(".container").appendChild(c),a=n(c.querySelector(".codemirror"),{lineNumbers:!0,value:t,mode:"javascript",scrollbarStyle:"null",tabSize:2});const o=c.querySelector(".browser-wrapper"),h=c.querySelector(".log");window.addEventListener("popstate",function(){const e=location.hash.slice(1);e&&e!==p&&(a.setValue(u=m(e)),p=e)});let b=!1;function A(){let e=!0;w.disabled=!0,document.createElement("script").type="module";const t=a.getValue();u!==t&&(p="#"+s.gzipSync(new i(t)).toString("base64"),location.hash!==p&&window.history.pushState(null,document.title,p)),u=t;const n=document.createElement("iframe");Object.assign(n.style,{margin:"0",padding:"0",borderStyle:"none",height:"100%",width:"100%",marginBottom:"-5px",overflow:"scroll"});const l=URL.createObjectURL(new Blob([`<!doctype html><style>body{cursor:wait}</style><script type="module">window.parent.jspmSandboxStarted();${t.replace(/<\/script>/g,"&lt;/script>")}\n<\/script>\n<script type="module">\nwindow.parent.jspmSandboxFinished();\n<\/script>\n<script>\nwindow.onerror = function (msg, source, line, col, err) {\n  window.parent.jspmSandboxError(msg, source, line, col, err);\n};\nwindow.console = window.parent.jspmConsole;\n<\/script>\n<body style="margin: 0; padding: 0; height: 100%; background-color: #fff">\n  <canvas id="canvas" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" touch-action="none"></canvas>\n  <div id="container"></div>\n</body>\n`],{type:"text/html"}));n.src=l,o.innerHTML="",o.appendChild(n);let d=!1;function c(e,t){const o=document.createElement("pre");t&&Object.assign(o.style,t),o.className="item",o.innerHTML=e,h.appendChild(o),h.scrollTop=h.scrollHeight}window.jspmSandboxStarted=function(){d=!0},window.jspmSandboxFinished=function(){d?(e=!1,w.disabled=!1,n.contentDocument.body.style.cursor="default"):e&&(c("Network error loading modules. Check the browser network panel."),e=!1,w.disabled=!1,n.contentDocument.body.style.cursor="default")},window.jspmSandboxError=function(t,o,r,i,s){e&&(e=!1,w.disabled=!1,n.contentDocument.body.style.cursor="default");let d=s.stack.split(l);1===d.length&&(1===r&&(i-=72),d=[`${t} sandbox:${r}:${i}`]),c(d.join("sandbox"),{color:"red"})},window.jspmConsole=Object.assign(Object.create(null),h,{log(e){let t="";for(let e=0;e<arguments.length;e++)t+=r.inspect(arguments[e],{depth:0})+(e<arguments.length-1?" ":"");c(t.replace(/\\n/g,"\n")),window.console.log.apply(h,arguments)},error(e){c((e&&e.stack||e.toString()).split(l).join("sandbox"),{color:"red"})}})}a.on("change",()=>{b||(f.value="")});const w=c.querySelector("button.run");w.addEventListener("click",A),window.jspmLog=function(e){h.innerHTML+='<pre class="item">'+e.replace(/</g,"&lt;")+"</pre>"};const f=document.body.querySelector("select.examples");f.addEventListener("change",()=>{b=!0,a.setValue(m(f.value.slice(1))),b=!1}),p&&A()}();
