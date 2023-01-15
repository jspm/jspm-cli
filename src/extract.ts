import { Generator } from '@jspm/generator'
import type { Flags } from './types'
import { cwdUrl, getEnv, getInputMap, getInputMapUrl, getResolutions, inputMapExists, startLoading, stopLoading, writeMap } from './utils'

export default async function extract(packages: string[], flags: Flags) {
  if (!(await inputMapExists(flags))) {
    console.error('No input map found, nothing to extract.')
    return {}
  }
  const inputMap = await getInputMap(flags)
  const env = getEnv(flags, true, inputMap)
  startLoading(
    `Extracting ${packages.join(', ')}`,
  )
  const generator = new Generator({
    env,
    inputMap,
    baseUrl: cwdUrl,
    mapUrl: getInputMapUrl(flags),
    resolutions: getResolutions(flags),
  })

  const { map } = await generator.extractMap(packages)
  stopLoading()
  await writeMap(map, flags, true)
  return map
}
