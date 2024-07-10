import assert from "assert";
import { availableProviders } from "../src/utils";
import {
  type Scenario,
  mapDirectory,
  mapFile,
  runScenarios,
} from "./scenarios";

const scenarios: Scenario[] = [
  // Scenario that checks we can swap providers with a reinstall:
  {
    files: await mapDirectory("test/fixtures/scenario_provider_swap"),
    commands: [`jspm install --provider nodemodules`],
    validationFn: async (files) => {
      const map = files.get("importmap.json");
      assert(!!map);
      assert(!map.includes("jspm.io"));
    },
  },

  // Scenario that checks the provider is auto-detected from the initial map:
  {
    files: await mapFile("test/fixtures/unpkg.importmap.json"),
    commands: [`jspm link -m unpkg.importmap.json -o importmap.json`],
    validationFn: async (files) => {
      const map = files.get("importmap.json");
      assert(!!map);
      assert(!map.includes("jspm.io"));
    },
  },
];

// Scenarios that check we can use each available provider:
const files = await mapDirectory("test/fixtures/scenario_providers");
for (const provider of availableProviders) {
  if (provider === "esm.sh") {
    /*
      Disabling esm.sh provider for now. There is a bug for installing lit.
      https://github.com/jspm/generator/issues/335
    */
    continue;
  }

  let spec = "lit";
  let name = "lit";
  if (provider.includes("deno")) {
    // spec = "denoland:oak/body.ts"; // deno doesn't support npm packages
    // name = "oak/body.ts";
    spec = "denoland:zod";
    name = "zod";
  }
  if (provider === "node") {
    spec = "@jspm/core/nodelibs/fs"; // node provider is only for polyfills
    name = "@jspm/core/nodelibs/fs";
  }
  if (provider === "nodemodules") {
    spec = "lit"; // must be installed in the fixture
    name = "lit";
  }

  scenarios.push({
    files,
    commands: [`jspm install ${spec} -p ${provider} -e production`],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json") ?? "{}");
      assert(map?.imports?.[name]);
    },
  });
}

runScenarios(scenarios);
