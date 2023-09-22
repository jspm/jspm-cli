import { Plugin } from "rollup";
import fs from "node:fs/promises";
import path from "node:path";
import { Flags } from "../types";
import { getGenerator, JspmError } from "../utils";

export const RollupImportmapPlugin = async (flags: Flags): Promise<Plugin> => {
  const generator = await getGenerator({ ...flags, freeze: true });
  await generator.install();

  return {
    name: "rollup-importmap-plugin",
    resolveId: async (id: string, importer: string) => {
      if (importer?.startsWith("http") && id?.startsWith(".")) {
        const proxyPath = new URL(id, importer).toString();
        return { id: proxyPath, external: false };
      }

      try {
        const resolved = generator.importMap.resolve(id, importer);
        return { id: resolved };
      } catch (err) {
        return { id, external: true };
      }
    },
    load: async (id: string) => {
      try {
        const url = new URL(id);

        if (url.protocol === "file:") {
          /*
            This is a hack and need to be replaced with a proper solution.
          */
          const filePath =
            path.extname(url.pathname) === ""
              ? `${url.pathname}.js`
              : url.pathname;

          return await fs.readFile(filePath, "utf-8");
        }

        if (url.protocol === "https:") {
          const response = await fetch(id);
          return await response.text();
        }
      } catch (err) {
        throw new JspmError(`\n Failed to resolve ${id}: ${err.message} \n`);
      }
    },
  };
};
