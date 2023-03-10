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

export default async function install(packages: string[], flags: Flags) {
  const log = withType("install/install");

  log(`Installing packages: ${packages.join(", ")}`);
  log(`Flags: ${JSON.stringify(flags)}`);

  const resolvedPackages = packages.map((p) => {
    if (!p.includes("=")) return { target: p };
    const [alias, target] = p.split("=");
    return { alias, target };
  });

  const env = await getEnv(flags);
  const input = await getInput(flags);
  const generator = await getGenerator(flags);
  let pins = [];
  if (input) {
    pins = await generator.addMappings(input);
  }

  log(`Input map parsed: ${input}`);

  // Install provided packages, or reinstall existing if none provided:
  if (resolvedPackages.length) {
    !flags.silent &&
      startSpinner(
        `Installing ${c.bold(
          resolvedPackages.map((p) => p.alias || p.target).join(", ")
        )}. (${env.join(", ")})`
      );
    await generator.install(resolvedPackages);
    stopSpinner();
  } else if (pins.length) {
    !flags.silent && startSpinner(`Reinstalling all top-level imports.`);
    await generator.install();
    stopSpinner();
  } else {
    !flags.silent &&
      console.warn(
        `${c.red(
          "Warning:"
        )} Nothing to install, outputting an empty import map. Either provide a list of package to install, or a non-empty input file.`
      );
  }

  // Installs always behave additively, and write all top-level pins:
  return await writeOutput(generator, null, env, flags, flags.silent);
}
