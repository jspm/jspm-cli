import { Generator } from '@jspm/generator'
import type { Flags, IImportMapFile } from './types'
import { attachEnv, cwdUrl, getEnv, getInputMap, getInputMapUrl, getResolutions, startLoading, stopLoading, writeMap } from './utils'

export default async function install(packages: string[], flags: Flags) {
  const resolvedPackages = packages.map((p) => {
    if (!p.includes('='))
      return { target: p }
    const [alias, target] = p.split('=')
    return { alias, target }
  })

  const inputMap = await getInputMap(flags)
  const env = getEnv(flags, true, inputMap)

  const generator = new Generator({
    env: [...env],
    inputMap,
    baseUrl: cwdUrl,
    mapUrl: getInputMapUrl(flags),
    resolutions: getResolutions(flags),
  })

  startLoading(
    `Installing ${resolvedPackages.map(p => p.alias || p.target).join(', ')} (${env.join(', ')})`,
  )

  if (resolvedPackages.length)
    await generator.install(resolvedPackages)
  else await generator.reinstall()
  stopLoading()

  const map = generator.getMap() as IImportMapFile
  attachEnv(map, env)

  await writeMap(map, flags)
  return map
}
