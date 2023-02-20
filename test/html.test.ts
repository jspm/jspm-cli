import assert from "assert";
import { type Scenario, runScenarios, mapFile } from "./scenarios";

const importMap = await mapFile("test/fixtures/importmap.json");

// TODO: test formatting, preload and integrity
const scenarios: Scenario[] = [
  {
    files: importMap,
    commands: ["jspm link react -o index.html"],
    validationFn: async (files: Map<string, string>) => {
      // The index.html should contain the react version from the import map,
      // but none of the other pins, and no preloads or integrity attributes:
      assert(files["index.html"].includes("npm:react@17.0.1"));
      assert(!files["index.html"].includes("npm:lodash@4.17.21"));
      assert(!files["index.html"].includes("npm:react-dom@17.0.1"));
      assert(!files["index.html"].includes("preload"));
      assert(!files["index.html"].includes("integrity"));
    },
  },
  {
    files: importMap,
    commands: ["jspm link -o index.html"],
    validationFn: async (files: Map<string, string>) => {
      // The index.html should contain the import version of everything, but
      // no preloads or integrity attributes:
      assert(files["index.html"].includes("npm:react@17.0.1"));
      assert(files["index.html"].includes("npm:lodash@4.17.21"));
      assert(files["index.html"].includes("npm:react-dom@17.0.1"));
      assert(!files["index.html"].includes("preload"));
      assert(!files["index.html"].includes("integrity"));
    },
  },
  {
    files: importMap,
    commands: ["jspm link react -o index.html --preload"],
    validationFn: async (files: Map<string, string>) => {
      // The index.html should contain the react version from the import map,
      // and integrities for it, but nothing else:
      assert(files["index.html"].includes("npm:react@17.0.1"));
      assert(!files["index.html"].includes("npm:lodash@4.17.21"));
      assert(!files["index.html"].includes("npm:react-dom@17.0.1"));
      assert(files["index.html"].includes("preload"));
      assert(!files["index.html"].includes("integrity"));
    },
  },
  {
    files: importMap,
    commands: ["jspm install react -o index.html --integrity"],
    validationFn: async (files: Map<string, string>) => {
      // The index.html should contain the react version from the import map,
      // and integrities for the 17.0.1 version:
      // NOTE: this will break if we change the CDN build!
      const reactIntegrity = "sha384-y5ozcpbgsrkQFNWIQTtiGWstK6sGqPJu5Ptnvn8lAqJXDNI7ZdE9fMsYVgrq3PRG";
      assert(files["index.html"].includes("npm:react@17.0.1"));
      assert(!files["index.html"].includes("npm:lodash@4.17.21"));
      assert(!files["index.html"].includes("npm:react-dom@17.0.1"));
      assert(files["index.html"].includes("preload"));
      assert(files["index.html"].includes(reactIntegrity));
    },
  },
];

runScenarios(scenarios);

