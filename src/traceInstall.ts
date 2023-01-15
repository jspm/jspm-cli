import { Generator } from '@jspm/generator'
import type { Flags } from './types'
import { JspmError, getEnv, getInputMap, getResolutions, startLoading, stopLoading, writeMap, cwdUrl, getInputMapUrl } from './utils'

export default async function traceInstall(packages: string[], flags: Flags) {
  const resolvedPackages = packages.map((p) => {
    if (!p.includes('='))
      return { target: p }
    const [alias, target] = p.split('=')
    return { alias, target }
  })
  const inputMap = await getInputMap(flags)
  const env = getEnv(flags, true, inputMap)
  startLoading(
    `Tracing${
      resolvedPackages.length
        ? ` ${resolvedPackages
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
  if (!resolvedPackages.length)
    throw new JspmError('Trace install requires at least one module to trace.')
  await generator.traceInstall(resolvedPackages.map(p => p.target))
  stopLoading()
  await writeMap(generator.getMap(), flags)
  return generator.getMap()
}
