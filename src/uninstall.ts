import { Generator } from "@jspm/generator";
import c from "picocolors";
import type { Flags } from "./types";
import {
  cwdUrl,
  getEnv,
  getInput,
  getInputUrl,
  startLoading,
  stopLoading,
  writeOutput,
} from "./utils";
import * as logger from "./logger";

export default async function uninstall(
  packages: string[],
  flags: Flags,
  silent = false
) {
  logger.info(`Uninstalling packages: ${packages.join(", ")}`);
  logger.info(`Flags: ${JSON.stringify(flags)}`);

  const env = await getEnv(flags);
  startLoading(
    `Uninstalling ${c.bold(packages.join(", "))}. (${env.join(", ")})`
  );

  const generator = new Generator({
    env,
    baseUrl: cwdUrl(),
    mapUrl: getInputUrl(flags),
  });

  // Read in any import maps or inline modules in the input:
  const input = await getInput(flags);
  if (typeof input !== "undefined") generator.addMappings(input);

  // Uninstall the provided packages.
  await generator.uninstall(packages);
  await writeOutput(generator.getMap(), flags, silent);
  stopLoading();

  return generator.getMap();
}
