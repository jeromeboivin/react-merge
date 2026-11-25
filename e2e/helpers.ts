import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { Preferences } from '../src/shared/ipc'

export const ROOT = resolve(__dirname, '..')

export function tempFiles(files: Record<string, string>): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'react-merge-e2e-'))
  const out: Record<string, string> = { dir }
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name)
    writeFileSync(p, content)
    out[name] = p
  }
  return out
}

export async function launch(
  args: string[],
  prefs: Partial<Preferences> = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  const userData = mkdtempSync(join(tmpdir(), 'react-merge-profile-'))
  writeFileSync(join(userData, 'preferences.json'), JSON.stringify(prefs))
  const app = await electron.launch({
    args: ['--no-sandbox', ROOT, ...args],
    env: { ...process.env, REACT_MERGE_USER_DATA: userData }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/** Quit without the unsaved-changes prompts (they would block app.close()). */
export async function quit(app: ElectronApplication): Promise<void> {
  await app
    .evaluate(({ app: a }) => {
      a.exit(0)
    })
    .catch(() => undefined)
}
