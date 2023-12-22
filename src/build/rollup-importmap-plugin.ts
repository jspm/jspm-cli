import { Plugin } from "rollup";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fetch } from "@jspm/generator";
import { Flags } from "../types";
import { getGenerator, JspmError } from "../utils";

const isValidUrl = (url: string) => {
  try {
    return Boolean(new URL(url));
  } catch (e) {
    return false;
  }
};

export const RollupImportmapPlugin = async (flags: Flags): Promise<Plugin> => {
  /*
    We need to load the importmap from local into the generator.
    And then run a re-install. So, the generator uses the importmap
    to resolve any dependencies.
  */
  const generator = await getGenerator({ ...flags });
  await generator.reinstall();

  return {
    name: "rollup-importmap-plugin",
    resolveId: async (id: string, importer: string) => {
      if (isValidUrl(id)) {
        const url = new URL(id);
        if (url.protocol === "deno:" || url.protocol === "node:") {
          return { id, external: true };
        }
      }

      try {
        const resolved = generator.importMap.resolve(id, importer);
        return { id: resolved };
      } catch (err) {
        console.warn(
          `Failed to resolve ${id} from ${importer}, makring as external`
        );
        return { id, external: true };
      }
    },
    load: async (id: string) => {
      try {
        const url = new URL(id);
        if (url.protocol === "file:") {
          const filePath =
            path.extname(url.pathname) === ""
              ? `${url.pathname}.js`
              : url.pathname;

          return await fs.readFile(pathToFileURL(filePath), "utf-8");
        }

        if (url.protocol === "https:") {
          const response = await fetch(id);
          return await response.text();
        }
      } catch (err) {
        throw new JspmError(
          `\n Unsupported protocol ${id} \n ${err.message} \n`
        );
      }
    },
  };
};
