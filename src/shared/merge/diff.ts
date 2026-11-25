import { Interner, lineIds, lineKey, type ComparisonMethod } from './compare'
import { diffSequences, type Hunk } from './myers'
import type { Line } from './text'

/** A half-open range of line indexes [start, end). */
export interface Range {
  start: number
  end: number
}

export const rangeLength = (r: Range): number => r.end - r.start

/** One aligned region of a 2-way diff. The chunks cover both files completely, in order. */
export interface DiffChunk {
  equal: boolean
  left: Range
  right: Range
}

export type Source = 'base' | 'left' | 'right'
export const SOURCES: readonly Source[] = ['base', 'left', 'right']

/**
 * One aligned region of a 3-way merge:
 * - `equal`: nobody changed it
 * - `left` / `right`: only that side changed it
 * - `both`: both sides made the same change
 * - `conflict`: both sides changed it differently
 */
export type MergeChunkKind = 'equal' | 'left' | 'right' | 'both' | 'conflict'

export interface MergeChunk {
  kind: MergeChunkKind
  base: Range
  left: Range
  right: Range
}

function lineDiff(a: readonly Line[], b: readonly Line[], method: ComparisonMethod): Hunk[] {
  const interner = new Interner()
  return diffSequences(lineIds(a, method, interner), lineIds(b, method, interner))
}

export function diff2(
  left: readonly Line[],
  right: readonly Line[],
  method: ComparisonMethod
): DiffChunk[] {
  const chunks: DiffChunk[] = []
  let l = 0
  let r = 0
  for (const h of lineDiff(left, right, method)) {
    if (h.aStart > l)
      chunks.push({
        equal: true,
        left: { start: l, end: h.aStart },
        right: { start: r, end: h.bStart }
      })
    chunks.push({
      equal: false,
      left: { start: h.aStart, end: h.aEnd },
      right: { start: h.bStart, end: h.bEnd }
    })
    l = h.aEnd
    r = h.bEnd
  }
  if (l < left.length || r < right.length)
    chunks.push({
      equal: true,
      left: { start: l, end: left.length },
      right: { start: r, end: right.length }
    })
  return chunks
}

interface SideHunk {
  side: 'left' | 'right'
  h: Hunk
}

/** Whether hunk `h` must join a group spanning base [start, end) (both sides touch the same lines). */
type HunkShape = 'insert' | 'delete' | 'change'

function shape(h: Hunk): HunkShape {
  if (h.aStart === h.aEnd) return 'insert'
  return h.bStart === h.bEnd ? 'delete' : 'change'
}

/**
 * Whether hunk `h` (from `side`) belongs with the group: it overlaps the lines the group
 * touches, or it starts exactly where a hunk of the other side ends and that contact counts as a
 * conflict. When one side's change ends where the other side's starts, they stay apart only if
 * the first is a deletion or both are replacements.
 */
function joins(group: readonly SideHunk[], start: number, end: number, it: SideHunk): boolean {
  const h = it.h
  if (h.aStart < h.aEnd) {
    if (h.aStart < end && start < h.aEnd) return true
  } else {
    const p = h.aStart
    if (start < p && p < end) return true
  }
  // Contact at a single point with a hunk of the other side.
  for (const g of group) {
    if (g.side === it.side) continue
    const gs = g.h
    if (shape(gs) === 'insert' && shape(h) === 'insert') {
      if (gs.aStart === h.aStart) return true
      continue
    }
    if (gs.aEnd !== h.aStart) continue
    const first = shape(gs)
    const second = shape(h)
    if (first === 'delete') continue
    if (first === 'change' && second === 'change') continue
    return true
  }
  return false
}

/**
 * When both sides delete overlapping base lines, the deletions are taken line by line: lines
 * deleted by both are a change common to both, the others belong to one side, and there is no
 * conflict. It does so when the deletions start on the same line, or are staggered (the one that
 * starts later also ends later); a deletion ending on the same line as, or nested inside, the
 * other's is a conflict. Cut the deletions at each other's ends in the first case.
 */
function splitOverlappingDeletions(left: Hunk[], right: Hunk[]): [Hunk[], Hunk[]] {
  const isDeletion = (h: Hunk): boolean => h.aStart < h.aEnd && h.bStart === h.bEnd
  const cutsL = new Set<number>()
  const cutsR = new Set<number>()
  for (const a of left) {
    if (!isDeletion(a)) continue
    for (const b of right) {
      if (!isDeletion(b) || !(a.aStart < b.aEnd && b.aStart < a.aEnd)) continue
      if (a.aStart === b.aStart && a.aEnd === b.aEnd) continue
      const [first, second] = a.aStart <= b.aStart ? [a, b] : [b, a]
      const split = a.aStart === b.aStart || second.aEnd > first.aEnd
      if (!split) continue
      cutsL.add(b.aStart).add(b.aEnd)
      cutsR.add(a.aStart).add(a.aEnd)
    }
  }
  const cut = (hunks: Hunk[], cuts: Set<number>): Hunk[] =>
    hunks.flatMap((h) => {
      if (!isDeletion(h)) return [h]
      const points = [...cuts].filter((c) => c > h.aStart && c < h.aEnd).sort((x, y) => x - y)
      const out: Hunk[] = []
      let from = h.aStart
      for (const c of [...points, h.aEnd]) {
        out.push({ aStart: from, aEnd: c, bStart: h.bStart, bEnd: h.bStart })
        from = c
      }
      return out
    })
  return [cut(left, cutsL), cut(right, cutsR)]
}

export function diff3(
  base: readonly Line[],
  left: readonly Line[],
  right: readonly Line[],
  method: ComparisonMethod
): MergeChunk[] {
  const [lh, rh] = splitOverlappingDeletions(
    lineDiff(base, left, method),
    lineDiff(base, right, method)
  )
  const items: SideHunk[] = [
    ...lh.map((h) => ({ side: 'left' as const, h })),
    ...rh.map((h) => ({ side: 'right' as const, h }))
  ]
  items.sort((x, y) => x.h.aStart - y.h.aStart || x.h.aEnd - y.h.aEnd)

  const chunks: MergeChunk[] = []
  let deltaL = 0
  let deltaR = 0
  let pos = 0 // base position covered so far

  const pushEqual = (until: number): void => {
    if (until > pos)
      chunks.push({
        kind: 'equal',
        base: { start: pos, end: until },
        left: { start: pos + deltaL, end: until + deltaL },
        right: { start: pos + deltaR, end: until + deltaR }
      })
  }

  let i = 0
  while (i < items.length) {
    const group: SideHunk[] = [items[i]]
    let start = items[i].h.aStart
    let end = items[i].h.aEnd
    i++
    while (i < items.length && joins(group, start, end, items[i])) {
      const h = items[i].h
      group.push(items[i])
      start = Math.min(start, h.aStart)
      end = Math.max(end, h.aEnd)
      i++
    }
    pushEqual(start)

    const sideRange = (side: 'left' | 'right', delta: number): [Range, number] => {
      const hs = group.filter((g) => g.side === side).map((g) => g.h)
      if (hs.length === 0) return [{ start: start + delta, end: end + delta }, delta]
      const first = hs[0]
      const last = hs[hs.length - 1]
      return [
        { start: first.bStart - (first.aStart - start), end: last.bEnd + (end - last.aEnd) },
        last.bEnd - last.aEnd
      ]
    }
    const [lr, nextDeltaL] = sideRange('left', deltaL)
    const [rr, nextDeltaR] = sideRange('right', deltaR)
    const hasLeft = group.some((g) => g.side === 'left')
    const hasRight = group.some((g) => g.side === 'right')
    let kind: MergeChunkKind
    if (hasLeft && hasRight) kind = sameLines(left, lr, right, rr, method) ? 'both' : 'conflict'
    else kind = hasLeft ? 'left' : 'right'
    chunks.push({ kind, base: { start, end }, left: lr, right: rr })
    deltaL = nextDeltaL
    deltaR = nextDeltaR
    pos = end
  }
  pushEqual(base.length)
  return chunks
}

function sameLines(
  a: readonly Line[],
  ar: Range,
  b: readonly Line[],
  br: Range,
  method: ComparisonMethod
): boolean {
  if (rangeLength(ar) !== rangeLength(br)) return false
  for (let k = 0; k < rangeLength(ar); k++)
    if (lineKey(a[ar.start + k], method) !== lineKey(b[br.start + k], method)) return false
  return true
}

export interface MergeStats {
  diffs: number
  leftUnique: number
  rightUnique: number
  common: number
  conflicts: number
}

export function mergeStats(chunks: readonly MergeChunk[]): MergeStats {
  const s: MergeStats = { diffs: 0, leftUnique: 0, rightUnique: 0, common: 0, conflicts: 0 }
  for (const c of chunks) {
    if (c.kind === 'equal') continue
    s.diffs++
    if (c.kind === 'left') s.leftUnique++
    else if (c.kind === 'right') s.rightUnique++
    else if (c.kind === 'both') s.common++
    else s.conflicts++
  }
  return s
}

/** The line range a chunk covers in one source. */
export function chunkRange(c: MergeChunk, source: Source): Range {
  return c[source]
}

/** Whether two sources hold the same text in a chunk (for de-duplicating merge choices). */
export function sameContent(
  files: Record<Source, readonly Line[]>,
  c: MergeChunk,
  x: Source,
  y: Source,
  method: ComparisonMethod
): boolean {
  return sameLines(files[x], c[x], files[y], c[y], method)
}
