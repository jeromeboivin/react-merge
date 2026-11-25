import { Interner, tokenKey, type ComparisonMethod } from './compare'
import type { Range } from './diff'
import { diffSequences } from './myers'
import type { Line } from './text'

/** A highlighted span of changed characters on one line: [start, end) in UTF-16 units. */
export interface InlineSpan {
  start: number
  end: number
}

/** Changed spans keyed by line index. */
export type InlineMap = Map<number, InlineSpan[]>

interface Token {
  line: number
  start: number
  end: number
  key: string | null
}

const TOKEN_RE = /[\p{L}\p{N}_]+|[^\S\n]+|[^\p{L}\p{N}_\s]/gu

/** Above this many tokens in one chunk, inline differences are skipped (too slow, not useful). */
export const MAX_INLINE_TOKENS = 20_000

function tokenize(
  lines: readonly Line[],
  range: Range,
  method: ComparisonMethod,
  out: Token[]
): boolean {
  for (let li = range.start; li < range.end; li++) {
    const text = lines[li].text
    TOKEN_RE.lastIndex = 0
    for (let m = TOKEN_RE.exec(text); m !== null; m = TOKEN_RE.exec(text)) {
      out.push({
        line: li,
        start: m.index,
        end: m.index + m[0].length,
        key: tokenKey(m[0], method)
      })
      if (out.length > MAX_INLINE_TOKENS) return false
    }
    out.push({ line: li, start: text.length, end: text.length, key: '\n' })
  }
  return true
}

function addSpan(map: InlineMap, t: Token): void {
  if (t.end === t.start) return
  let spans = map.get(t.line)
  if (!spans) {
    spans = []
    map.set(t.line, spans)
  }
  const last = spans.length > 0 ? spans[spans.length - 1] : undefined
  if (last?.end === t.start) last.end = t.end
  else spans.push({ start: t.start, end: t.end })
}

/**
 * Token-level differences between the lines of one chunk on two sides. Both maps are keyed by
 * line index in their own file; results are added to `outA` / `outB`.
 */
export function inlineDiff(
  a: readonly Line[],
  ar: Range,
  b: readonly Line[],
  br: Range,
  method: ComparisonMethod,
  outA: InlineMap,
  outB: InlineMap
): void {
  if (ar.start === ar.end || br.start === br.end) return
  const ta: Token[] = []
  const tb: Token[] = []
  if (!tokenize(a, ar, method, ta) || !tokenize(b, br, method, tb)) return
  // Ignored tokens (white space under -dw) take no part in the comparison.
  const ka = ta.filter((t) => t.key !== null)
  const kb = tb.filter((t) => t.key !== null)
  const interner = new Interner()
  const ia = Int32Array.from(ka, (t) => interner.id(t.key ?? ''))
  const ib = Int32Array.from(kb, (t) => interner.id(t.key ?? ''))
  for (const h of diffSequences(ia, ib, { slide: false })) {
    for (let k = h.aStart; k < h.aEnd; k++) addSpan(outA, ka[k])
    for (let k = h.bStart; k < h.bEnd; k++) addSpan(outB, kb[k])
  }
}

export function mergeInlineMaps(into: InlineMap, from: InlineMap): void {
  for (const [line, spans] of from) {
    const existing = into.get(line)
    if (!existing) {
      into.set(
        line,
        spans.map((s) => ({ ...s }))
      )
      continue
    }
    const all = [...existing, ...spans].sort((x, y) => x.start - y.start)
    const merged: InlineSpan[] = []
    for (const s of all) {
      const last = merged.length > 0 ? merged[merged.length - 1] : undefined
      if (last && s.start <= last.end) last.end = Math.max(last.end, s.end)
      else merged.push({ ...s })
    }
    into.set(line, merged)
  }
}
