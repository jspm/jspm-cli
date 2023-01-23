import path from 'path'
import { pathToFileURL } from 'url'
import fs from 'fs/promises'
import c from 'picocolors'
import ora from 'ora'
import type { Flags, IImportMap, IImportMapFile } from './types'

export const cwdUrl = pathToFileURL(`${process.cwd()}/`)

export class JspmError extends Error {
  jspmError = true
}

export function wrapCommandAndRemoveStack(fn: Function) {
  return async (...args: any[]) => {
    try {
      await fn(...args)
    }
    catch (e) {
      stopLoading()
      process.exitCode = 1
      if (e instanceof JspmError || e?.jspmError) {
        console.error(`${c.red('Err:')} ${e.message}`)
        return
      }
      throw e
    }
  }
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
    const noEnvOutput = { ...map, env: undefined, provider: undefined }
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
    !silent && console.warn(
      `${c.green('Ok:')} Updated ${outfile}`,
    )
  }
}

export async function getInputMap(flags: Flags): Promise<IImportMap | IImportMapFile> {
  let inMap = '{}'
  try {
    inMap = await fs.readFile(flags.map || 'importmap.json', 'utf-8')
  }
  catch (e) {
    return {}
  }
  return JSON.parse(inMap)
}

export function getInputMapUrl(flags: Flags) {
  const absoluteMapPath = path.resolve(flags.map || 'importmap.json')
  return pathToFileURL(absoluteMapPath)
}

const excludeDefinitions = {
  production: ['development'],
  development: ['production'],
  node: ['browser', 'deno'],
  deno: ['node', 'browser'],
  browser: ['node', 'deno'],
}
function removeEnvs(env: string[], removeEnvs: string[]) {
  for (const removeEnv of removeEnvs) {
    if (env.includes(removeEnv))
      env.splice(env.indexOf(removeEnv), 1)
  }
  return env.sort()
}
function addEnvs(env: string[], newEnvs: string[]) {
  let excludeEnvs = []
  for (const newEnv of newEnvs) {
    if (!env.includes(newEnv))
      env.push(newEnv)
    const excludes = excludeDefinitions[newEnv]
    if (excludes)
      excludeEnvs = excludeEnvs.concat(excludes)
  }
  for (const exclude of excludeEnvs) {
    if (env.includes(exclude) && !newEnvs.includes(exclude))
      env.splice(env.indexOf(exclude), 1)
  }
  return env.sort()
}

export function getEnv(flags: Flags, log: boolean, inputMap: IImportMapFile) {
  const envFlags = Array.isArray(flags.env) ? flags.env : (flags.env || '').split(',').map(e => e.trim()).filter(Boolean)
  let env = inputMap.env || ['development', 'browser', 'module']
  env = removeEnvs(env, envFlags.filter(env => env.startsWith('no-')))
  env = addEnvs(env, envFlags.filter(env => !env.startsWith('no-')))

  return removeNonStaticEnvKeys(env)
}

export function getProvider(flags: Flags) {
  return flags.provider || 'jspm'
}

function removeNonStaticEnvKeys(env: string[]) {
  return env.filter(e => e !== 'import' && e !== 'require' && e !== 'default')
}

export function attachEnv(map: any, env: string[] = []) {
  map.env = removeNonStaticEnvKeys(env)
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
