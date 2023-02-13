import path from "path";
import { pathToFileURL } from "url";
import fs from "fs/promises";
import c from "picocolors";
import ora from "ora";
import { Generator } from "@jspm/generator";
import type { Flags, IImportMapFile } from "./types";

// Default import map to use if none is provided:
const defaultInputPath = "./importmap.json";

// Default HTML for import map injection:
const defaultHtmlTemplate = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>JSPM example</title>
    <script type="importmap"></script>
  </head>
  <body>
  </body>
</html>`;

export class JspmError extends Error {
  jspmError = true;
}

export function cwdUrl() {
  return pathToFileURL(`${process.cwd()}/`);
}

/**
 * Intercepts internal errors in CLI commands:
 */
export function wrapCommandAndRemoveStack(fn: Function) {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (e) {
      stopLoading();
      process.exitCode = 1;
      if (e instanceof JspmError || e?.jspmError) {
        console.error(`${c.red("Error:")} ${e.message}\n`);
        return;
      }
      throw e;
    }
  };
}

// TODO: loading spinner for output writing
export async function writeOutput(
  map: IImportMapFile,
  flags: Flags,
  silent = false
) {
  // Ensure the 'env' key is always written first:
  const env = map.env;
  delete map.env;
  map = { env, ...map };

  // If the stdout flag is set, we always write to stdout:
  if (flags.stdout) {
    !silent && console.log(JSON.stringify(map, null, 2));
    return;
  }

  // Don't write an output file without permission:
  const mapFile = getOutputPath(flags);
  const mapFileRel = path.relative(process.cwd(), mapFile);
  if (!(await canWrite(mapFile)))
    throw new JspmError(
      `JSPM does not have permission to write to ${mapFile}.`
    );

  // If the output file is HTML, we need to run the generator HTML injection:
  if (mapFile.endsWith(".html")) {
    if (!(await exists(mapFile))) {
      !silent &&
        console.warn(
          `${c.cyan(
            "Note:"
          )} HTML file ${mapFileRel} does not exist, creating one.`
        );
      await fs.writeFile(mapFile, defaultHtmlTemplate, "utf-8");
    }

    let html: string;
    try {
      html = await fs.readFile(mapFile, "utf-8");
    } catch (e) {
      throw new JspmError(
        `Failed to read HTML file ${c.cyan(mapFile)} for injection.`
      );
    }

    const generator = new Generator({ inputMap: map });
    const outputHtml = await generator.htmlInject(html, {
      htmlUrl: new URL(mapFile, cwdUrl()),
      comment: false,
      preload: flags.preload,
      integrity: flags.integrity,
      whitespace: !flags.compact,
    });

    await fs.writeFile(mapFile, outputHtml);
    !silent && console.warn(`${c.green("Ok:")} Updated ${c.cyan(mapFileRel)}`);

    return;
  }

  // Otherwise we output the import map in standard JSON format:
  await fs.writeFile(mapFile, JSON.stringify(map, null, 2));
  !silent && console.warn(`${c.green("Ok:")} Updated ${c.cyan(mapFileRel)}`);
}

export async function getInput(flags: Flags): Promise<string | undefined> {
  const mapFile = getInputPath(flags);
  if (!(await exists(mapFile))) return undefined;
  if (!(await canRead(mapFile))) {
    if (mapFile === defaultInputPath) return undefined;
    else
      throw new JspmError(`JSPM does not have permission to read ${mapFile}.`);
  }
  return fs.readFile(mapFile, "utf-8");
}

export async function getInputMap(flags: Flags): Promise<IImportMapFile> {
  const mapPath = getInputPath(flags);
  const file = await getInput(flags);
  if (!file) return {};

  // For HTML files, we can extract the input map from the generator's tracer
  // once it's finished processing the file:
  if (mapPath.endsWith(".html")) {
    const generator = new Generator({
      baseUrl: cwdUrl(),
      mapUrl: getInputUrl(flags),
      resolutions: getResolutions(flags),
      defaultProvider: getProvider(flags),
    });

    // TODO: this abuses the jspm/generator internals, we should export an API
    //       for working with html files and use that instead
    await generator.addMappings(file);
    return generator.traceMap.inputMap;
  }

  // In all other cases it should be a JSON file:
  return JSON.parse(file);
}

export function getInputPath(flags: Flags): string {
  return path.resolve(process.cwd(), flags.map || defaultInputPath);
}

export function getInputUrl(flags: Flags): URL {
  return pathToFileURL(getInputPath(flags));
}

export function getOutputPath(flags: Flags): string | undefined {
  return path.resolve(
    process.cwd(),
    flags.output || flags.map || defaultInputPath
  );
}

const excludeDefinitions = {
  production: ["development"],
  development: ["production"],
  node: ["browser", "deno"],
  deno: ["node", "browser"],
  browser: ["node", "deno"],
};
function removeEnvs(env: string[], removeEnvs: string[]) {
  for (const removeEnv of removeEnvs) {
    if (env.includes(removeEnv)) env.splice(env.indexOf(removeEnv), 1);
  }
  return env.sort();
}
function addEnvs(env: string[], newEnvs: string[]) {
  let excludeEnvs = [];
  for (const newEnv of newEnvs) {
    if (!env.includes(newEnv)) env.push(newEnv);
    const excludes = excludeDefinitions[newEnv];
    if (excludes) excludeEnvs = excludeEnvs.concat(excludes);
  }
  for (const exclude of excludeEnvs) {
    if (env.includes(exclude) && !newEnvs.includes(exclude))
      env.splice(env.indexOf(exclude), 1);
  }
  return env.sort();
}

export async function getEnv(flags: Flags) {
  const inputMap = await getInputMap(flags);
  const envFlags = Array.isArray(flags.env)
    ? flags.env
    : (flags.env || "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
  let env = inputMap.env || ["development", "browser", "module"];
  env = removeEnvs(
    env,
    envFlags.filter((env) => env.startsWith("no-"))
  );
  env = addEnvs(
    env,
    envFlags.filter((env) => !env.startsWith("no-"))
  );

  return removeNonStaticEnvKeys(env);
}

export function getProvider(flags: Flags) {
  return flags.provider || "jspm";
}

function removeNonStaticEnvKeys(env: string[]) {
  return env.filter(
    (e) => e !== "import" && e !== "require" && e !== "default"
  );
}

export function attachEnv(map: any, env: string[] = []) {
  map.env = removeNonStaticEnvKeys(env);
}

export function detachEnv(map: any) {
  return { ...map, env: undefined };
}

export function getResolutions(flags: Flags): Record<string, string> {
  if (!flags.resolution) return;
  const resolutions = flags.resolution.split(",").map((r) => r.trim());
  return Object.fromEntries(
    resolutions.map((resolution) => {
      if (!resolution.includes("=")) {
        throw new JspmError(
          `Resolutions must be mappings from aliases to targets, for example of the form ${c.bold(
            "--resolution pkg=x.y.z"
          )}`
        );
      }
      return resolution.split("=");
    })
  );
}

const loading = ora({ spinner: "dots" });

export function startLoading(text: string) {
  loading.start(text);
}
export function stopLoading() {
  loading.stop();
}

export async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch (e) {
    return false;
  }
}

export async function canRead(file: string) {
  try {
    await fs.access(file, (fs.constants || fs).R_OK);
    return true;
  } catch (e) {
    return false;
  }
}

export async function canWrite(file: string) {
  try {
    if (!(await exists(file))) return true;
    await fs.access(file, (fs.constants || fs).W_OK);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Takes an npm-style package specifier (such as "react@^16.8.0") and returns
 * the package name (in this case "react").
 *   see https://docs.npmjs.com/cli/v8/using-npm/package-spec
 */
export function parsePackageSpec(pkgTarget: string): string {
  if (pkgTarget.startsWith("@")) return `@${pkgTarget.slice(1).split("@")[0]}`;
  return pkgTarget.split("@")[0];
}
