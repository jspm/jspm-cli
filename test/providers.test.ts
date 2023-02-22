import assert from "assert";
import { availableProviders } from "../src/utils";
import { type Scenario, mapDirectory, runScenarios } from "./scenarios";

const files = await mapDirectory("test/fixtures/scenario_providers");

const scenarios: Scenario[] = [];
for (const provider of availableProviders) {
  scenarios.push({
    files,
    commands: [`jspm install lit -p ${provider} -e production`],
    validationFn: async (files: Map<string, string>) => {
      const map = JSON.parse(files.get("importmap.json")!);
      assert(map.imports.lit);
    },
  });
}

runScenarios(scenarios);
