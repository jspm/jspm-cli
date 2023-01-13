import { Generator } from '@jspm/generator'
import type { Flags, IImportMapFile } from './types'
import { attachEnv, getEnv, getInputMap, getResolutions, inputMapExists, startLoading, stopLoading, writeMap } from './utils'

export default async function install(packages: string[], flags: Flags) {
  const resolvedPackages = packages.map((p) => {
    if (!p.includes('='))
      return { target: p }
    const [alias, target] = p.split('=')
    return { alias, target }
  })

  if (!(await inputMapExists(flags))) {
    if (resolvedPackages.length === 0)
      console.warn('Warning: No packages provided to install, creating an empty importmap')
    writeMap({}, flags, false, true)
  }

  const inputMap = await getInputMap(flags)
  const env = getEnv(flags, true, inputMap)

  const generator = new Generator({
    env,
    inputMap,
    resolutions: getResolutions(flags),
  })

  startLoading(
    `Installing ${resolvedPackages.map(p => p.alias || p.target).join(', ')}`,
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
