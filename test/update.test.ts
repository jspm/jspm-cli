import fs from "fs/promises";
import assert from "assert";
import { type Scenario, runScenarios } from "./scenarios";

const importMap = new Map(
  Object.entries({
    "importmap.json": await fs.readFile(
      "test/fixtures/importmap.json",
      "utf-8"
    ),
  })
);

const packageJson = new Map(
  Object.entries({
    "package.json": await fs.readFile("test/fixtures/package.json", "utf-8"),
  })
);

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
