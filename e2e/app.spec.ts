import { expect, test } from '@playwright/test'
import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { launch, quit, ROOT, tempFiles } from './helpers'

const BASE = `#include <stdio.h>

int add(int a, int b) {
    return a + b;
}

int main(void) {
    int x = 1;
    int y = 2;
    printf("%d\\n", add(x, y));
    return 0;
}
`
const LEFT = BASE.replace('#include <stdio.h>\n', '#include <stdio.h>\n#include <stdlib.h>\n')
  .replace('int x = 1;', 'int x = 10;')
  .replace('printf("%d', 'printf("sum=%d')
const RIGHT = BASE.replace('int x = 1;', 'int x = 5;').replace(
  '    return a + b;\n}\n',
  '    return a + b;\n}\n\nint sub(int a, int b) {\n    return a - b;\n}\n'
)

test('3-way merge: resolve the conflict, type, undo, save', async () => {
  const f = tempFiles({ 'base.c': BASE, 'left.c': LEFT, 'right.c': RIGHT, 'out.c': '' })
  const { app, page } = await launch([
    '-nm',
    'OUT',
    f['base.c'],
    f['left.c'],
    f['right.c'],
    f['out.c']
  ])
  try {
    await expect(page.getByTestId('conflicts')).toHaveText('Conflicts: 1')
    await expect(page.getByTestId('diff-count')).toHaveText('4 diffs')
    await expect(page.getByTestId('left-stats')).toHaveText('Differences from base: 2')
    await expect(page).toHaveTitle('OUT - React Merge')

    // Saving with an unresolved conflict asks first.
    await page.keyboard.press('Control+S')
    await expect(page.getByRole('dialog')).toContainText('conflicts have not been resolved')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    await page.keyboard.press('Control+4') // next conflict
    await page.locator('[data-chunk-kind="conflict"] [data-chunk-button$=":right"]').click()
    await expect(page.getByTestId('conflicts')).toHaveText('Conflicts: 0 (of 1)')

    // Type at the end of the merge result, then undo it.
    await page.locator('[data-pane="merge"]').click({ position: { x: 200, y: 10 } })
    await page.keyboard.press('Control+End')
    await page.keyboard.type('// typed')
    await page.keyboard.press('Control+Z')
    await page.keyboard.type('// end')

    await page.keyboard.press('Control+S')
    await expect.poll(() => readFileSync(f['out.c'], 'utf8')).toContain('// end')
    const expected =
      RIGHT.replace('#include <stdio.h>\n', '#include <stdio.h>\n#include <stdlib.h>\n').replace(
        'printf("%d',
        'printf("sum=%d'
      ) + '// end'
    expect(readFileSync(f['out.c'], 'utf8')).toBe(expected)
    await expect(page).toHaveTitle('OUT - React Merge')
  } finally {
    await quit(app)
  }
})

test('3-way merge: toggling sources keeps click order', async () => {
  const f = tempFiles({ b: 'a\nx\nz\n', l: 'a\nL\nz\n', r: 'a\nR\nz\n', m: '' })
  const { app, page } = await launch([f.b, f.l, f.r, f.m])
  try {
    await expect(page.getByTestId('conflicts')).toHaveText('Conflicts: 1')
    await page.locator('[data-chunk-button="1:right"]').click()
    await page.locator('[data-chunk-button="1:left"]').click()
    await page.keyboard.press('Control+S')
    await expect.poll(() => readFileSync(f.m, 'utf8')).toBe('a\nR\nL\nz\n')
    // Remove right again: only left stays.
    await page.locator('[data-chunk-button="1:right"]').click()
    await page.keyboard.press('Control+S')
    await expect.poll(() => readFileSync(f.m, 'utf8')).toBe('a\nL\nz\n')
  } finally {
    await quit(app)
  }
})

test('2-way diff: navigate, edit the right pane and save it', async () => {
  const f = tempFiles({ 'l.txt': 'one\ntwo\nthree\n', 'r.txt': 'one\nTWO\nthree\nfour\n' })
  const { app, page } = await launch([f['l.txt'], f['r.txt']])
  try {
    await expect(page.getByTestId('diff-count')).toHaveText('2 diffs')
    await expect(page).toHaveTitle('l.txt and r.txt - React Merge')
    await page.getByRole('button', { name: 'Edit file in right pane' }).click()
    await page.locator('[data-pane="right"]').click({ position: { x: 300, y: 10 } })
    await page.keyboard.press('Control+End')
    await page.keyboard.type('five')
    await page.keyboard.press('Control+S')
    await expect.poll(() => readFileSync(f['r.txt'], 'utf8')).toBe('one\nTWO\nthree\nfour\nfive')
    // Removing the differences re-diffs live.
    await page.keyboard.press('Control+A')
    await page.keyboard.type('one\ntwo\nthree\n')
    await page.keyboard.press('Backspace')
    await expect(page.getByTestId('diff-count')).toHaveText('0 diffs')
  } finally {
    await quit(app)
  }
})

test('closing with unsaved changes asks to save', async () => {
  const f = tempFiles({ b: 'a\n', l: 'a\nb\n', r: 'a\nc\n', m: '' })
  const { app, page } = await launch([f.b, f.l, f.r, f.m])
  try {
    await page.locator('[data-pane="merge"]').click({ position: { x: 200, y: 10 } })
    await page.keyboard.type('X')
    await page.keyboard.press('Control+W')
    await expect(page.getByRole('dialog')).toContainText('Do you want to save your changes')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  } finally {
    await quit(app)
  }
})

test('comparison methods change what counts as a difference', async () => {
  const f = tempFiles({ l: 'a b\r\nc\n', r: 'a\tb\nc\n' })
  const { app, page } = await launch(['-da', f.l, f.r])
  try {
    await expect(page.getByTestId('diff-count')).toHaveText('1 diff')
    await page.getByTitle('Click to change the comparison method').click()
    await page
      .getByRole('menuitemradio', { name: 'Ignore line ending and white space length differences' })
      .click()
    await expect(page.getByTestId('diff-count')).toHaveText('0 diffs')
  } finally {
    await quit(app)
  }
})

test('command line errors and help', () => {
  const electronBin = join(ROOT, 'node_modules/electron/dist/electron')
  const bad = spawnSync(electronBin, ['--no-sandbox', ROOT, 'only-one-file'], { encoding: 'utf8' })
  expect(bad.status).toBe(0)
  expect(bad.stderr).toContain('At least two files are needed')
  const help = spawnSync(electronBin, ['--no-sandbox', ROOT, '-h'], { encoding: 'utf8' })
  expect(help.status).toBe(0)
  expect(help.stdout).toContain('base left right [merge]')
})

test('groups changes and shows ignored white space as expected', async () => {
  const f = tempFiles({
    'left.c': LEFT,
    'right.c': RIGHT.replace('    return a + b;', '\treturn a + b;')
  })
  let { app, page } = await launch([f['left.c'], f['right.c']])
  try {
    // The whitespace change and the added function form one change.
    await expect(page.getByTestId('diff-count')).toHaveText('4 diffs')
  } finally {
    await quit(app)
  }
  const g = tempFiles({ l: 'a\n    b\nc\n', r: 'a\nb\nd\n', b: 'a\nb\nc\n', m: '' })
  ;({ app, page } = await launch(['-dw', g.l, g.r]))
  try {
    await expect(page.getByTestId('diff-count')).toHaveText('1 diff')
    // Unchanged regions show the left text in both panes.
    await expect(page.locator('[data-pane="right"] .m-text').nth(1)).toHaveText('    b')
  } finally {
    await quit(app)
  }
  ;({ app, page } = await launch(['-dw', g.b, g.l, g.r, g.m]))
  try {
    // ...and the base text in a merge.
    await expect(page.locator('[data-pane="left"] .m-text').nth(1)).toHaveText('b')
  } finally {
    await quit(app)
  }
})
