import path from "node:path";
import process from "node:process";
import { type RollupOptions, rollup } from "rollup";

import { JspmError, exists } from "../utils";
import type { Flags } from "../types";
import { RollupImportmapPlugin } from "./rollup-importmap-plugin";
import { pathToFileURL } from "node:url";

export default async function build(entry: string, options: Flags) {
  if (!entry && !options.config) {
    throw new JspmError(`Please provide entry for the build`);
  }

  let buildConfig: RollupOptions;
  let outputOptions: RollupOptions["output"];

  if (entry) {
    if (!options.output) {
      throw new JspmError(`Build output is required when entry is provided`);
    }

    const entryPath = path.join(process.cwd(), entry);
    if ((await exists(entryPath)) === false) {
      throw new JspmError(`Entry file does not exist: ${entryPath}`);
    }
    buildConfig = {
      input: entryPath,
      plugins: [RollupImportmapPlugin(options)],
    };

    outputOptions = {
      dir: path.join(process.cwd(), options.output),
    };
  }

  if (options.config) {
    const buildConfigPath = path.join(process.cwd(), options.config);
    if ((await exists(buildConfigPath)) === false) {
      throw new JspmError(
        `Build config file does not exist: ${buildConfigPath}`
      );
    }
    const rollupConfig = await import(pathToFileURL(buildConfigPath).href)
      .then((mod) => mod.default)
      .catch((err) => {
        throw new JspmError(`Failed to load build config: ${err}`);
      });

    if ("output" in rollupConfig) {
      outputOptions = rollupConfig.output;
    }

    buildConfig = {
      ...rollupConfig,
      plugins: [
        ...(rollupConfig?.plugins || []),
        RollupImportmapPlugin(options),
      ],
    };
  }

  const builder = await rollup(buildConfig);
  await builder.write({ format: "esm", ...outputOptions });
}
