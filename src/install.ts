import { Generator } from '@jspm/generator'
import type { Flags } from './types'
import { getEnv, getInputMap, getResolutions, writeMap } from './utils'

export default async function install(packages: string[], flags: Flags) {
  const resolvedPackages = packages.map((p) => {
    if (!p.includes('='))
      return { target: p }
    const [alias, target] = p.split('=')
    return { alias, target }
  })

  const generator = new Generator({
    inputMap: await getInputMap(flags),
    env: getEnv(flags),
    resolutions: getResolutions(flags),
  })

  console.error(
    `Installing ${resolvedPackages.map(p => p.alias || p.target).join(', ')}`,
  )

  if (packages.length)
    await generator.install(packages)
  else await generator.reinstall()
  await writeMap(generator.getMap(), flags)
  return generator.getMap()
}
