import fs from 'fs/promises'
import { Generator } from '@jspm/generator'
import type { Flags } from './types'
import {
  getEnv,
  getInputMap,
  getResolutions,
} from './utils'

export default async function inject(
  htmlFile: string,
  packages: string[],
  flags: Flags,
) {
  const generator = new Generator({
    inputMap: await getInputMap(flags),
    env: getEnv(flags),
    resolutions: getResolutions(flags),
  })

  const trace = packages.length === 0
  console.error(
    `Injecting ${
      packages.length ? `${packages.join(', ')} ` : ''
    }into ${htmlFile}...`,
  )

  const html = await fs.readFile(htmlFile, 'utf-8')

  const output = await generator.htmlInject(html, {
    pins: packages,
    trace,
    htmlUrl: new URL(htmlFile, `file:///${process.cwd().replace(/\\/g, '/')}`)
      .href,
    comment: false,
    preload: flags.preload,
    integrity: flags.integrity,
    whitespace: !flags.compact,
  })

  if (flags.stdout)
    console.log(output)
  else
    await fs.writeFile(htmlFile, output, 'utf-8')

  return output
}
