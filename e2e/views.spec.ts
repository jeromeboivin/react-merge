import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { launch, quit, ROOT, tempFiles } from './helpers'

const SHOTS = join(ROOT, 'test-results', 'screens')
mkdirSync(SHOTS, { recursive: true })

const lines = (n: number, f: (i: number) => string): string =>
  Array.from({ length: n }, (_, i) => f(i) + '\n').join('')

async function scrollTop(page: Page, pane: string): Promise<number> {
  return page.locator(`[data-pane="${pane}"]`).evaluate((el) => el.scrollTop)
}

test('scrolling one pane keeps the other on the matching lines', async () => {
  const left = lines(300, (i) => `line ${i}`)
  // 40 extra lines inserted after line 100 on the right.
  const right =
    lines(100, (i) => `line ${i}`) +
    lines(40, (i) => `new ${i}`) +
    lines(200, (i) => `line ${i + 100}`)
  const f = tempFiles({ 'l.txt': left, 'r.txt': right })
  const { app, page } = await launch([f['l.txt'], f['r.txt']])
  try {
    await expect(page.getByTestId('diff-count')).toHaveText('1 diff')
    const lh = await page.locator('[data-pane="left"]').evaluate((el) => {
      const row = el.querySelector('.m-text')?.parentElement
      return row ? row.getBoundingClientRect().height : 0
    })
    // Scroll the left pane well past the insertion.
    await page.locator('[data-pane="left"]').evaluate((el, y) => {
      el.scrollTop = y
    }, 180 * lh)
    await expect.poll(() => scrollTop(page, 'right')).toBeGreaterThan(0)
    const l = await scrollTop(page, 'left')
    const r = await scrollTop(page, 'right')
    // Past the insertion, the right pane is 40 lines further down (within a line of rounding).
    expect(Math.abs((r - l) / lh - 40)).toBeLessThan(1.5)
    // Back at the top, both are at the top.
    await page.locator('[data-pane="right"]').evaluate((el) => {
      el.scrollTop = 0
    })
    await expect.poll(() => scrollTop(page, 'left')).toBe(0)
  } finally {
    await quit(app)
  }
})

test('screens: views, themes and dialogs', async () => {
  const base = `function total(items) {\n  let sum = 0\n  for (const it of items) sum += it.price\n  return sum\n}\n\nexport { total }\n`
  const left = base
    .replace('let sum = 0', 'let sum = 0 // running total')
    .replace('it.price', 'it.price * it.qty')
  const right = base
    .replace('it.price', 'it.cost')
    .replace('export { total }', 'export { total, VERSION }\nconst VERSION = 2')
  const f = tempFiles({ 'base.js': base, 'left.js': left, 'right.js': right, 'out.js': '' })
  for (const theme of ['light', 'dark'] as const) {
    const { app, page } = await launch([f['base.js'], f['left.js'], f['right.js'], f['out.js']], {
      theme
    })
    try {
      await expect(page.getByTestId('conflicts')).toHaveText('Conflicts: 1')
      await page.waitForTimeout(400) // syntax highlighting is asynchronous
      await page.screenshot({ path: join(SHOTS, `merge-${theme}.png`) })
      await page.keyboard.press('Control+F')
      await page.getByLabel('Find:').fill('sum')
      await page.keyboard.press('Enter')
      await page.screenshot({ path: join(SHOTS, `find-${theme}.png`) })
    } finally {
      await quit(app)
    }
  }
  const { app, page } = await launch([f['left.js'], f['right.js']], {
    theme: 'light',
    singlePane: true,
    showWhitespace: true
  })
  try {
    await expect(page.getByTestId('diff-count')).toHaveText('2 diffs')
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(SHOTS, 'unified.png') })
    await page.keyboard.press('Control+N')
    await page.screenshot({ path: join(SHOTS, 'compare-dialog.png') })
    await page.keyboard.press('Escape')
  } finally {
    await quit(app)
  }
})
