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

export default async function update(packages: string[], flags: Flags) {
  const log = withType("update/update");

  log(`Updating packages: ${packages.join(", ")}`);
  log(`Flags: ${JSON.stringify(flags)}`);

  const env = await getEnv(flags);
  const generator = await getGenerator(flags);

  // Read in any import maps or inline modules in the input:
  let inputPins: string[] = [];
  const input = await getInput(flags);
  if (typeof input !== "undefined") {
    inputPins = await generator.addMappings(input);
  }

  log(`Input map parsed: ${input}`);

  if (packages.length === 0 && inputPins.length === 0) {
    !flags.silent &&
      console.warn(
        `${c.red(
          "Warning:"
        )} Nothing to update. Please provide a list of packages or a non-empty input file.`
      );
    return;
  } else {
    !flags.silent &&
      startSpinner(
        `Updating ${c.bold(
          packages.length ? packages.join(", ") : "everything"
        )}. (${env.join(", ")})`
      );
    await generator.update(packages.length ? packages : inputPins);
    stopSpinner();
  }

  return await writeOutput(generator, null, env, flags, flags.silent);
}
