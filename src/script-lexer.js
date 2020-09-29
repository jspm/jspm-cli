let source, i;

export function parse (_source) {
  const scripts = [];
  source = _source;
  i = 0;

  let curScript = { start: -1, end: -1, attributes: undefined, innerStart: -1, innerEnd: -1 };
  while (i < source.length) {
    while (source.charCodeAt(i++) !== 60 /*<*/)
      if (i === source.length) return scripts;
    const x = i;
    i = x;
    switch (readTagName()) {
      case '!--':
        while (source.charCodeAt(i) !== 45/*-*/ || source.charCodeAt(i + 1) !== 45/*-*/ || source.charCodeAt(i + 2) !== 62/*>*/)
          if (++i === source.length) return scripts;
        i += 3;
        break;
      case 'script':
        curScript.start = i - 8;
        const attributes = [];
        let attr;
        while (attr = scanAttr())
          attributes.push(attr);
        curScript.attributes = attributes;
        curScript.innerStart = i;
        while (true) {
          while (source.charCodeAt(i++) !== 60 /*<*/)
            if (i === source.length) return scripts;
          const tag = readTagName();
          if (tag === undefined) return scripts;
          if (tag === '/script') {
            curScript.innerEnd = i - 8;
            while (scanAttr());
            curScript.end = i;
            break;
          }
        }
        scripts.push(curScript);
        curScript = { start: -1, end: -1, attributes: undefined, innerStart: -1, innerEnd: -1 };
        break;
      case undefined:
        return scripts;
      default:
        while (scanAttr());
    }
  }
  return scripts;
}

function readTagName () {
  let start = i;
  let ch;
  while (!isWs(ch = source.charCodeAt(i++)) && ch !== 62 /*>*/)
    if (i === source.length) return;
  return source.slice(start, ch === 62 ? --i : i - 1);
}

function scanAttr () {
  let ch;
  while (isWs(ch = source.charCodeAt(i)))
    if (++i === source.length) return;
  if (ch === 62 /*>*/) {
    i++;
    return;
  }
  const nameStart = i;
  while (!isWs(ch = source.charCodeAt(i++)) && ch !== 61 /*=*/) {
    if (i === source.length) return;
    if (ch === 62 /*>*/)
      return { nameStart, nameEnd: --i, valueStart: -1, valueEnd: -1 };
  }
  const nameEnd = i - 1;
  if (ch !== 61 /*=*/) {
    while (isWs(ch = source.charCodeAt(i)) && ch !== 61 /*=*/) {
      if (++i === source.length) return;
      if (ch === 62 /*>*/) return;
    }
    if (ch !== 61 /*=*/) return { nameStart, nameEnd, valueStart: -1, valueEnd: -1 };
  }
  while (isWs(ch = source.charCodeAt(i++))) {
    if (i === source.length) return;
    if (ch === 62 /*>*/) return;
  }
  if (ch === 34 /*"*/) {
    const valueStart = i;
    while (source.charCodeAt(i++) !== 34 /*"*/)
      if (i === source.length) return;
    return { nameStart, nameEnd, valueStart, valueEnd: i - 1 };
  }
  else if (ch === 39 /*'*/) {
    const valueStart = i;
    while (source.charCodeAt(i++) !== 39 /*'*/)
      if (i === source.length) return;
    return { nameStart, nameEnd, valueStart, valueEnd: i - 1 };
  }
  else {
    const valueStart = i - 1;
    i++;
    while (!isWs(ch = source.charCodeAt(i)) && ch !== 62 /*>*/)
      if (++i === source.length) return;
    return { nameStart, nameEnd, valueStart, valueEnd: i };
  }
}

function isWs (ch) {
  return ch === 32 || ch < 14 && ch > 8;
}

function logScripts (source, scripts) {
  for (const script of scripts) {
    for (const { nameStart, nameEnd, valueStart, valueEnd } of script.attributes) {
      console.log('Name: ' + source.slice(nameStart, nameEnd));
      if (valueStart !== -1)
        console.log('Value: ' + source.slice(valueStart, valueEnd));
    }
    console.log('"' + source.slice(script.innerStart, script.innerEnd) + '"');
    console.log('"' + source.slice(script.start, script.end) + '"');
  }
}

if (typeof process !== 'undefined' && process.mainModule === module) {
  const path = require('path');
  const assert = require('assert');

  console.group('Simple script');
  {
    const source = `
      <script type="module">test</script>
      <script src="hi" jspm-preload></script>
    `;
    const scripts = parse(source);
    assert.strictEqual(scripts.length, 2);
    assert.strictEqual(scripts[0].attributes.length, 1);
    const attr = scripts[0].attributes[0];
    assert.strictEqual(source.slice(attr.nameStart, attr.nameEnd), "type");
    assert.strictEqual(source.slice(attr.valueStart, attr.valueEnd), "module");
    assert.strictEqual(scripts[0].innerStart, 29);
    assert.strictEqual(scripts[0].innerEnd, 33);
    assert.strictEqual(scripts[0].start, 7);
    assert.strictEqual(scripts[0].end, 42);
    assert.strictEqual(scripts[1].start, 49);
    assert.strictEqual(scripts[1].end, 88);
    assert.strictEqual(scripts[1].attributes.length, 2);
  }
  console.groupEnd();

  console.group('Edge cases');
  {
    const source = `
    <!-- <script>
      <!-- /* </script> */ ->
      console.log('hmm');
    </script
    
    <script>
      console.log('hi');
    </script>
    
    
    -->
    
    <script ta"    ==='s'\\>
      console.log('test');
    </script>
    
    <script <!-- <p type="module">
      export var p = 5;
      console.log('hi');
    </script type="test"
    >
    
    

    `;
    const scripts = parse(source);
    assert.strictEqual(scripts.length, 2);
    assert.strictEqual(scripts[0].attributes.length, 1);
    let attr = scripts[0].attributes[0];
    assert.strictEqual(source.slice(attr.nameStart, attr.nameEnd), 'ta"');
    assert.strictEqual(source.slice(attr.valueStart, attr.valueEnd), '===\'s\'\\');
    assert.strictEqual(scripts[0].innerStart, 195);
    assert.strictEqual(scripts[0].innerEnd, 227);
    assert.strictEqual(scripts[0].start, 172);
    assert.strictEqual(scripts[0].end, 236);
    assert.strictEqual(scripts[1].attributes.length, 3);
    attr = scripts[1].attributes[0];
    assert.strictEqual(source.slice(attr.nameStart, attr.nameEnd), '<!--');
    assert.strictEqual(attr.valueStart, -1);
    assert.strictEqual(attr.valueEnd, -1);
    attr = scripts[1].attributes[1];
    assert.strictEqual(source.slice(attr.nameStart, attr.nameEnd), '<p');
    assert.strictEqual(attr.valueStart, -1);
    assert.strictEqual(attr.valueEnd, -1);
    attr = scripts[1].attributes[2];
    assert.strictEqual(source.slice(attr.nameStart, attr.nameEnd), 'type');
    assert.strictEqual(source.slice(attr.valueStart, attr.valueEnd), 'module');
    assert.strictEqual(scripts[1].innerStart, 276);
    assert.strictEqual(scripts[1].innerEnd, 331);
    assert.strictEqual(scripts[1].start, 246);
    assert.strictEqual(scripts[1].end, 356);
  }
  console.groupEnd();
}
