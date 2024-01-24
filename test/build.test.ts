import assert from "assert";
import { type Scenario, mapDirectory, runScenarios } from "./scenarios";

// Windows tests are disabled
if (process.platform !== 'win32') {

  const filesOwnName = await mapDirectory("test/fixtures/scenario_build_app");

  const scenarios: Scenario[] = [
    {
      files: filesOwnName,
      commands: ["jspm build --config rollup-config.mjs"],
      validationFn: async (files) => {
        const build = files.get("build.js");
        assert(!!build);
        assert(!build.includes('import { add } from "./utils.js"'));
        assert(build.includes("const add = (num1, num2) => num1 + num2"));
      },
    },
  ];

  runScenarios(scenarios);

}