import { Plugin } from "rollup";
import fs from "node:fs/promises";
import { Flags } from "../types";
import { getGenerator, JspmError } from "../utils";

export const RollupImportmapPlugin = async (flags: Flags): Promise<Plugin> => {
  const generator = await getGenerator(flags);

  return {
    name: "rollup-importmap-plugin",
    resolveId: async (id: string) => {
      try {
        const resolved = generator.resolve(id);
        return resolved;
      } catch (err) {
        return { id, external: true };
      }
    },
    load: async (id: string) => {
      try {
        const url = new URL(id);
        if (url.protocol === "file:") {
          return await fs.readFile(url.pathname, "utf-8");
        }
      } catch (err) {
        throw new JspmError(`\n Failed to resolve ${id}: ${err.message} \n`);
      }
    },
  };
};
