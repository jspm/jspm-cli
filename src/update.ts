import { Generator } from '@jspm/generator'
import type { Flags } from './types'
import { getEnv, getInputMap, getResolutions, startLoading, stopLoading, writeMap } from './utils'

export default async function update(packages: string[], flags: Flags) {
  const inputMap = await getInputMap(flags)
  const env = getEnv(flags, true, inputMap)
  startLoading(
    `Updating${packages.length ? ` ${packages.join(', ')}` : ''}`,
  )
  const generator = new Generator({
    env,
    inputMap,
    resolutions: getResolutions(flags),
  })
  await generator.update(packages)
  stopLoading()
  await writeMap(generator.getMap(), flags)
  return generator.getMap()
}
