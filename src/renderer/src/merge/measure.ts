/**
 * Pixel geometry of text in the editor font, matching how the browser lays out a `white-space:
 * pre` line with `tab-size`: each tab advances to the next multiple of tabWidth space widths.
 */
export class TextMeasurer {
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly cache = new Map<string, number>()
  readonly spaceWidth: number
  readonly tabPx: number

  constructor(
    readonly font: string,
    readonly tabWidth: number
  ) {
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
    this.ctx = canvas ? canvas.getContext('2d') : null
    if (this.ctx) this.ctx.font = font
    this.spaceWidth = this.charWidth(' ') || 7.8
    this.tabPx = this.spaceWidth * tabWidth
  }

  charWidth(ch: string): number {
    let w = this.cache.get(ch)
    if (w === undefined) {
      w = this.ctx ? this.ctx.measureText(ch).width : 7.8
      this.cache.set(ch, w)
    }
    return w
  }

  /** x of the boundary before column `col`. */
  xAt(text: string, col: number): number {
    let x = 0
    const end = Math.min(col, text.length)
    for (let i = 0; i < end; i++) {
      const c = text.charCodeAt(i)
      if (c === 9) x = (Math.floor(x / this.tabPx + 1e-6) + 1) * this.tabPx
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < end) {
        x += this.charWidth(text.slice(i, i + 2))
        i++
      } else x += this.charWidth(text[i])
    }
    return x
  }

  /** The column closest to x. */
  colAt(text: string, x: number): number {
    let pos = 0
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      let next: number
      let step = 1
      if (c === 9) next = (Math.floor(pos / this.tabPx + 1e-6) + 1) * this.tabPx
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
        next = pos + this.charWidth(text.slice(i, i + 2))
        step = 2
      } else next = pos + this.charWidth(text[i])
      if (x < (pos + next) / 2) return i
      pos = next
      i += step - 1
    }
    return text.length
  }

  width(text: string): number {
    return this.xAt(text, text.length)
  }
}

/** Word boundaries for Ctrl+arrows and double-click. */
const WORD = /[\p{L}\p{N}_]/u

export function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD.test(ch)
}

export function wordAt(text: string, col: number): [number, number] {
  let s = col
  let e = col
  const kind = (ch: string | undefined): number =>
    ch === undefined ? -1 : isWordChar(ch) ? 1 : /\s/.test(ch) ? 2 : 3
  const k = kind(text[col]) === -1 ? kind(text[col - 1]) : kind(text[col])
  while (s > 0 && kind(text[s - 1]) === k) s--
  while (e < text.length && kind(text[e]) === k) e++
  return [s, e]
}

export function nextWordCol(text: string, col: number): number {
  let i = col
  while (i < text.length && !isWordChar(text[i])) i++
  while (i < text.length && isWordChar(text[i])) i++
  return i
}

export function prevWordCol(text: string, col: number): number {
  let i = col
  while (i > 0 && !isWordChar(text[i - 1])) i--
  while (i > 0 && isWordChar(text[i - 1])) i--
  return i
}
