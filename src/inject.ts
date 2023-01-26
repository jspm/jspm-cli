import fs from 'fs/promises'
import { pathToFileURL } from 'node:url'
import c from 'picocolors'
import { Generator } from '@jspm/generator'
import type { InjectFlags } from './types'
import {
  JspmError,
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
    <script type="importmap"></script>
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
  flags: InjectFlags,
): Promise<string> {
  const packages = (flags.packages ?? []).filter(x => x)
  const pins = packages.length > 0 ? packages : false
  const inputMap = await getInputMap(flags)
  const env = getEnv(flags, true, inputMap)

  if (!(await htmlExists(htmlFile))) {
    console.warn(`${c.cyan('Note:')} HTML file ${htmlFile} does not exist, creating one`)
    await fs.writeFile(htmlFile, defaultHtmlTemplate, 'utf-8')
  }
  startLoading(
    `Injecting ${
      Array.isArray(pins) ? `${pins.join(', ')} into` : 'traced import map for'
    } ${c.cyan(htmlFile)}...`,
  )
  const generator = new Generator({
    env,
    inputMap,
    baseUrl: cwdUrl,
    mapUrl: getInputMapUrl(flags),
    resolutions: getResolutions(flags),
  })

  let html: string
  try {
    html = await fs.readFile(htmlFile, 'utf-8')
  }
  catch (e) {
    throw new JspmError(`${c.cyan(htmlFile)} is not an existing file to inject`)
  }

  const output = await generator.htmlInject(html, {
    pins,
    trace: pins === false,
    htmlUrl: new URL(htmlFile, `${pathToFileURL(process.cwd())}/`).href,
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

  console.warn(
    `${c.green('Ok:')} Injected ${c.cyan(flags.output ?? htmlFile)}`,
  )

  return output
}
