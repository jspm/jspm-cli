import fs from "fs/promises";
import path from "path";
import os from "os";
import { cli } from "../src/cli";

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
      const args = ["node", ...cmd.split(" "), "--silent"];
      cli.parse(args, { run: false });
      await cli.runMatchedCommand();
    }

    await scenario.validationFn(await mapDirectory(dir));
  } finally {
    await deleteTmpPkg(dir);
    process.chdir(cwd);
  }
}

export async function mapDirectory(dir: string): Promise<Files> {
  const files = new Map<string, string>();
  for (const file of await fs.readdir(dir)) {
    const filePath = path.join(dir, file);
    if ((await fs.stat(filePath)).isFile()) {
      const data = await fs.readFile(filePath, "utf-8");
      files.set(file, data);
    } else {
      const subFiles = await mapDirectory(filePath);
      for (const [subFile, subData] of subFiles) {
        files.set(path.join(file, subFile), subData);
      }
    }
  }
  return files;
}

export async function mapFile(files: string | string[]): Promise<Files> {
  if (typeof files === "string") return mapFile([files]);

  const res = new Map<string, string>();
  for (const file of files) {
    const data = await fs.readFile(file, "utf-8");
    res.set(path.basename(file), data);
  }
  return res;
}

async function createTmpPkg(scenario: Scenario): Promise<string> {
  // Inject a simple package.json if one doesn't already exist:
  if (!scenario.files?.has("package.json")) {
    if (!scenario.files) scenario.files = new Map();
    scenario.files.set("package.json", JSON.stringify(defaultPackageJson));
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jspm-"));
  for (const [file, content] of scenario.files || []) {
    const dirPath = path.join(dir, path.dirname(file));
    await fs.mkdir(dirPath, { recursive: true });
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
