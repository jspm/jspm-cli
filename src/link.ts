import * as fs from "node:fs/promises";
import { pathToFileURL } from "url";
import c from "picocolors";
import { type Generator } from "@jspm/generator";
import type { Flags } from "./types";
import {
  getEnv,
  getGenerator,
  getInput,
  getInputPath,
  getOutputPath,
  startSpinner,
  stopSpinner,
  writeOutput,
} from "./utils";
import { withType } from "./logger";

export default async function link(modules: string[], flags: Flags) {
  const log = withType("link/link");

  log(`Linking modules: ${modules.join(", ")}`);
  log(`Flags: ${JSON.stringify(flags)}`);

  const env = await getEnv(flags);
  const inputMapPath = getInputPath(flags);
  const outputMapPath = getOutputPath(flags);
  const generator = await getGenerator(flags);

  const inlinePins: string[] = [];
  const resolvedModules = (
    await Promise.all(
      modules.map((spec) => resolveModule(spec, inlinePins, generator))
    )
  ).filter((m) => !!m);

  // The input map is either from a JSON file or extracted from an HTML file.
  // In the latter case we want to trace any inline modules from the HTML file
  // as well, since they may have imports that are not in the import map yet:
  const input = await getInput(flags);
  const pins = inlinePins.concat(resolvedModules.map((p) => p.target));
  let allPins = pins;
  if (input) {
    allPins = pins.concat(await generator.addMappings(input));
  }

  log(`Input map parsed: ${input}`);
  log(`Trace installing: ${allPins.concat(pins).join(", ")}`);

  if (allPins.length) {
    if (modules.length === 0) {
      !flags.silent && startSpinner(`Linking input.`);
    } else {
      !flags.silent &&
        startSpinner(
          `Linking ${c.bold(
            resolvedModules.map((p) => p.alias || p.target).join(", ")
          )}. (${env.join(", ")})`
        );
    }

    await generator.link(allPins.concat(pins));
    stopSpinner();
  } else {
    !flags.silent &&
      console.warn(
        `${c.red(
          "Warning:"
        )} Found nothing to link, will default to relinking input map. Provide a list of modules or HTML files with inline modules to change this behaviour.`
      );
  }

  // If the user has provided modules and the output path is different to the
  // input path, then we behave as an extraction from the input map. In all
  // other cases we behave as an update to the map:
  if (inputMapPath !== outputMapPath && modules.length !== 0) {
    return await writeOutput(generator, pins, env, flags, flags.silent);
  } else {
    return await writeOutput(generator, null, env, flags, flags.silent);
  }
}

async function resolveModule(
  p: string,
  inlinePins: string[],
  generator: Generator
) {
  const log = withType("link/resolveModule");

  let res: { target: string; alias?: string };
  if (p.includes("=")) {
    const [alias, target] = p.split("=");
    res = { alias, target };
  } else {
    res = { target: p };
  }

  // If the user provides a bare specifier like 'app.js', we can check for
  // a local file of the same name ('./app.js') and use that as the target
  // rather. If the user really wants to link the 'app.js' package they can
  // prefix it with '%' as follows: '%app.js':
  if (res.target.startsWith("%")) {
    log(`Resolving target '${res.target}' as '${res.target.slice(1)}'`);
    res.target = res.target.slice(1);
  } else {
    try {
      await fs.access(res.target);
      const targetPath =
        res.target.startsWith(".") || res.target.startsWith("/")
          ? res.target
          : `./${res.target}`;

      log(`Resolving target '${res.target}' as '${targetPath}'`);
      res.target = targetPath;

      return handleLocalFile(res, inlinePins, generator);
    } catch (e) {
      // No file found, so we leave the target as-is.
    }
  }

  return res;
}

async function handleLocalFile(
  resolvedModule: { alias?: string; target: string },
  inlinePins: string[],
  generator: Generator
) {
  const source = await fs.readFile(resolvedModule.target, { encoding: "utf8" });
  const { default: babel } = await import("@babel/core");

  try {
    babel.parse(source);
    return resolvedModule; // this is a javascript module, it parsed correctly
  } catch (e) {
    /* fallback to parsing it as html */
  }

  const targetUrl = pathToFileURL(resolvedModule.target);
  let pins;
  try {
    pins = await generator.linkHtml(source, targetUrl);
  } catch (e) {
    if (e?.jspmError) {
      e.message += `, linking HTML file "${resolvedModule.target}"`;
    }
    throw e;
  }
  if (!pins || pins.length === 0) {
    throw new Error("No inline HTML modules found to link.");
  }

  inlinePins = inlinePins.concat(pins);
}
