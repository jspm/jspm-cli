import c from "picocolors";
import { withType } from "./logger";
import type { Flags } from "./types";
import {
    JspmError,
    getEnv,
    getGenerator,
    getInput,
    isUrlLikeNotPackage,
    startSpinner,
    stopSpinner,
    writeOutput
} from "./utils";

export default async function install(packages: string[], flags: Flags) {
  const log = withType("install/install");

  log(`Installing packages: ${packages.join(", ")}`);
  log(`Flags: ${JSON.stringify(flags)}`);

  const isInstallable = (p) => !isUrlLikeNotPackage(p.target);
  const parsedPackages = packages.map((p) => {
    if (!p.includes("=")) return { target: p };
    const [alias, target] = p.split("=");
    return { alias, target };
  });


  // Packages that can be installed by the generator:
  const resolvedPackages = parsedPackages.filter(isInstallable);
  
  // Packages that can be installed directly as URLs, see the issue:
  // https://github.com/jspm/generator/issues/291
  const urlLikePackages = parsedPackages.filter((p) => !isInstallable(p));

  const env = await getEnv(flags);
  const input = await getInput(flags);
  const generator = await getGenerator(flags);
  let pins = [];
  if (input) {
    pins = await generator.addMappings(input);
  }
  if (urlLikePackages?.length) {
    const imports = {};
    for (const { alias, target } of urlLikePackages) {
      if (!alias) throw new JspmError(`URL-like target "${target}" must be given an alias to install under, such as "name=${target}".`);

      imports[alias] = target;
    }

    pins.push(...(await generator.addMappings(JSON.stringify({ imports }))));
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
