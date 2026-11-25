import type { Line } from './text'

/**
 * How lines are compared (the `-da`, `-dl`, `-db`, `-dw` options):
 * - `all`: recognize line ending and white space differences
 * - `lineEndings`: ignore line ending differences (the default)
 * - `whitespaceLength`: also treat any run of white space as equal to any other
 * - `whitespace`: also ignore all white space
 */
export type ComparisonMethod = 'all' | 'lineEndings' | 'whitespaceLength' | 'whitespace'

export const COMPARISON_METHODS: readonly ComparisonMethod[] = [
  'all',
  'lineEndings',
  'whitespaceLength',
  'whitespace'
]

/** Long labels, as in the Comparison Method menu and the preferences. */
export const COMPARISON_LABELS: Record<ComparisonMethod, string> = {
  all: 'Recognize line ending and white space differences',
  lineEndings: 'Ignore line ending differences',
  whitespaceLength: 'Ignore line ending and white space length differences',
  whitespace: 'Ignore line ending and all white space differences'
}

/** Short labels for the status bar. */
export const COMPARISON_SHORT: Record<ComparisonMethod, string> = {
  all: 'Diff everything',
  lineEndings: 'Ignore line ending differences',
  whitespaceLength: 'Ignore white space length differences',
  whitespace: 'Ignore all white space differences'
}

const WS_RUN = /[ \t\f\v\u00a0\u3000]+/g

/** The string two lines are compared by. */
export function lineKey(line: Line, method: ComparisonMethod): string {
  switch (method) {
    case 'all':
      return line.text + line.eol
    case 'lineEndings':
      return line.text
    case 'whitespaceLength':
      return line.text.replace(WS_RUN, ' ')
    case 'whitespace':
      return line.text.replace(WS_RUN, '')
  }
}

export function isWhitespaceToken(s: string): boolean {
  WS_RUN.lastIndex = 0
  return s.length > 0 && s.replace(WS_RUN, '') === ''
}

/** Token comparison key for inline (within-line) differences; null means "ignore this token". */
export function tokenKey(token: string, method: ComparisonMethod): string | null {
  if (method === 'all' || method === 'lineEndings') return token
  if (isWhitespaceToken(token)) return method === 'whitespace' ? null : ' '
  return token
}

/**
 * Maps strings to small integers so the diff compares numbers. One interner must be shared by all
 * the sequences compared together.
 */
export class Interner {
  private readonly ids = new Map<string, number>()

  id(key: string): number {
    let id = this.ids.get(key)
    if (id === undefined) {
      id = this.ids.size
      this.ids.set(key, id)
    }
    return id
  }
}

export function lineIds(
  lines: readonly Line[],
  method: ComparisonMethod,
  interner: Interner
): Int32Array {
  const ids = new Int32Array(lines.length)
  for (let i = 0; i < lines.length; i++) ids[i] = interner.id(lineKey(lines[i], method))
  return ids
}
