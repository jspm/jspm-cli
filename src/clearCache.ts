import c from "picocolors";
import { clearCache as _clearCache } from "@jspm/generator";
import { Flags } from "./types";

export default async function clearCache(flags: Flags) {
  _clearCache();
  !flags.silent && console.warn(`${c.green("Ok:")} Cache cleared successfully`);
}
