import assert from "assert";
import {
  type Scenario,
  mapDirectory,
  mapFile,
  runScenarios,
} from "./scenarios";

const importMap = await mapFile("test/fixtures/importmap.json");

const scenarios: Scenario[] = [
  // The inline improtmap should be linked and the integrity attribute should be added
  {
    files: importMap,
    commands: ["jspm link react -o index.html --integrity"],
    validationFn: async (files: Map<string, string>) => {
      const html = files.get("index.html");

      assert(html.includes("integrity"));
    },
  },
  // The importmap generated should have integrity attribute
  {
    files: importMap,
    commands: ["jspm link --integrity"],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(map.integrity);
    },
  },
  // Scenario should detect the provider and add integrity attribute
  {
    files: await mapFile("test/fixtures/unpkg.importmap.json"),
    commands: [
      "jspm link -m unpkg.importmap.json -o importmap.json --integrity",
    ],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(map.integrity);
    },
  },
  // Scenario should detect the provider and add integrity attribute
  {
    files: await mapDirectory("test/fixtures/scenario_provider_swap"),
    commands: ["jspm install --provider nodemodules --integrity"],
    validationFn: async (files) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(map.integrity);
    },
  },
  // Scenario installs package from denoland along with integrity attribute
  {
    files: new Map(),
    commands: ["jspm install denoland:zod --integrity"],
    validationFn: async (files) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(map.imports.zod.includes("deno.land"));
      assert(map.integrity);
    },
  },
  // Scenario installs package from skypack along with integrity attribute
  {
    files: new Map(),
    commands: ["jspm install lit --provider skypack --integrity"],
    validationFn: async (files) => {
      const map = JSON.parse(files.get("importmap.json"));
      assert(map.imports.lit.includes("cdn.skypack.dev"));
      assert(map.integrity);
    },
  },
];

runScenarios(scenarios);
