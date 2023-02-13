import { Generator } from "@jspm/generator";
import c from "picocolors";
import type { Flags } from "./types";
import {
  cwdUrl,
  getEnv,
  getInput,
  getInputUrl,
  getResolutions,
  startLoading,
  stopLoading,
  writeOutput,
} from "./utils";

export default async function update(
  packages: string[],
  flags: Flags,
  silent = false
) {
  const env = await getEnv(flags);
  startLoading(
    `Updating ${c.bold(
      packages.length ? packages.join(", ") : "everything"
    )}. (${env.join(", ")})`
  );

  const generator = new Generator({
    env,
    baseUrl: cwdUrl(),
    mapUrl: getInputUrl(flags),
    resolutions: getResolutions(flags),
  });

  // Read in any import maps or inline modules in the input:
  const input = await getInput(flags);
  if (typeof input !== "undefined") generator.addMappings(input);

  // Update the provided packages:
  await generator.update(packages);
  await writeOutput(generator.getMap(), flags, silent);
  stopLoading();

  return generator.getMap();
}
