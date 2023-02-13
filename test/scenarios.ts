import fs from "fs/promises";
import path from "path";
import os from "os";
import { cli, patchArgs } from "../src/cli";

const defaultPackageJson = {
  name: "test",
  version: "1.0.0",
  dependencies: {},
};

export type Files = Map<string, string>;
export interface Scenario {
  commands: `jspm ${string}`[];
  validationFn: (files: Files) => Promise<void>;

  // For configuring initial environment for the scenario:
  files?: Files;
}

export async function runScenarios(scenarios: Scenario[]) {
  for (const scenario of scenarios) {
    await runScenario(scenario);
  }
}

export async function runScenario(scenario: Scenario) {
  const cwd = process.cwd();
  const dir = await createTmpPkg(scenario);
  process.chdir(dir);

  try {
    for (const cmd of scenario.commands) {
      const args = ["node", ...cmd.split(" ")];
      patchArgs(args);
      cli.parse(args, { run: false });
      await cli.runMatchedCommand();
    }

    const files = new Map<string, string>();
    for (const file of await fs.readdir(dir)) {
      if ((await fs.stat(file)).isFile())
        files[file] = await fs.readFile(file, "utf-8");
    }

    await scenario.validationFn(files);
  } finally {
    await deleteTmpPkg(dir);
    process.chdir(cwd);
  }
}

async function createTmpPkg(scenario: Scenario): Promise<string> {
  // Inject a simple package.json if one doesn't already exist:
  if (!scenario.files?.has("package.json")) {
    scenario.files = new Map([
      ["package.json", JSON.stringify(defaultPackageJson)],
      ...(scenario.files ?? []),
    ]);
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jspm-"));
  for (const [file, content] of scenario.files || []) {
    await fs.writeFile(path.join(dir, file), content);
  }

  return dir;
}

async function deleteTmpPkg(dir: string) {
  if (dir.startsWith(os.tmpdir())) {
    // ensure it's a tmp dir
    return fs.rm(dir, { recursive: true });
  } else {
    throw new Error(`Cannot delete ${dir} as it is not a temporary directory.`);
  }
}
