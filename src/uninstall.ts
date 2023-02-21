import c from "picocolors";
import type { Flags } from "./types";
import {
  getEnv,
  getGenerator,
  getInput,
  startSpinner,
  stopSpinner,
  writeOutput,
} from "./utils";
import { withType } from "./logger";

export default async function uninstall(packages: string[], flags: Flags) {
  const log = withType("install/install");

  log(`Uninstalling packages: ${packages.join(", ")}`);
  log(`Flags: ${JSON.stringify(flags)}`);

  if (packages.length === 0) {
    !flags.silent &&
      console.warn(
        `${c.red(
          "Warning:"
        )} Nothing to uninstall. Please provide a list of packages.`
      );
    return;
  }

  const env = await getEnv(flags);
  const input = await getInput(flags);
  const generator = await getGenerator(flags);
  if (typeof input !== "undefined") await generator.addMappings(input);

  log(`Input map parsed: ${input}`);

  !flags.silent &&
    startSpinner(
      `Uninstalling ${c.bold(packages.join(", "))}. (${env.join(", ")})`
    );

  // Uninstall the provided packages.
  await generator.uninstall(packages);

  stopSpinner();
  return await writeOutput(generator, null, env, flags, flags.silent);
}
