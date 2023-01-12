import fs from 'fs/promises'
import ora from 'ora'
import type { Flags, IImportMap, IImportMapFile } from './types'

export class JspmError extends Error {
  jspmError = true
}

export async function writeMap(
  map: IImportMapFile,
  flags: Flags,
  defaultStdout = false,
  silent = false,
) {
  const env = map.env
  delete map.env
  // `env` appears at the top
  map = { env, ...map } as IImportMapFile

  if (!flags.output && (defaultStdout || flags.stdout) && !silent) {
    const noEnvOutput = { ...map, env: undefined }
    console.log(JSON.stringify(noEnvOutput, null, 2))
  }
  else {
    const output = JSON.stringify(map, null, 2)
    const outfile = flags.output || flags.map || 'importmap.json'
    if (!outfile.endsWith('.json') && !outfile.endsWith('.importmap')) {
      throw new JspmError(
        'Extract will only write to ".json" or ".importmap" files. Use "jspm inject" for HTML injection.',
      )
    }
    await fs.writeFile(outfile, output)
    !silent && console.error(
      `OK: Updated ${outfile}`,
    )
  }
}

export async function getInputMap(flags: Flags): Promise<IImportMap | IImportMapFile> {
  let inMap = '{}'
  try {
    inMap = await fs.readFile(flags.map || 'importmap.json', 'utf-8')
  }
  catch (e) {
    if (flags.map)
      throw e
    return {}
  }
  return JSON.parse(inMap)
}

export async function inputMapExists(flags: Flags) {
  try {
    await fs.access(flags.map)
    return true
  }
  catch (e) {
    return false
  }
}

export function getEnv(flags: Flags, log: boolean, inputMap: IImportMapFile) {
  let env = inputMap.env || ['development', 'browser', 'module']
  const envFlags = (flags.env || '').split(',').map(e => e.trim()).filter(Boolean)
  for (const name of envFlags) {
    switch (name) {
      case 'production':
        env.splice(env.indexOf('development'), 1)
        env.push('production')
        break
      case 'browser':
        env.splice(env.indexOf('node'), 1)
        env.push('browser')
        break
      case 'node':
        env.splice(env.indexOf('browser'), 1)
        env.push(name)
        break
      case 'development':
      case 'module':
        break
      default:
        if (name.startsWith('no-'))
          env.splice(env.indexOf(name.slice(3)), 1)
        else
          env.push(name)
        break
    }
  }
  env = [...new Set(env)]

  if (log)
    console.error(`Environments: ${JSON.stringify(env)}`)

  return env
}

export function attachEnv(map: any, env: string[] = []) {
  map.env = env
}
export function detachEnv(map: any) {
  return { ...map, env: undefined }
}

export function getResolutions(flags: Flags): Record<string, string> {
  if (!flags.resolution)
    return
  const resolutions = flags.resolution.split(',').map(r => r.trim())
  return Object.fromEntries(
    resolutions.map((resolution) => {
      if (!resolution.includes('=')) {
        throw new JspmError(
          'Resolutions must be mappings from aliases to targets, for example of the form "--resolution pkg=x.y.z"',
        )
      }
      return resolution.split('=')
    }),
  )
}

const loading = ora({ spinner: 'dots' })

export function startLoading(text: string) {
  loading.start(text)
}
export function stopLoading() {
  loading.stop()
}
