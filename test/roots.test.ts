import assert from "assert";
import { type Scenario, mapDirectory, runScenarios } from "./scenarios";

const filesRoot = await mapDirectory("test/fixtures/scenario_roots");

const scenarios: Scenario[] = [
  // rootURL = /, mapURL = /importmap.json
  {
    files: filesRoot,
    commands: ["jspm install roots"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json")!);
      assert.strictEqual(map.imports.roots, "./a/b/index.js");
      assert(map.scopes["./"]); // scoping root is the map URL
    },
  },

  // rootURL = /, mapURL = /a/importmap.json
  {
    files: filesRoot,
    commands: ["jspm install roots -o a/importmap.json --root ."],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("a/importmap.json")!);
      assert.strictEqual(map.imports.roots, "/a/b/index.js"); // rooted URL
      assert(map.scopes["/"]); // root package scope equals the root URL
    },
  },

  // rootURL = /a, mapURL = /a/importmap.json
  {
    files: filesRoot,
    commands: ["jspm install roots -o a/importmap.json --root a"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("a/importmap.json")!);
      assert.strictEqual(map.imports.roots, "/b/index.js"); // rooted URL
      assert(map.scopes["/../"]); // root packager scope is behind the root URL
      // ^ an odd edge case, we might want to map the scope to "/" like the
      //   browser does if you visit something like "http://root.com/../".
    },
  },

  // rootURL = /a/b, mapURL = /a/importmap.json
  {
    files: filesRoot,
    commands: ["jspm install roots -o a/importmap.json --root a/b"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("a/importmap.json")!);
      assert.strictEqual(map.imports.roots, "/index.js"); // rooted URL
      assert(map.scopes["/../../"]); // root packager scope is behind the root URL
      // ^ an odd edge case, we might want to map the scope to "/" like the
      //   browser does if you visit something like "http://root.com/../".
    },
  },
];

runScenarios(scenarios);

