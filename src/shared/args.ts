import { findCharset } from './charsets'
import type { ComparisonMethod } from './merge/compare'
import type { LineEndingStyle } from './merge/text'

export const APP_NAME = 'React Merge'
export const CLI_NAME = 'react-merge'

/** What the command line asks for. Unset options fall back to the preferences. */
export interface LaunchOptions {
  base?: string
  left?: string
  right?: string
  merge?: string
  labels: { base?: string; left?: string; right?: string; merge?: string }
  comparison?: ComparisonMethod
  tabWidth?: number
  lineEnding?: LineEndingStyle
  charset?: string
}

export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; errors: string[] }
  | { kind: 'run'; options: LaunchOptions }

const DIFF_FLAGS: Record<string, ComparisonMethod> = {
  '-da': 'all',
  '-dl': 'lineEndings',
  '-db': 'whitespaceLength',
  '-dw': 'whitespace'
}

const LINE_ENDINGS: Record<string, LineEndingStyle> = { unix: 'unix', win: 'win', mac: 'mac' }

const LABEL_FLAGS = { '-nb': 'base', '-nl': 'left', '-nr': 'right', '-nm': 'merge' } as const

/**
 * Parse the command line. File layouts:
 * `left right`, `base left right` and `base left right merge`.
 * `fileExists` is injected so the parser stays testable.
 */
export function parseArgs(argv: readonly string[], fileExists: (p: string) => boolean): ParsedArgs {
  const errors: string[] = []
  const files: string[] = []
  const options: LaunchOptions = { labels: {} }
  const diffFlags: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = (): string | undefined => {
      if (i + 1 >= argv.length) {
        errors.push(`'${a}' needs a value.`)
        return undefined
      }
      i++
      return argv[i]
    }
    if (a === '-h' || a === '--help' || a === '-?') return { kind: 'help' }
    if (a === '-V' || a === '--version') return { kind: 'version' }
    if (a in DIFF_FLAGS) {
      diffFlags.push(a)
      options.comparison = DIFF_FLAGS[a]
    } else if (a === '-tw') {
      const v = value()
      if (v === undefined) continue
      const n = Number(v)
      if (!/^\d+$/.test(v) || n < 1 || n > 32) errors.push(`'${v}' is not a valid tab spacing.`)
      else options.tabWidth = n
    } else if (a === '-le') {
      const v = value()
      if (v === undefined) continue
      const le = LINE_ENDINGS[v.toLowerCase()] as LineEndingStyle | undefined
      if (!le) errors.push(`'${v}' is not a valid line ending.`)
      else options.lineEnding = le
    } else if (a === '-C') {
      const v = value()
      if (v === undefined) continue
      const cs = findCharset(v)
      if (!cs) errors.push(`'${v}' is not a valid character encoding.`)
      else options.charset = cs.id
    } else if (a in LABEL_FLAGS) {
      const v = value()
      if (v !== undefined) options.labels[LABEL_FLAGS[a as keyof typeof LABEL_FLAGS]] = v
    } else if (a.startsWith('-') && a.length > 1) {
      errors.push(`'${a}' is not a valid option.`)
    } else {
      files.push(a)
    }
  }

  if (diffFlags.length > 1)
    errors.push(
      `${diffFlags.join(', ')}: these comparison options cannot be combined; use only one.`
    )
  if (files.length === 1)
    errors.push(`At least two files are needed (${APP_NAME} opens 0, 2, 3 or 4 files).`)
  if (files.length > 4) errors.push('Too many files: at most 4 can be given.')

  // Every file must exist, including the merge result.
  for (const f of files.slice(0, 4))
    if (!fileExists(f)) errors.push(`'${f}' is not a file (or does not exist).`)

  if (errors.length > 0) return { kind: 'error', errors }

  if (files.length === 2) {
    options.left = files[0]
    options.right = files[1]
  } else if (files.length >= 3) {
    options.base = files[0]
    options.left = files[1]
    options.right = files[2]
    if (files.length === 4) options.merge = files[3]
  }
  return { kind: 'run', options }
}

export function usage(): string {
  return `Usage:
  ${CLI_NAME} [options]                          open the file chooser
  ${CLI_NAME} [options] left right               compare two files
  ${CLI_NAME} [options] base left right [merge]  merge left and right changes to base
  ${CLI_NAME} -h                                 show this help
  ${CLI_NAME} -V                                 show the version

Comparison (pick one):
  -da   compare everything, including line endings and white space
  -dl   ignore line ending differences (default)
  -db   ignore line endings and the length of white space runs
  -dw   ignore line endings and all white space

Text:
  -tw <n>        tab width
  -le <style>    line endings of the merge file: unix, win or mac
  -C <charset>   character encoding of the files:
                   none (system), utf8, utf8-bom,
                   utf16, utf16-nobom, utf16be, utf16be-bom, utf16le, utf16le-bom,
                   utf32, utf32-nobom, utf32be, utf32be-bom, utf32le, utf32le-bom,
                   iso8859-1, winansi, macosroman, iso8859-15, cp850,
                   shiftjis, eucjp, iso8859-5, koi8-r, cp1251, cp949, cp936, cp950,
                   cp1253, iso8859-7

Labels shown instead of file names:
  -nb <label>   base     -nl <label>   left
  -nr <label>   right    -nm <label>   merge
`
}

export function errorReport(errors: readonly string[]): string {
  return `\nErrors: ${errors.join('\n')}\n\n\nUse '${CLI_NAME} -h' for more help.\n`
}
