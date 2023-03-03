import assert from "assert";
import { type Scenario, mapFile, runScenarios } from "./scenarios";

const importMap = await mapFile("test/fixtures/importmap.json");
const packageJson = await mapFile("test/fixtures/package.json");

const scenarios: Scenario[] = [
  // Basic upgrade to latest react version:
  {
    files: importMap,
    commands: ["jspm update react"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(map.imports.react);
      assert.notStrictEqual(
        map.imports.react,
        "https://ga.jspm.io/npm:react@17.0.1/dev.index.js"
      );
    },
  },

  // Basic upgrade without parameters should upgrade all:
  {
    files: importMap,
    commands: ["jspm update"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(map.imports.react);
      assert.notStrictEqual(
        map.imports.react,
        "https://ga.jspm.io/npm:react@17.0.1/dev.index.js"
      );
    },
  },

  // Upgrade should use version from package.json:
  {
    files: new Map([...importMap, ...packageJson]),
    commands: ["jspm update react -e development"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(map.imports.react);
      assert.strictEqual(
        map.imports.react,
        "https://ga.jspm.io/npm:react@18.1.0/dev.index.js"
      );
    },
  },
];

runScenarios(scenarios);
