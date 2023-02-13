import type { Generator } from "@jspm/generator";

export interface Flags {
  resolution?: string;
  env?: string;
  map?: string;
  output?: string;
  provider?: string;
  force?: boolean;
  stdout?: boolean;
  preload?: boolean;
  integrity?: boolean;
  compact?: boolean;
}

export type InjectFlags = Flags & {
  packages: string[];
};

export type IImportMap = ReturnType<Generator["getMap"]>;

// Wrapper around IImportMap that includes JSPM-specific import map fields:
export type IImportMapFile = IImportMap & { env?: string[]; provider?: string };
