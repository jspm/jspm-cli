import { Generator } from '@jspm/generator'
import type { Flags } from './types'
import { JspmError, getEnv, getInputMap, getResolutions, writeMap } from './utils'

export default async function traceInstall(packages: string[], flags: Flags) {
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
    `Tracing${
      resolvedPackages.length
        ? ` ${resolvedPackages
            .map(p => p.alias || p.target)
            .join(', ')}`
        : ''
    }...`,
  )
  if (!resolvedPackages.length)
    throw new JspmError('Trace install requires at least one module to trace.')
  await generator.traceInstall(resolvedPackages.map(p => p.target))
  await writeMap(generator.getMap(), flags)
  return generator.getMap()
}
