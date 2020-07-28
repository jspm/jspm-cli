System.register(['lit-html','lit-html/directives/unsafe-html.js','codemirror','util','buffer','codemirror/mode/javascript/javascript.js','zlib'],function(){'use strict';var render,html,unsafeHTML,CodeMirror,util,Buffer,zlib;return{setters:[function(module){render=module.render;html=module.html;},function(module){unsafeHTML=module.unsafeHTML;},function(module){CodeMirror=module.default;},function(module){util=module.default;},function(module){Buffer=module.Buffer;},function(){},function(module){zlib=module.default;}],execute:function(){const examples={Babel:"#H4sIAAAAAAAAA4VSXWvCMBR976+4k4GbzOZxoFWEIexhA0HfxsA0uWqkTUKSdhbpf18+OmEv20Pg3nNyzj25LZlkMIGz1TVsqeSluvg+QLuTsGATBHhB1ji0sN5CrXhT+bIVdBYuhlPcccVcpxFOrq6WEbLMCO0goItREo0iA5DnuQv2yIVTBpji6KGoIkmWLErFu0FScNGC4IsRU9JRIdGMlgXx4A/PqGypTVdiGfhUJTNycwtnfUbmw53w9sayAytqXXXQWCGPEBN+Gao1mpCNZJmnlXFQ0hIrOBhVw/jknLYzQsIGc44tWUWWMGVw9Tye/9JsquYo5MYorSytXipqbWjQOOEX+rehjtqpHsRTFtSxTfI4LPPbsQ6ucaXQwyLNzZ2h0h6UqR/2GUCUwgauvh66IUbnFeOWVg2OPddn+6d4Kc22M/j4/xmfWf/og/j/oalRujxsPRfSf7DX3fub998X2uDy/hoi9gUJzX6efQP1ZXyTiAIAAA==",Babylon:"#H4sIAAAAAAAAA4VSWY/TMBB+z68Y+hJ3FZyWFYu021bQqrBI5RBdIcGbGw+Nq8SObCfd8Ovx0WMpIKREcb5rZmznVwlcwc40NayZ5Bv16P499FAKAyZCgI9YtBYNLNdQK95WbtkJduuF/p0846qwfYNQ2rqaBcgUWjQWPDodRNMgMACUUuvjkQurNBSKo4OCK4+2GLFRvD9YJlx0IPh0UChpmZCoB7NJ7sAjXzDZMRMlYen5uIph+SnNv8sdFq65Ek8zbnpojZBbCK3tNWsa1L6pPElE3ShtYf5m/m316SP80KqGtLS2Mbd57jePcuzyDdv0lZI78/o6vUsS16mxcOhrCm6H2hqlpVu0ywr9ct6/5ySNinR4d3Cg3Lr5nEPi/liSLgNIojYDq1scnmqYAv8wrD1GYtbwSTc1avZZGWGFkheWr25LlL4mowxeZvB8PDq1FG0X8rcacREIP4P/jtPsokIWe/NBAacG7QPTbgvIRVX6HbUiw7OSWcuKcuGOW6vqH4NXYlva/08zzuA8S/BcaO+xFqYpUYti5WmSBpWf57cS53ECTIW0KB3Vu7wRfXU+EJ/lT+RY4AOaki40MovrwJE0anyJ8U0GL87RkaDNoSb14eNj91utWsn/nvwucCSNGp98E54n2Um8EFS38gtKjnqlVEPIEKazqKE6wOEg9kJytaeM82XnbutKGDet41KNRvxElx+Nx8yAOt8vIPs6/VQEAAA=","lit-html":"#H4sIAAAAAAAAA0VRy27CMBC85yu2USUeovEdkpyK1HPhAzD20hjFD9mbQIT498ZxSQ+W1jO745k1W2ewhmtwGg7cyLO9j/cIHRsVICQI8I6iIwywP4C2smvHsld8GxvjKd+kFTQ4hIZ0W09QEF45gohWeRrKJwagKAqK8igVWQ/CShyhaYqlsSRxtnL4Gyml6kHJKhfWEFcGfV6XbARfvOCm5yG1TGXkU5XE2KwWz/6KYjTX4JzxPEAXlPmBydrNc+fQR1Msy5R21hM8YroNeDQS/RMu3mpYNEQubBmLOywk9qxV9BEbF7ssYww+8TLaBQ6E2rWcEC6dEaSsycYsgUAPxxdTwdJwjSuo6mmTp9LVX9i2Ft4fkXiWzNWnpPs9uZgizMo3RQ0EqxEkJ54lo8v/B5aL2dxqA+OfdRoNFXEzq132C68p/rMMAgAA","Material UI":"#H4sIAAAAAAAAA5VTsW7bMBDd9RVXL7IDW0o7dHBsI03ioUPaIPZWZKDFi8VEFAnypFoo+u89io6NBHXQDoTId+/dvTtS+VkCZ/DkrYaVqOXG7PgcoHWpPPgIAe6waAg9LFegjWwq3rZKTAMxrNkHaQrqLEJJulr0kC+csgQBnQ+iaNBHALIso5AepSLjoDASGepVeZTFFBsju71kJlULSs4HhalJqBrdYDHLGXyJF6JuhY+UfhvicReT5YdsYS2fsGBzJR563HTQeFVvobf20wlr0QVTeZIobY0juEfBokdnNKQlkfXTPA+jyyS2uQvBy4+f04tX9Jvvt+8qJtLoV6rbRq1L1HjnTKskulNqLQidEtWkUZfn2afz3FPH95K/1R8zf7H2Svx7vkg/ym+YcKeK5/+wdJRwmoSvzvcuYA7DEcwX8COBOKWs4GEQLis2XtMwluacj6KpaAy/mAfwjN0UUlJU4YaNjXuwPzK8Dt89prjSdSW8/yY03qttSUzQjeJH6ichOKlFq7aCFG9xZ/kFTLRxmLL692h8wtSxmb8bkxy3sdloo1Q1rXEXil9XHAAysMIqPDzRTzPWSx54Ni9vJXNY86UNT3h4e7lHJ3VTVbHsiYFGyogpfYc8iyaEsi3SnnXVfZXD9PCDpaNkdPEH6RTwLSAEAAA=",Tensorflow:"#H4sIAAAAAAAAA21TTU/cMBC951dM97JZFCUsBVUKLOKC2kOrVlp6Qhy88YQ1SmzjmSybIv57xzHQReohkTMfz++9mVRHGRzBA/ke1srqjdvLdwzdbA0BpRDgHpuBkeB6Db3TQyfHnVF1LIzPxSftGh49wpb77nIKUROMZ4jR1Sw1zaYMQFmWHOFRG3YBGqdRQlNXldoSxMbp8bXlQpsdGL2aNc6yMhbD7PKikuBbvlF2pyiVTMeYT6cEVr2jxef6ARsht8V3jZsRBjL2HiZqT0F5jyGSqrLM9N4FKW+hDa6H+ZbZU11V0bdS4666YrTkQtu5p4rbB7o6LpfH5fH8PMuEMHF0DTtYCURJ+DigZaO6fHGeTYlSaZ1LqlMjBhJES5g/D9Yw1bAswFg/8HqrPNZwu7x7WUhjVlXwK6BXAScd6YZW/OQgBomSGtYeG9OOU75zRCBapw/n2fTmTxSYCDSu96aTS2NZDfMelV0/DgKur0NwYV7865E03ev5yyuJryjTUCxOul5eo5UL2DSgFasPfMpXL/aUjEienej8ViSeFPC5gNO7Am5PC1jeCXiqHv9XLaVnBXw5rI5UbuJNB268DRQnMm9aW8P5ngpBXsgeos3zBawu4TkDEIzfdOgnO9BO/G8xoG3EOAsqKfPOWD6o3CqycwZCtLBB0Y11AvzpMXHaBPdEGEAWhp3rKIJLeRrIwDJiaZAfaehlPcq4rqWx4u23mx/fxYNE3stETMP5B0fOohHLyQiR5NYcRHfcLpnRX23AipniAwAA","Vue.js":"#H4sIAAAAAAAAAz1QsW7DIBTc+YoXd3AbVWZ3HG+RMrRTos4h8BoT2YAAO7Es/3vBNB4eOu7enQ7olsAW7s50cGJKXPUz3CN1bqQDlyjAJ/Leo4PDCTot+jbAQbIyLsapNkJzPxqExndtvVCOW2k8RHafJVO2KABFUfgYj0J6bYFrgYFaXDTZUsRVi/HfUgk5gBT7jGvlmVRos7qigXzpnKmBubSywKgnlMLomhbncEceyjW4vvE6Qu+kusFS7WGZMWhjKUqI7Iy2Hn56hF+rO8gb740rKY0fVwgc6NBjaON8BPmOkLVmIVU4j+fvL9jDpTL1NEGHzrEbwjxX1NSXsK7wEdPfJwKAbQn52xqQfwZOMM9KiCq83GHpiG2ro6+4u00exJnMH7s/PwfC8dMBAAA="};let editor,sandbox,curHash,curJs;function initSandbox(e){if(!e){const o=location.hash.slice(1);if(o){curHash=o;try{e=hashToSource(o);}catch(o){console.error(o),e=hashToSource(examples.Babel);}}else e=hashToSource(examples.Babel);}sandbox=document.createElement("div"),sandbox.className="sandbox",render(html`
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
    height: 50%;
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
      ${unsafeHTML(Object.entries(examples).map(([e,o])=>`<option value="${o}">${e}</option>`).join(""))}
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
    <div class="browser-wrapper" style="width:100%; height: 50%; background-color:#fff"></div>
    <div class="log"></div>
  </div>
</div>
`,sandbox);document.body.querySelector(".container").appendChild(sandbox),editor=CodeMirror(sandbox.querySelector(".codemirror"),{lineNumbers:!0,value:e,mode:"javascript",scrollbarStyle:"null",tabSize:2});const o=sandbox.querySelector(".browser-wrapper"),t=sandbox.querySelector(".log");window.addEventListener("popstate",(function(){const e=location.hash.slice(1);e&&e!==curHash&&(editor.setValue(curJs=hashToSource(e)),curHash=e);}));let r=!1;function i(){let e=!0;n.disabled=!0;document.createElement("script").type="module";const r=editor.getValue();curJs!==r&&(curHash="#"+zlib.gzipSync(new Buffer(r)).toString("base64"),location.hash!==curHash&&window.history.pushState(null,document.title,curHash)),curJs=r;const i=document.createElement("iframe");Object.assign(i.style,{margin:"0",padding:"0",borderStyle:"none",height:"100%",width:"100%",marginBottom:"-5px",overflow:"scroll"});const s=URL.createObjectURL(new Blob([`<!doctype html><style>body{cursor:wait}</style><script type="module">window.parent.jspmSandboxStarted();${r.replace(/<\/script>/g,"&lt;/script>")}\n      <\/script>\n      <script type="module">\n      window.parent.jspmSandboxFinished();\n      <\/script>\n      <script>\n      window.onerror = function (msg, source, line, col, err) {\n        window.parent.jspmSandboxError(msg, source, line, col, err);\n      };\n      window.console = window.parent.jspmConsole;\n      <\/script>\n      <body style="margin: 0; padding: 0; height: 100%; background-color: #fff">\n        <canvas id="canvas" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" touch-action="none"></canvas>\n        <div id="container"></div>\n      </body>\n    `],{type:"text/html"}));i.src=s,o.innerHTML="",o.appendChild(i);let a=!1;function d(e,o){const r=document.createElement("pre");o&&Object.assign(r.style,o),r.className="item",r.innerHTML=e,t.appendChild(r),t.scrollTop=t.scrollHeight;}window.jspmSandboxStarted=function(){a=!0;},window.jspmSandboxFinished=function(){a?(e=!1,n.disabled=!1,i.contentDocument.body.style.cursor="default"):e&&(d("Network error loading modules. Check the browser network panel."),e=!1,n.disabled=!1,i.contentDocument.body.style.cursor="default");},window.jspmSandboxError=function(o,t,r,a,l){e&&(e=!1,n.disabled=!1,i.contentDocument.body.style.cursor="default");let c=l.stack.split(s);1===c.length&&(1===r&&(a-=72),c=[`${o} sandbox:${r}:${a}`]),d(c.join("sandbox"),{color:"red"});},window.jspmConsole=Object.assign(Object.create(null),t,{log(e){let o="";for(let e=0;e<arguments.length;e++)o+=util.inspect(arguments[e],{depth:0})+(e<arguments.length-1?" ":"");d(o.replace(/\\n/g,"\n")),window.console.log.apply(t,arguments);},error(e){d((e&&e.stack||e.toString()).split(s).join("sandbox"),{color:"red"});},warn(e){d(e,{backgroundColor:"goldenrod"});}});}editor.on("change",()=>{r||(s.value="");});const n=sandbox.querySelector("button.run");n.addEventListener("click",i),window.jspmLog=function(e){t.innerHTML+='<pre class="item">'+e.replace(/</g,"&lt;")+"</pre>";};const s=document.body.querySelector("select.examples");s.addEventListener("change",()=>{r=!0,editor.setValue(hashToSource(s.value.slice(1))),r=!1;}),curHash&&i();}function hashToSource(e){return zlib.gunzipSync(new Buffer(e,"base64")).toString("utf8")}initSandbox();}}});