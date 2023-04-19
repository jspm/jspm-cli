import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { Generator, analyzeHtml } from "@jspm/generator";
import ora from "ora";
import c from "picocolors";
import { withType } from "./logger";
import type { Flags, IImportMapJspm } from "./types";

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

// Providers that can be used to resolve dependencies:
export const availableProviders = [
  "jspm.io",
  "nodemodules",
  "deno",
  "jsdelivr",
  "skypack",
  "unpkg",
  "esm.sh",
  "jspm.io#system",
];

export class JspmError extends Error {
  jspmError = true;
}

export function cwdUrl() {
  return pathToFileURL(`${process.cwd()}/`);
}

/**
 * Intercepts internal errors in CLI commands:
 */
export function wrapCommand(fn: Function) {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (e) {
      stopSpinner();
      process.exitCode = 1;
      if (e instanceof JspmError || e?.jspmError) {
        console.error(`${c.red("Error:")} ${e.message}\n`);
        return;
      }
      throw e;
    }
  };
}

export async function writeOutput(
  generator: Generator,
  pins: string[] | null,
  env: string[],
  flags: Flags,
  silent = false
) {
  if (flags.stdout) return writeStdoutOutput(generator, pins, silent);

  const mapFile = getOutputPath(flags);
  if (mapFile.endsWith(".html"))
    return writeHtmlOutput(mapFile, generator, pins, env, flags, silent);
  return writeJsonOutput(mapFile, generator, pins, env, flags, silent);
}

async function writeStdoutOutput(
  generator: Generator,
  pins: string[] | null,
  silent = false
) {
  let map: IImportMapJspm = pins?.length
    ? (await generator.extractMap(pins))?.map
    : generator.getMap();
  map = { ...map };

  !silent && console.log(JSON.stringify(map, null, 2));
  return map;
}

async function writeHtmlOutput(
  mapFile: string,
  generator: Generator,
  pins: string[] | null,
  env: string[],
  flags: Flags,
  silent = false
) {
  // Don't write an output file without permission:
  if (!(await canWrite(mapFile)))
    throw new JspmError(
      `JSPM does not have permission to write to ${mapFile}.`
    );

  const mapFileRel = path.relative(process.cwd(), mapFile);
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

  // TODO: Inject env into the import map somehow.
  const outputHtml = await generator.htmlInject(html, {
    pins: pins ?? true,
    htmlUrl: generator.mapUrl, // URL of the output map
    rootUrl: generator.rootUrl,
    preload: getPreloadMode(flags),
    integrity: flags.integrity,
    whitespace: !flags.compact,
    comment: false,
  });

  await fs.writeFile(mapFile, outputHtml);
  !silent && console.warn(`${c.green("Ok:")} Updated ${c.cyan(mapFileRel)}`);
}

async function writeJsonOutput(
  mapFile: string,
  generator: Generator,
  pins: string[] | null,
  env: string[],
  flags: Flags,
  silent = false
) {
  const log = withType("utils/writeJsonOutput");

  let map: IImportMapJspm;
  if (pins?.length) {
    log(`Extracting map for top-level pins: ${pins?.join(", ")}`);
    map = (await generator.extractMap(pins))?.map;
  } else {
    log(`Extracting full map`);
    map = generator.getMap();
  }
  map = { env, ...map };
  log(`${JSON.stringify(map, null, 2)}`);

  // Don't write an output file without permission:
  if (!(await canWrite(mapFile)))
    throw new JspmError(
      `JSPM does not have permission to write to ${mapFile}.`
    );

  // If the JSON file already exists, extend it in case of other custom properties
  // (this way we can install into deno.json without destroying configurations)
  try {
    const existing = JSON.parse(await fs.readFile(mapFile, "utf8"));
    map = Object.assign({}, existing, map);
  } catch {}

  // Otherwise we output the import map in standard JSON format:
  await fs.writeFile(
    mapFile,
    flags.compact ? JSON.stringify(map) : JSON.stringify(map, null, 2)
  );

  const mapFileRel = path.relative(process.cwd(), mapFile);
  !silent && console.warn(`${c.green("Ok:")} Updated ${c.cyan(mapFileRel)}`);
  return map;
}

export async function getGenerator(
  flags: Flags,
  setEnv = true
): Promise<Generator> {
  const log = withType("utils/getGenerator");
  const mapUrl = getOutputMapUrl(flags);
  const rootUrl = getRootUrl(flags);
  const baseUrl = new URL(path.dirname(mapUrl.href));
  log(
    `Creating generator with mapUrl ${mapUrl}, baseUrl ${baseUrl}, rootUrl ${rootUrl}`
  );

  return new Generator({
    mapUrl,
    baseUrl,
    rootUrl,
    inputMap: await getInputMap(flags),
    env: setEnv ? await getEnv(flags) : undefined,
    defaultProvider: getProvider(flags),
    resolutions: getResolutions(flags),
    cache: getCacheMode(flags),
    freeze: flags.freeze,
    commonJS: true, // TODO: only for --local flag
  });
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

async function getInputMap(flags: Flags): Promise<IImportMapJspm> {
  let inputMap;

  const input = await getInput(flags);
  const mapUrl = getOutputMapUrl(flags);
  if (input) {
    try {
      inputMap = JSON.parse(input) as IImportMapJspm;
    } catch {
      try {
        const analysis = analyzeHtml(input, mapUrl);
        inputMap = analysis.map;
      } catch {
        throw new JspmError(
          `Input map "${getInputPath(
            flags
          )}" is neither a valid JSON or a HTML file containing an inline import map.`
        );
      }
    }
  }

  return (inputMap || {}) as IImportMapJspm;
}

export function getInputPath(flags: Flags): string {
  return path.resolve(process.cwd(), flags.map || defaultInputPath);
}

export function getOutputPath(flags: Flags): string | undefined {
  return path.resolve(
    process.cwd(),
    flags.output || flags.map || defaultInputPath
  );
}

function getOutputMapUrl(flags: Flags): URL {
  return pathToFileURL(getOutputPath(flags));
}

function getRootUrl(flags: Flags): URL {
  if (!flags.root) return undefined;
  return pathToFileURL(path.resolve(process.cwd(), flags.root));
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
    envFlags.filter((env) => env.startsWith("no-")).map((env) => env.slice(3))
  );
  env = addEnvs(
    env,
    envFlags.filter((env) => !env.startsWith("no-"))
  );

  return removeNonStaticEnvKeys(env);
}

function getProvider(flags: Flags) {
  if (flags.provider && !availableProviders.includes(flags.provider))
    throw new JspmError(
      `Invalid provider "${
        flags.provider
      }". Available providers are: "${availableProviders.join('", "')}".`
    );
  return flags.provider;
}

function removeNonStaticEnvKeys(env: string[]) {
  return env.filter(
    (e) => e !== "import" && e !== "require" && e !== "default"
  );
}

function getResolutions(flags: Flags): Record<string, string> {
  if (!flags.resolution) return;
  const resolutions = Array.isArray(flags.resolution)
    ? flags.resolution
    : flags.resolution.split(",").map((r) => r.trim());

  return Object.fromEntries(
    resolutions.map((resolution) => {
      if (!resolution.includes("=")) {
        throw new JspmError(
          `Resolutions must be mappings from package names to package versions or specifiers, such as ${c.bold(
            "--resolution pkg=1.2.3"
          )} or ${c.bold("--resolution pkg=npm:other@1.2.3")}`
        );
      }
      return resolution.split("=");
    })
  );
}

const validCacheModes = ["online", "offline", "no-cache"];
function getCacheMode(flags: Flags): "offline" | boolean {
  if (!flags.cache) return true;
  if (!validCacheModes.includes(flags.cache))
    throw new JspmError(
      `Invalid cache mode "${
        flags.cache
      }". Available modes are: "${validCacheModes.join('", "')}".\n\t${c.bold(
        "online"
      )}   Use a locally cached module if available and fresh.\n\t${c.bold(
        "offline"
      )}   Use a locally cached module if available, even if stale.\n\t${c.bold(
        "no-cache"
      )}   Never use the local cache.`
    );

  if (flags.cache === "offline") return "offline";
  if (flags.cache === "online") return true;
  return false;
}

const validPreloadModes = ["static", "dynamic"];
function getPreloadMode(flags: Flags): boolean | string {
  if (flags.preload === null || flags.preload === undefined) return false;
  if (typeof flags.preload === "boolean") {
    return flags.preload;
  }

  if (!validPreloadModes.includes(flags.preload))
    throw new JspmError(
      `Invalid preload mode "${
        flags.preload
      }". Available modes are: "${validPreloadModes.join('", "')}".\n\t${c.bold(
        "static"
      )}  Inject preload tags for static dependencies.\n\t${c.bold(
        "dynamic"
      )}  Inject preload tags for static and dynamic dependencies.`
    );

  if (flags.preload === "static") return "static";
  if (flags.preload === "dynamic") return "all";
  return false; // should never get here
}

const spinner = ora({ spinner: "dots" });

export function startSpinner(text: string) {
  spinner.start(text);
}
export function stopSpinner() {
  spinner.stop();
}

async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch (e) {
    return false;
  }
}

async function canRead(file: string) {
  try {
    await fs.access(file, (fs.constants || fs).R_OK);
    return true;
  } catch (e) {
    return false;
  }
}

async function canWrite(file: string) {
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

/**
 * Returns true if the given specifier is a relative URL or a URL.
 */
export function isUrlLikeNotPackage(spec: string): boolean {
  if (spec.endsWith("/")) return false;
  if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/"))
    return true;
  try {
    // eslint-disable-next-line no-new
    new URL(spec);
    return spec[spec.indexOf(":") + 1] === "/";
  } catch {
    return false;
  }
}
