import type { Generator } from "@jspm/generator";

export interface Flags {
  resolution?: string;
  env?: string;
  map?: string;
  output?: string;
  provider?: string;
  stdout?: boolean;
  preload?: boolean;
  integrity?: boolean;
  compact?: boolean;
  silent?: boolean;
}

export type InjectFlags = Flags & {
  packages: string[];
};

export type IImportMap = ReturnType<Generator["getMap"]>;

// JSPM adds a non-standard "env" field to import maps, which is used to
// specify the environment that the import map was generated for. This is a
// deliberate choice to make sure users are aware of the fact that import maps
// are environment-specific:
export type IImportMapFile = IImportMap & { env?: string[] };
