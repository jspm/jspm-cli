import { Generator } from '@jspm/generator'
import type { Flags } from './types'
import { getEnv, getInputMap, startLoading, stopLoading, writeMap } from './utils'

export default async function uninstall(packages: string[], flags: Flags) {
  const inputMap = await getInputMap(flags)
  const env = getEnv(flags, true, inputMap)
  startLoading(`Uninstalling ${packages.join(', ')}`)
  const generator = new Generator({
    env,
    inputMap,
  })
  await generator.uninstall(packages)
  stopLoading()
  await writeMap(generator.getMap(), flags)
  return generator.getMap()
}
