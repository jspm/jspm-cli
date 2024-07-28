import assert from "assert";
import { type Scenario, mapFile, runScenarios } from "./scenarios";

const scripts = await mapFile(["test/fixtures/a.js", "test/fixtures/b.js"]);
const importMap = await mapFile("test/fixtures/importmap.json");
const htmlFile = await mapFile("test/fixtures/index.html");
const inlineModules = await mapFile("test/fixtures/inlinemodules.html");
const inlineHtml = await mapFile("test/fixtures/inlinehtml.js");
const indexScript = await mapFile("test/fixtures/index.js");

const scenarios: Scenario[] = [
  // Basic link, from a package without an existing import map.
  {
    files: scripts,
    commands: ["jspm link ./a.js"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(map.imports["react-dom"]); // transitive dependency
    },
  },

  // Make sure dependency constraints are picked up from input map:
  {
    files: new Map([...scripts, ...importMap]),
    commands: ["jspm link ./a.js"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(map.imports["react-dom"]); // transitive dependency
      assert.strictEqual(
        map.imports["react-dom"],
        "https://ga.jspm.io/npm:react-dom@17.0.1/index.js"
      );
    },
  },

  // Injecting the output into a non-existent HTML file should create one:
  {
    files: new Map([...scripts, ...importMap]),
    commands: ["jspm link ./a.js -o index.html"],
    validationFn: async (files: Map<string, string>) => {
      const html = files.get("index.html");
      assert(html && html.includes("react-dom@17.0.1"));
    },
  },

  // Injecting the output into an existing HTML file should create one:
  {
    files: new Map([...scripts, ...importMap, ...htmlFile]),
    commands: ["jspm link ./a.js -o index.html"],
    validationFn: async (files: Map<string, string>) => {
      const html = files.get("index.html");
      assert(html && html.includes("react-dom@17.0.1"));
      assert(html && html.includes("<title>Test</title>"));
    },
  },

  // Running a link on an HTML file without providing modules should trace
  // all of the inline imports in the file:
  {
    files: new Map([...scripts, ...importMap, ...inlineModules]),
    commands: ["jspm link -m inlinemodules.html"],
    validationFn: async (files: Map<string, string>) => {
      // No version information because "-m index.html" sets the input/output
      // source files to "index.html", so "importmap.json" is ignored:
      const html = files.get("inlinemodules.html");
      assert(html && html.includes("react-dom")); // from ./a.js
    },
  },

  // Running a link on an HTML file without providing modules should trace
  // all of the inline imports in the file:
  {
    files: new Map([...scripts, ...importMap, ...inlineModules]),
    commands: ["jspm link -o inlinemodules.html"],
    validationFn: async (files: Map<string, string>) => {
      const html = files.get("inlinemodules.html");
      assert(html && html.includes("react-dom@17.0.1")); // from ./a.js
    },
  },

  // Linking 'index.js' when there's no local './index.js' file around should
  // link against the npm package 'index.js':
  {
    files: null,
    commands: ["jspm link index.js"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(map.imports["index.js"]);
    },
  },

  // Linking 'index.js' when there is a local './index.js' file around should
  // link against the local file:
  {
    files: indexScript,
    commands: ["jspm link index.js"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(!map.imports["index.js"]);
      assert(map.imports.react); // transitive dependency
    },
  },

  // Linking '%index.js' when there is a local './index.js' file around should
  // link against the npm package 'index.js':
  {
    files: indexScript,
    commands: ["jspm link %index.js"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(map.imports["index.js"]);
      assert(!map.imports.react);
    },
  },

  // Linking a HTML file directly should link all of the inline modules inside
  // the file:
  {
    files: new Map([...scripts, ...inlineModules, ...importMap]),
    commands: ["jspm link inlinemodules.html"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(map.imports["react-dom"]); // transitive dependency
      assert.strictEqual(
        map.imports["react-dom"],
        "https://ga.jspm.io/npm:react-dom@17.0.1/index.js"
      );
    },
  },

  // CLI shouldn't be confused by a JS file that has an inline HTML string:
  {
    files: new Map([...scripts, ...inlineModules, ...inlineHtml]),
    commands: ["jspm link inlinehtml.js"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json"));

      // Should _not_ have linked the module in the inline HTML string:
      assert(!map.imports?.["react-dom"]);
    },
  },

  // Support the HTML as being the import map when there is no importmap.json:
  {
    files: new Map([...htmlFile, ['app.js', 'import "react"']]),
    commands: ["jspm link index.html -o index.html --integrity"],
    validationFn: async (files: Map<string, string>) => {
      const source = files.get('index.html');
      assert(source.includes('"integrity"'));
      assert(source.includes('"./app.js": "sha384-f+bWmpnsmFol2CAkqy/ALGgZsi/mIaBIIhbvFLVuQzt0LNz96zLSDcz1fnF2K22q"'));
      assert(source.includes('"https://ga.jspm.io/npm:react@18.2.0/dev.index.js": "sha384-eSJrEMXot96AKVLYz8C1nY3CpLMuBMHIAiYhs7vfM09SQo+5X+1w6t3Ldpnw+VWU"'))
    },
  },
];

await runScenarios(scenarios);
