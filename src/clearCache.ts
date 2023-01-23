import c from 'picocolors'
import { clearCache as _clearCache } from '@jspm/generator'

export default async function clearCache() {
  _clearCache()
  console.warn(`${c.green('Ok:')} Cache cleared successfully`)
}
