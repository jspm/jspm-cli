import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";
import { type RollupOptions, rollup } from "rollup";

import { JspmError, exists } from "../utils";
import type { Flags } from "../types";
import { RollupImportmapPlugin } from "./rollup-importmap-plugin";

export default async function build(entry: string, options: Flags) {
  if (!entry && !options.buildConfig) {
    throw new JspmError(`Please provide entry for the build`);
  }

  let buildConfig: RollupOptions;
  let outputOptions: RollupOptions["output"];

  if (entry) {
    if (!options.buildOutput) {
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
      file: path.join(process.cwd(), options.buildOutput),
    };
  }

  if (options.buildConfig) {
    const buildConfigPath = path.join(process.cwd(), options.buildConfig);
    if ((await exists(buildConfigPath)) === false) {
      throw new JspmError(
        `Build config file does not exist: ${buildConfigPath}`
      );
    }
    const rollupConfig = await import(buildConfigPath)
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
  const result = await builder.generate({ format: "esm", ...outputOptions });

  for (const file of result.output) {
    const outputPath = path.join(process.cwd(), file.fileName);
    const content = file.type === "asset" ? file.source : file.code;
    await fs.writeFile(outputPath, content, "utf-8");
  }
}
