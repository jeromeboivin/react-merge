import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { defaultPreferences, THEME_IDS, type Preferences } from '../shared/ipc'

const file = (): string => join(app.getPath('userData'), 'preferences.json')

let cache: Preferences | null = null

export async function loadPrefs(): Promise<Preferences> {
  if (cache) return cache
  const defaults = defaultPreferences(process.platform)
  try {
    const raw = JSON.parse(await fs.readFile(file(), 'utf8')) as Partial<Preferences>
    cache = { ...defaults, ...pick(raw, defaults) }
  } catch {
    cache = defaults
  }
  return cache
}

/** Keep only known keys whose type matches the default's. */
function pick(raw: Partial<Preferences>, defaults: Preferences): Partial<Preferences> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (k in defaults && typeof v === typeof defaults[k as keyof Preferences]) out[k] = v
  }
  if (typeof out.theme === 'string' && !(THEME_IDS as readonly string[]).includes(out.theme))
    delete out.theme
  return out
}

export async function savePrefs(patch: Partial<Preferences>): Promise<Preferences> {
  const current = await loadPrefs()
  cache = { ...current, ...pick(patch, current) }
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(file(), JSON.stringify(cache, null, 2))
  return cache
}
