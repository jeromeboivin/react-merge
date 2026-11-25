import type { LoadedFile } from '../../../shared/ipc'
import type { ComparisonMethod } from '../../../shared/merge/compare'
import {
  diff2,
  diff3,
  mergeStats,
  type DiffChunk,
  type MergeChunk,
  type MergeStats,
  type Range,
  type Source
} from '../../../shared/merge/diff'
import {
  buildMergeDoc,
  buildPlainDoc,
  EditDoc,
  type DocLine,
  type MergeFiles
} from '../../../shared/merge/doc'
import {
  inlineDiff,
  mergeInlineMaps,
  type InlineMap,
  type InlineSpan
} from '../../../shared/merge/inline'
import {
  detectLineEnding,
  splitLines,
  type Line,
  type LineEndingStyle
} from '../../../shared/merge/text'
import type { LineDecor, PaneMarker } from './TextPane'

/** A loaded input file. */
export interface Side {
  path: string
  label: string
  file: LoadedFile
  lines: Line[]
  eol: LineEndingStyle | null
}

export function makeSide(path: string, label: string | undefined, file: LoadedFile): Side {
  const lines = splitLines(file.text)
  return { path, label: label ?? baseName(path), file, lines, eol: detectLineEnding(lines) }
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

export interface DiffData {
  chunks: DiffChunk[]
  inlineL: InlineMap
  inlineR: InlineMap
}

export function computeDiff(
  left: readonly Line[],
  right: readonly Line[],
  method: ComparisonMethod
): DiffData {
  const chunks = diff2(left, right, method)
  const inlineL: InlineMap = new Map()
  const inlineR: InlineMap = new Map()
  for (const c of chunks)
    if (!c.equal) inlineDiff(left, c.left, right, c.right, method, inlineL, inlineR)
  return { chunks, inlineL, inlineR }
}

export interface MergeData {
  chunks: MergeChunk[]
  stats: MergeStats
  inline: Record<Source, InlineMap>
}

export function computeMerge(files: MergeFiles, method: ComparisonMethod): MergeData {
  const chunks = diff3(files.base, files.left, files.right, method)
  const inline: Record<Source, InlineMap> = { base: new Map(), left: new Map(), right: new Map() }
  for (const c of chunks) {
    if (c.kind === 'equal') continue
    for (const side of ['left', 'right'] as const) {
      if (c.kind === side || c.kind === 'both' || c.kind === 'conflict') {
        const baseMap: InlineMap = new Map()
        inlineDiff(files.base, c.base, files[side], c[side], method, baseMap, inline[side])
        mergeInlineMaps(inline.base, baseMap)
      }
    }
  }
  return { chunks, stats: mergeStats(chunks), inline }
}

export function newMergeDoc(files: MergeFiles, data: MergeData, method: ComparisonMethod): EditDoc {
  return buildMergeDoc(files, data.chunks, method)
}

export { buildPlainDoc }

/**
 * What a read-only pane shows: in unchanged regions every pane shows the text of
 * the reference file (base in a merge, left in a diff), which only differs from the pane's own
 * text by ignored white space or line endings.
 */
export function sharedText(
  own: readonly Line[],
  ref: readonly Line[],
  pairs: readonly { equal: boolean; own: Range; ref: Range }[]
): Line[] {
  const out = own.slice()
  for (const p of pairs) {
    if (!p.equal) continue
    for (let k = 0; k < p.own.end - p.own.start; k++) {
      const i = p.own.start + k
      const j = p.ref.start + k
      if (i < out.length && j < ref.length) out[i] = { text: ref[j].text, eol: out[i].eol }
    }
  }
  return out
}

/** Read-only docs for the left and right panes of a merge. */
export function mergeSideDocs(
  files: MergeFiles,
  data: MergeData
): { leftDoc: EditDoc; rightDoc: EditDoc } {
  const side = (s: 'left' | 'right'): EditDoc =>
    buildPlainDoc(
      sharedText(
        files[s],
        files.base,
        data.chunks.map((c) => ({ equal: c.kind === 'equal', own: c[s], ref: c.base }))
      )
    )
  return { leftDoc: side('left'), rightDoc: side('right') }
}

// ── Colours ──

const BG: Record<string, string> = {
  base: 'var(--m-bg-base)',
  left: 'var(--m-bg-left)',
  right: 'var(--m-bg-right)',
  edit: 'var(--m-bg-edit)',
  conflict: 'var(--m-bg-conflict)',
  change: 'var(--m-bg-change)'
}
const HL: Record<string, string> = {
  base: 'var(--m-hl-base)',
  left: 'var(--m-hl-left)',
  right: 'var(--m-hl-right)'
}
const EDGE: Record<string, string> = {
  base: 'var(--m-base)',
  left: 'var(--m-left)',
  right: 'var(--m-right)',
  conflict: 'var(--m-conflict)'
}
const LINE_EDGE = 'color-mix(in srgb, var(--color-text-muted) 45%, transparent)'
const CURRENT_EDGE = 'var(--m-current)'

/**
 * Line decorations and insertion markers for one pane, from the chunk ranges it shows.
 * `colorOf(k)` gives the colour key of chunk k in this pane, or null when unchanged.
 */
export function paneDecor(
  ranges: readonly Range[],
  colorOf: (k: number) => string | null,
  inline: InlineMap | null,
  current: number | null
): { decor: (line: number) => LineDecor | undefined; markers: PaneMarker[] } {
  const byLine = new Map<number, LineDecor>()
  const markers: PaneMarker[] = []
  ranges.forEach((r, k) => {
    const color = colorOf(k)
    if (!color) return
    const isCurrent = k === current
    if (r.start === r.end) {
      markers.push({
        beforeLine: r.start,
        style: isCurrent ? `2px solid ${CURRENT_EDGE}` : `1px dashed ${EDGE[color] ?? LINE_EDGE}`
      })
      return
    }
    for (let i = r.start; i < r.end; i++) {
      const d: LineDecor = { bg: BG[color] }
      const spans = inline?.get(i)
      if (spans) {
        d.spans = spans
        d.spanBg = HL[color] ?? HL.base
        d.spanEdge = EDGE[color] ?? EDGE.base
      }
      if (i === r.start) d.top = isCurrent ? CURRENT_EDGE : LINE_EDGE
      if (i === r.end - 1) d.bottom = isCurrent ? CURRENT_EDGE : LINE_EDGE
      if (isCurrent) d.edgeWidth = 2
      byLine.set(i, d)
    }
  })
  return { decor: (line) => byLine.get(line), markers }
}

/** Decorations of the merge result: colour by origin, inline spans from the source line. */
export function mergeDecor(
  doc: EditDoc,
  data: MergeData,
  current: number | null
): { decor: (line: number) => LineDecor | undefined; markers: PaneMarker[] } {
  const segs = doc.segments ?? []
  const byLine = new Map<number, LineDecor>()
  const markers: PaneMarker[] = []
  segs.forEach((g) => {
    const chunk = data.chunks[g.chunk]
    if (chunk.kind === 'equal' && !g.edited) return
    const isCurrent = g.chunk === current
    const unresolved = !g.resolved
    if (g.count === 0) {
      markers.push({
        beforeLine: g.start,
        style: isCurrent
          ? `2px solid ${CURRENT_EDGE}`
          : `1px dashed ${unresolved ? EDGE.conflict : LINE_EDGE}`
      })
      return
    }
    for (let i = g.start; i < g.start + g.count; i++) {
      if (i >= doc.lines.length) break
      const l: DocLine = doc.lines[i]
      const d: LineDecor = {}
      if (l.origin === 'edit') d.bg = BG.edit
      else if (l.origin !== 'common') {
        d.bg = BG[l.origin]
        const spans: readonly InlineSpan[] | undefined =
          l.src >= 0 ? data.inline[l.origin].get(l.src) : undefined
        if (spans) {
          d.spans = spans
          d.spanBg = HL[l.origin]
          d.spanEdge = EDGE[l.origin]
        }
      }
      const edge = isCurrent ? CURRENT_EDGE : unresolved ? EDGE.conflict : LINE_EDGE
      if (i === g.start) d.top = edge
      if (i === g.start + g.count - 1) d.bottom = edge
      if (isCurrent) d.edgeWidth = 2
      byLine.set(i, d)
    }
  })
  return { decor: (line) => byLine.get(line), markers }
}

// ── Scroll mapping ──

/**
 * Map a fractional line position in one pane to the corresponding position in another, through
 * chunks that tile both panes (equal chunks map line to line, others proportionally).
 */
export function mapLine(y: number, from: readonly Range[], to: readonly Range[]): number {
  if (from.length === 0) return y
  for (let k = 0; k < from.length; k++) {
    const r = from[k]
    if (r.end > r.start && y >= r.start && y < r.end) {
      const f = (y - r.start) / (r.end - r.start)
      return to[k].start + f * (to[k].end - to[k].start)
    }
    if (r.start === r.end && y === r.start && to[k].end > to[k].start) return to[k].start
  }
  const last = from.length - 1
  if (y < from[0].start) return to[0].start - (from[0].start - y)
  return to[last].end + (y - from[last].end)
}

// ── Single-pane (unified) layout ──

export interface UnifiedView {
  doc: EditDoc
  labels: string[]
  /** Chunk index of each line (for decor and navigation). */
  ranges: Range[]
  colorOf: (k: number) => string | null
  inline: InlineMap
}

export function buildUnified(
  left: readonly Line[],
  right: readonly Line[],
  data: DiffData
): UnifiedView {
  const lines: DocLine[] = []
  const labels: string[] = []
  const ranges: Range[] = []
  const inline: InlineMap = new Map()
  const colors: (string | null)[] = []
  const w = String(Math.max(left.length, right.length)).length
  const num = (n: number | null): string => (n === null ? ' '.repeat(w) : String(n + 1).padStart(w))
  data.chunks.forEach((c) => {
    const start = lines.length
    if (c.equal) {
      for (let k = 0; k < c.left.end - c.left.start; k++) {
        lines.push({ ...left[c.left.start + k], origin: 'common', src: c.left.start + k })
        labels.push(`${num(c.left.start + k)} ${num(c.right.start + k)}`)
      }
      colors.push(null)
    } else {
      for (let i = c.left.start; i < c.left.end; i++) {
        const spans = data.inlineL.get(i)
        if (spans) inline.set(lines.length, spans)
        lines.push({ ...left[i], origin: 'left', src: i })
        labels.push(`${num(i)} ${num(null)}`)
      }
      for (let i = c.right.start; i < c.right.end; i++) {
        const spans = data.inlineR.get(i)
        if (spans) inline.set(lines.length, spans)
        lines.push({ ...right[i], origin: 'right', src: i })
        labels.push(`${num(null)} ${num(i)}`)
      }
      colors.push('mixed')
    }
    ranges.push({ start, end: lines.length })
  })
  return { doc: new EditDoc(lines), labels, ranges, colorOf: (k) => colors[k] ?? null, inline }
}

export function unifiedDecor(
  view: UnifiedView,
  current: number | null
): (line: number) => LineDecor | undefined {
  const byLine = new Map<number, LineDecor>()
  view.ranges.forEach((r, k) => {
    if (!view.colorOf(k)) return
    const isCurrent = k === current
    for (let i = r.start; i < r.end; i++) {
      const origin = view.doc.lines[i].origin
      const d: LineDecor = { bg: BG[origin] }
      const spans = view.inline.get(i)
      if (spans) {
        d.spans = spans
        d.spanBg = HL[origin]
        d.spanEdge = EDGE[origin]
      }
      if (i === r.start) d.top = isCurrent ? CURRENT_EDGE : LINE_EDGE
      if (i === r.end - 1) d.bottom = isCurrent ? CURRENT_EDGE : LINE_EDGE
      if (isCurrent) d.edgeWidth = 2
      byLine.set(i, d)
    }
  })
  return (line) => byLine.get(line)
}

export const BAND_FILL: Record<string, string> = {
  change: 'var(--m-band)',
  left: 'color-mix(in srgb, var(--m-left) 30%, var(--m-editor-bg))',
  right: 'color-mix(in srgb, var(--m-right) 32%, var(--m-editor-bg))',
  conflict: 'color-mix(in srgb, var(--m-conflict) 34%, var(--m-editor-bg))',
  both: 'var(--m-band)'
}
