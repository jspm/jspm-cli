import assert from "assert";
import { type Scenario, runScenarios } from "./scenarios";

const importMap = new Map([
  [
    "importmap.json",
    JSON.stringify({
      imports: {
        fs: "https://ga.jspm.io/npm:@jspm/core@2.0.0-beta.20/nodelibs/node/fs.js",
      },
    }),
  ],
]);

const scenarios: Scenario[] = [
  // Installing without freeze should bump the version of core:
  {
    files: importMap,
    commands: ["jspm install node:process"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(!map.imports.fs.includes("2.0.0-beta.20"));
      assert(!map.imports.process.includes("2.0.0-beta.20"));
    },
  },

  // Installing with freeze should keep it fixed:
  {
    files: importMap,
    commands: ["jspm install node:process --freeze"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(map.imports.fs.includes("2.0.0-beta.20"));
      assert(map.imports.process.includes("2.0.0-beta.20"));
    },
  },
];

runScenarios(scenarios);
