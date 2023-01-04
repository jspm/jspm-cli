import fs from 'fs/promises'
import type { Flags, IImportMap } from './types'

export class JspmError extends Error {
  jspmError = true
}

export async function writeMap(
  map: IImportMap,
  flags: Flags,
  defaultStdout = false,
) {
  const output = JSON.stringify(map, null, 2)
  if (!flags.output && (defaultStdout || flags.stdout)) {
    console.log(output)
  }
  else {
    const outfile = flags.output || flags.map || 'importmap.json'
    if (!outfile.endsWith('.json') && !outfile.endsWith('.importmap')) {
      throw new JspmError(
        'Extract will only write to ".json" or ".importmap" files. Use "jspm inject" for HTML injection.',
      )
    }
    await fs.writeFile(outfile, output)
    console.error(
      `%cOK: %cUpdated %c${outfile}`,
      'color: green',
      'color: black',
      'font-weight: bold',
    )
  }
}

export async function getInputMap(flags: Flags) {
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

export function getEnv(flags: Flags) {
  const env = ['development', 'browser', 'module']
  const envFlags = (flags.env || '').split(',').map(e => e.trim()).filter(Boolean)
  for (const name of envFlags) {
    switch (name) {
      case 'no-module':
      case 'no-node':
      case 'no-browser':
        env.splice(env.indexOf(name.slice(3)), 1)
        break
      case 'browser':
        env.splice(env.indexOf('node'), 1)
        env.push('browser')
        break
      case 'production':
        env.splice(env.indexOf('development'), 1)
        env.push('production')
        break
      case 'node':
        break
      case 'development':
      case 'module':
        break
      default:
        env.push(name)
        break
    }
  }
  return env
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
