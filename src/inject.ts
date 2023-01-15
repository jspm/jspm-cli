import fs from 'fs/promises'
import { Generator } from '@jspm/generator'
import type { Flags } from './types'
import {
  cwdUrl,
  getEnv,
  getInputMap,
  getInputMapUrl,
  getResolutions,
  startLoading,
  stopLoading,
} from './utils'

const defaultHtmlTemplate = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>JSPM example</title>
  </head>
  <body>
  </body>
</html>`

const htmlExists = async (htmlFile: string) => {
  try {
    await fs.access(htmlFile)
    return true
  }
  catch (e) {
    return false
  }
}

export default async function inject(
  htmlFile: string,
  packages: string[],
  flags: Flags,
): Promise<string> {
  const inputMap = await getInputMap(flags)
  const env = getEnv(flags, true, inputMap)

  if (!(await htmlExists(htmlFile))) {
    console.warn(`Warning: HTML file ${htmlFile} does not exist, creating one`)
    await fs.writeFile(htmlFile, defaultHtmlTemplate, 'utf-8')
  }
  startLoading(
    `Injecting ${
      packages.length ? `${packages.join(', ')} ` : ''
    }into ${htmlFile}...`,
  )
  const generator = new Generator({
    env,
    inputMap,
    baseUrl: cwdUrl,
    mapUrl: getInputMapUrl(flags),
    resolutions: getResolutions(flags),
  })
  const trace = packages.length === 0
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

  stopLoading()
  if (flags.stdout)
    console.log(output)
  else
    await fs.writeFile(flags.output ?? htmlFile, output, 'utf-8')

  return output
}
