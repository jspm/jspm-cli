import { Generator } from '@jspm/generator'
import type { Flags } from './types'
import { getEnv, getInputMap, getResolutions, writeMap } from './utils'

export default async function update(packages: string[], flags: Flags) {
  const generator = new Generator({
    inputMap: await getInputMap(flags),
    env: getEnv(flags),
    resolutions: getResolutions(flags),
  })
  console.error(
    `Updating${packages.length ? ` ${packages.join(', ')}` : ''}...`,
  )
  await generator.update(packages)
  await writeMap(generator.getMap(), flags)
  return generator.getMap()
}
