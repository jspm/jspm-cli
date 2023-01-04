import { Generator } from '@jspm/generator'
import type { Flags } from './types'
import { getEnv, getInputMap, writeMap } from './utils'

export default async function uninstall(packages: string[], flags: Flags) {
  const generator = new Generator({
    inputMap: await getInputMap(flags),
    env: getEnv(flags),
  })
  console.error(`Uninstalling ${packages.join(', ')}...`)
  await generator.uninstall(packages)
  await writeMap(generator.getMap(), flags)
  return generator.getMap()
}
