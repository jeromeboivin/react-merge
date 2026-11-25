/** A line ending as found in a file. '' marks a last line with no terminator. */
export type Eol = '\n' | '\r\n' | '\r' | ''

export interface Line {
  text: string
  eol: Eol
}

/** The line-ending styles a user can pick for the merge file (the `-le` option). */
export type LineEndingStyle = 'unix' | 'win' | 'mac'

export const EOL_OF_STYLE: Record<LineEndingStyle, Exclude<Eol, ''>> = {
  unix: '\n',
  win: '\r\n',
  mac: '\r'
}

export const LINE_ENDING_LABELS: Record<LineEndingStyle, string> = {
  unix: 'UNIX',
  win: 'Windows',
  mac: 'Mac'
}

const LINE_RE = /\r\n|\r|\n/g

/**
 * Split text into lines, keeping each line's own terminator. A trailing terminator does not
 * produce an extra empty line: "a\n" is one line, "" is no line at all.
 */
export function splitLines(text: string): Line[] {
  const lines: Line[] = []
  let start = 0
  LINE_RE.lastIndex = 0
  for (let m = LINE_RE.exec(text); m !== null; m = LINE_RE.exec(text)) {
    lines.push({ text: text.slice(start, m.index), eol: m[0] as Eol })
    start = m.index + m[0].length
  }
  if (start < text.length) lines.push({ text: text.slice(start), eol: '' })
  return lines
}

/** Split text typed or pasted by the user into bare line texts (always at least one). */
export function splitTyped(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
}

export function joinLines(lines: readonly Line[]): string {
  let out = ''
  for (const l of lines) out += l.text + l.eol
  return out
}

/**
 * Serialize lines with one line ending everywhere. Every line but the last gets `eol` even if it
 * had none (it may come from the end of another file); the last keeps "no terminator" if it had.
 */
export function joinWithEol(lines: readonly Line[], eol: Exclude<Eol, ''>): string {
  const parts: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const last = i === lines.length - 1
    parts.push(l.text, last && l.eol === '' ? '' : eol)
  }
  return parts.join('')
}

/** The dominant line ending style of a file, or null when it has no line terminator. */
export function detectLineEnding(lines: readonly Line[]): LineEndingStyle | null {
  let unix = 0
  let win = 0
  let mac = 0
  for (const l of lines) {
    if (l.eol === '\n') unix++
    else if (l.eol === '\r\n') win++
    else if (l.eol === '\r') mac++
  }
  if (unix + win + mac === 0) return null
  if (win >= unix && win >= mac) return 'win'
  if (mac > unix) return 'mac'
  return 'unix'
}

export function systemLineEnding(platform: string): LineEndingStyle {
  return platform === 'win32' ? 'win' : 'unix'
}
