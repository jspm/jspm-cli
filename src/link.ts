import { Generator } from '@jspm/generator'
import type { Flags } from './types'
import { JspmError, cwdUrl, getEnv, getInputMap, getInputMapUrl, getResolutions, inputMapExists, startLoading, stopLoading, writeMap } from './utils'

export default async function link(packages: string[], flags: Flags) {
  const resolvedModules = packages.map((p) => {
    if (!p.includes('='))
      return { target: p }
    const [alias, target] = p.split('=')
    return { alias, target }
  })
  if (!(await inputMapExists(flags))) {
    console.error('No input map found, creating one.')
    writeMap({}, flags, false, true)
  }

  const inputMap = await getInputMap(flags)
  const env = getEnv(flags, true, inputMap)
  startLoading(
    `Linking${
      resolvedModules.length
        ? ` ${resolvedModules
            .map(p => p.alias || p.target)
            .join(', ')}`
        : ''
    }`,
  )
  const generator = new Generator({
    env,
    inputMap,
    baseUrl: cwdUrl,
    mapUrl: getInputMapUrl(flags),
    resolutions: getResolutions(flags),
  })
  if (!resolvedModules.length)
    throw new JspmError('Trace install requires at least one module to trace.')
  await generator.traceInstall(resolvedModules.map(p => p.target))
  stopLoading()
  await writeMap(generator.getMap(), flags)
  return generator.getMap()
}
