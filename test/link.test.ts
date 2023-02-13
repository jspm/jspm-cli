import fs from "fs/promises";
import assert from "assert";
import { type Scenario, runScenarios } from "./scenarios";

const aJs = await fs.readFile("test/fixtures/a.js", "utf-8");
const bJs = await fs.readFile("test/fixtures/b.js", "utf-8");
const importMap = new Map(
  Object.entries({
    "importmap.json": await fs.readFile("test/importmap.json", "utf-8"),
  })
);
const htmlFile = new Map(
  Object.entries({
    "index.html": await fs.readFile("test/fixtures/index.html", "utf-8"),
  })
);
const inlineModulesFile = new Map(
  Object.entries({
    "index.html": await fs.readFile(
      "test/fixtures/inlinemodules.html",
      "utf-8"
    ),
  })
);
const scripts = new Map(
  Object.entries({
    "a.js": aJs,
    "b.js": bJs,
  })
);

const scenarios: Scenario[] = [
  // Basic link, from a package without an existing import map.
  {
    files: scripts,
    commands: ["jspm link ./a.js"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files["importmap.json"]);
      assert(map.imports["react-dom"]); // transitive dependency
    },
  },

  // Make sure dependency constraints are picked up from input map:
  {
    files: new Map([...scripts, ...importMap]),
    commands: ["jspm link ./a.js"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files["importmap.json"]);
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
      const html = files["index.html"];
      assert(html && html.includes("react-dom@17.0.1"));
    },
  },

  // Injecting the output into an existing HTML file should create one:
  {
    files: new Map([...scripts, ...importMap, ...htmlFile]),
    commands: ["jspm link ./a.js -o index.html"],
    validationFn: async (files: Map<string, string>) => {
      const html = files["index.html"];
      assert(html && html.includes("react-dom@17.0.1"));
      assert(html && html.includes("<title>Test</title>"));
    },
  },

  // Running a link on an HTML file without providing modules should trace
  // all of the inline imports in the file:
  {
    files: new Map([...scripts, ...importMap, ...inlineModulesFile]),
    commands: ["jspm link -m index.html"],
    validationFn: async (files: Map<string, string>) => {
      // No version information because "-m index.html" sets the input/output
      // source files to "index.html", so "importmap.json" is ignored:
      const html = files["index.html"];
      assert(html && html.includes("react-dom")); // from ./a.js
    },
  },

  // Running a link on an HTML file without providing modules should trace
  // all of the inline imports in the file, and respect any dependency
  // information in the import map:
  // TODO: is this the behaviour we want?
  {
    files: new Map([...scripts, ...importMap, ...inlineModulesFile]),
    commands: ["jspm link -o index.html"],
    validationFn: async (files: Map<string, string>) => {
      const html = files["index.html"];
      assert(html && html.includes("react-dom@17.0.1")); // from ./a.js
    },
  },
];

await runScenarios(scenarios);
