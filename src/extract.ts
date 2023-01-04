import { Generator } from '@jspm/generator'
import type { Flags } from './types'
import { getEnv, getInputMap, getResolutions, writeMap } from './utils'

export default async function extract(packages: string[], flags: Flags) {
  const generator = new Generator({
    inputMap: await getInputMap(flags),
    env: getEnv(flags),
    resolutions: getResolutions(flags),
  })
  console.error(`Extracting ${packages.join(', ')}...`)
  const { map } = await generator.extractMap(packages)
  await writeMap(map, flags, true)
  return map
}
