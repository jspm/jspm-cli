import assert from "assert";
import { availableProviders } from "../src/utils";
import { type Scenario, mapDirectory, runScenarios } from "./scenarios";

const files = await mapDirectory("test/fixtures/scenario_providers");

const scenarios: Scenario[] = [];
for (const provider of availableProviders) {
  let spec = "lit";
  let name = "lit";
  if (provider.includes("deno")) {
    spec = "denoland:oak/body.ts"; // deno doesn't support npm packages
    name = "oak/body.ts";
  }
  if (provider === "node") {
    spec = "@jspm/core/nodelibs/fs"; // node provider is only for polyfills
    name = "@jspm/core/nodelibs/fs";
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
