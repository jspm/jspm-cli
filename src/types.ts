import type { Generator } from '@jspm/generator'

export interface Flags {
  resolution?: string
  env?: string
  map?: string
  output?: string
  provider?: string
  force?: boolean
  stdout?: boolean
  preload?: boolean
  integrity?: boolean
  compact?: boolean
}

export type IImportMap = ReturnType<Generator['getMap']>

export type IImportMapFile = IImportMap & { env?: string[]; provider?: string }
