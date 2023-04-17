import type { Generator } from "@jspm/generator";

export interface Flags {
  resolution?: string | string[];
  env?: string | string[];
  map?: string;
  output?: string;
  root?: string;
  provider?: string;
  stdout?: boolean;
  preload?: string;
  integrity?: boolean;
  compact?: boolean;
  freeze?: boolean;
  silent?: boolean;
  cache?: string;
}

export type IImportMap = ReturnType<Generator["getMap"]>;

// JSPM adds a non-standard "env" field to import maps, which is used to
// specify the environment that the import map was generated for. This is a
// deliberate choice to make sure users are aware of the fact that import maps
// are environment-specific:
export type IImportMapJspm = IImportMap & { env?: string[] };
