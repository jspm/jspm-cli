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
  parsePackageSpec,
  startLoading,
  stopLoading,
  writeOutput,
} from "./utils";
import * as log from "./logger";

export default async function install(
  packages: string[],
  flags: Flags,
  silent = false
) {
  log.info(`Installing packages: ${packages.join(", ")}`);
  log.info(`Flags: ${JSON.stringify(flags)}`);

  const resolvedPackages = packages.map((p) => {
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

  // The input map is either from a JSON file or extracted from an HTML file.
  // In the latter case we want to trace any inline modules from the HTML file
  // as well, since they may have imports that are not in the import map yet:
  const input = await getInput(flags);
  if (typeof input !== "undefined") generator.addMappings(input);

  log.info(`Input map parsed: ${JSON.stringify(input, null, 2)}`);

  // Install provided packages, or reinstall existing if none provided:
  if (resolvedPackages.length) {
    startLoading(
      `Installing ${c.bold(
        resolvedPackages.map((p) => p.alias || p.target).join(", ")
      )}. (${env.join(", ")})`
    );
    await generator.install(resolvedPackages);
  } else {
    startLoading(`Reinstalling all top-level imports.`);
    await generator.reinstall();
  }

  log.info("Extracting map from generator.");

  // If the input and output maps are the same, we behave in an additive way
  // and trace all top-level pins to the output file. Otherwise, we behave as
  // an extraction and only trace the provided packages to the output file.
  let outputMap = generator.getMap();
  if (inputMapPath !== outputMapPath && resolvedPackages.length) {
    const pins = resolvedPackages.map((p) =>
      parsePackageSpec(p.alias || p.target)
    );
    ({ map: outputMap } = await generator.extractMap(pins));
  }

  log.info(`Map extraction complete: ${JSON.stringify(outputMap, null, 2)}`);

  // Attach explicit environment keys and write the output:
  stopLoading();
  attachEnv(outputMap, env);
  await writeOutput(outputMap, flags, silent);

  return outputMap;
}
