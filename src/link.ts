import { Generator } from "@jspm/generator";
import c from "picocolors";
import type { Flags } from "./types";
import {
  attachEnv,
  cwdUrl,
  getEnv,
  getInput,
  getInputPath,
  getInputUrl,
  getOutputPath,
  getProvider,
  getResolutions,
  startLoading,
  stopLoading,
  writeOutput,
} from "./utils";
import * as logger from "./logger";

export default async function link(
  modules: string[],
  flags: Flags,
  silent = false
) {
  logger.info(`Linking modules: ${modules.join(", ")}`);
  logger.info(`Flags: ${JSON.stringify(flags)}`);

  const resolvedModules = modules.map((p) => {
    if (!p.includes("=")) return { target: p };
    const [alias, target] = p.split("=");
    return { alias, target };
  });

  const inputMapPath = getInputPath(flags);
  const outputMapPath = getOutputPath(flags);
  const provider = getProvider(flags);
  const env = await getEnv(flags);

  const generator = new Generator({
    env: [...env],
    defaultProvider: provider,
    baseUrl: cwdUrl(),
    mapUrl: getInputUrl(flags),
    resolutions: getResolutions(flags),
  });

  if (modules.length === 0) {
    startLoading(`Linking input.`);
  } else {
    startLoading(
      `Linking ${c.bold(
        resolvedModules.map((p) => p.alias || p.target).join(", ")
      )}. (${env.join(", ")})`
    );
  }

  // The input map is either from a JSON file or extracted from an HTML file.
  // In the latter case we want to trace any inline modules from the HTML file
  // as well, since they may have imports that are not in the import map yet:
  let inputPins: string[] = [];
  const input = await getInput(flags);
  if (typeof input !== "undefined") {
    inputPins = await generator.addMappings(input);
  }

  // Trace everything in the input file, along with the provided packages:
  await generator.traceInstall(
    inputPins.concat(resolvedModules.map((p) => p.target))
  );

  // If the user has provided modules and the output path is different to the
  // input path, then we behave as an extraction from the input map. In all
  // other cases we behave as an update:
  let outputMap = generator.getMap();
  if (inputMapPath !== outputMapPath && modules.length !== 0)
    ({ map: outputMap } = await generator.extractMap(modules));

  // Attach explicit environment keys and inject result into output file:
  stopLoading();
  attachEnv(outputMap, env);
  await writeOutput(outputMap, flags, silent);

  return generator.getMap();
}
