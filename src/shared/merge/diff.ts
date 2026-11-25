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
function splitOverlappingDeletions(
  left: Hunk[],
  right: Hunk[],
  baseLength: number
): [Hunk[], Hunk[]] {
  const isDeletion = (h: Hunk): boolean => h.aStart < h.aEnd && h.bStart === h.bEnd
  const cutsL = new Set<number>()
  const cutsR = new Set<number>()
  for (const a of left) {
    if (!isDeletion(a)) continue
    for (const b of right) {
      if (!isDeletion(b) || !(a.aStart < b.aEnd && b.aStart < a.aEnd)) continue
      if (a.aStart === b.aStart && a.aEnd === b.aEnd) continue
      const [first, second] = a.aStart <= b.aStart ? [a, b] : [b, a]
      // Ending together is fine at the end of the file (nothing follows to disagree on).
      const split =
        a.aStart === b.aStart ||
        second.aEnd > first.aEnd ||
        (a.aEnd === b.aEnd && a.aEnd === baseLength)
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
    lineDiff(base, right, method),
    base.length
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
    if (kind === 'conflict')
      chunks.push(...splitConflict(base, left, right, { start, end }, lr, rr, method))
    else chunks.push({ kind, base: { start, end }, left: lr, right: rr })
    deltaL = nextDeltaL
    deltaR = nextDeltaR
    pos = end
  }
  pushEqual(base.length)
  return splitShrinkingBoth(chunks)
}

/**
 * The same change made on both sides that replaces base lines with fewer lines reads as two
 * changes: the replacement, then the deletion of the remaining base lines.
 */
function splitShrinkingBoth(chunks: MergeChunk[]): MergeChunk[] {
  return chunks.flatMap((c) => {
    const n = c.base.end - c.base.start
    const m = c.left.end - c.left.start
    if (c.kind !== 'both' || m === 0 || n <= m) return [c]
    const cut = c.base.start + m
    return [
      { ...c, base: { start: c.base.start, end: cut } },
      {
        kind: 'both' as const,
        base: { start: cut, end: c.base.end },
        left: { start: c.left.end, end: c.left.end },
        right: { start: c.right.end, end: c.right.end }
      }
    ]
  })
}

/**
 * Refine a conflict by aligning the two sides' texts against each other: lines both sides have
 * become changes common to both, a stretch only one side has becomes that side's change, and
 * only stretches where both sides differ stay conflicts. The replaced base lines go with the
 * first piece involving both sides. Without any shared line the whole region stays one conflict.
 */
function splitConflict(
  baseLines: readonly Line[],
  left: readonly Line[],
  right: readonly Line[],
  base: Range,
  lr: Range,
  rr: Range,
  method: ComparisonMethod
): MergeChunk[] {
  const interner = new Interner()
  const ids = (lines: readonly Line[], r: Range): Int32Array =>
    Int32Array.from({ length: r.end - r.start }, (_, k) =>
      interner.id(lineKey(lines[r.start + k], method))
    )
  const hunks = diffSequences(ids(left, lr), ids(right, rr))
  const whole: MergeChunk = { kind: 'conflict', base, left: lr, right: rr }
  const shared = lr.end - lr.start - hunks.reduce((n, h) => n + h.aEnd - h.aStart, 0)
  if (shared === 0) return [whole]

  const pieces: Piece[] = []
  let l = 0
  let r = 0
  const at = (from: number, to: number, origin: number): Range => ({
    start: origin + from,
    end: origin + to
  })
  for (const h of [...hunks, null]) {
    const aStart = h ? h.aStart : lr.end - lr.start
    const bStart = h ? h.bStart : rr.end - rr.start
    if (aStart > l)
      pieces.push({ kind: 'both', left: at(l, aStart, lr.start), right: at(r, bStart, rr.start) })
    if (!h) break
    const kind: MergeChunkKind =
      h.aEnd > h.aStart && h.bEnd > h.bStart ? 'conflict' : h.aEnd > h.aStart ? 'left' : 'right'
    pieces.push({
      kind,
      left: at(h.aStart, h.aEnd, lr.start),
      right: at(h.bStart, h.bEnd, rr.start)
    })
    l = h.aEnd
    r = h.bEnd
  }
  const key = (lines: readonly Line[], i: number): number => interner.id(lineKey(lines[i], method))
  return placeBaseByContent(pieces, base, baseLines, left, right, key) ?? placeBase(pieces, base)
}

/**
 * Give base lines to the pieces whose text they match (left first, then right), keeping order;
 * unmatched base lines go with the piece of the previous matched line. Each piece is then
 * classified against its base: a side still equal to the base did not change it. Returns null
 * when no base line matches, or the matches cross, so the positional rule applies instead.
 */
function placeBaseByContent(
  pieces: Piece[],
  base: Range,
  baseLines: readonly Line[],
  left: readonly Line[],
  right: readonly Line[],
  key: (lines: readonly Line[], i: number) => number
): MergeChunk[] | null {
  const n = len(base)
  if (n === 0) return null
  const owner = new Array<number>(n).fill(-1)
  const ownerOf = (side: 'left' | 'right', line: number): number =>
    pieces.findIndex((p) => line >= p[side].start && line < p[side].end)
  for (const [side, lines] of [
    ['left', left],
    ['right', right]
  ] as const) {
    const first = pieces[0][side].start
    const last = pieces[pieces.length - 1][side].end
    const a = Int32Array.from({ length: n }, (_, k) => key(baseLines, base.start + k))
    const b = Int32Array.from({ length: last - first }, (_, k) => key(lines, first + k))
    let i = 0
    let j = 0
    for (const h of [...diffSequences(a, b), null]) {
      const stop = h ? h.aStart : n
      while (i < stop) {
        if (owner[i] < 0) owner[i] = ownerOf(side, first + j)
        i++
        j++
      }
      if (!h) break
      i = h.aEnd
      j = h.bEnd
    }
  }
  if (owner.every((o) => o < 0)) return null
  let prev = owner.find((o) => o >= 0) ?? 0
  for (let k = 0; k < n; k++) {
    if (owner[k] < 0) owner[k] = prev
    if (owner[k] < prev) return null
    prev = owner[k]
  }
  const same = (lines: readonly Line[], r: Range, b: Range): boolean =>
    len(r) === len(b) &&
    Array.from({ length: len(r) }, (_, k) => k).every(
      (k) => key(lines, r.start + k) === key(baseLines, b.start + k)
    )
  let cursor = base.start
  return pieces.map((p, idx) => {
    const count = owner.filter((o) => o === idx).length
    const b = { start: cursor, end: cursor + count }
    cursor += count
    const l = same(left, p.left, b)
    const r = same(right, p.right, b)
    const both =
      len(p.left) === len(p.right) &&
      Array.from({ length: len(p.left) }, (_, k) => k).every(
        (k) => key(left, p.left.start + k) === key(right, p.right.start + k)
      )
    const kind: MergeChunkKind =
      l && r ? 'equal' : both ? 'both' : l ? 'right' : r ? 'left' : 'conflict'
    return { ...p, kind, base: b }
  })
}

interface Piece {
  kind: MergeChunkKind
  left: Range
  right: Range
}

const len = (r: Range): number => r.end - r.start

/**
 * Give each piece its share of the replaced base lines, in order. Shared pieces take base lines
 * one for one; base lines beyond the shared lines are taken as early as possible by the other
 * pieces, and a one-sided piece that takes base lines becomes a conflict (one side replaces them,
 * the other deletes them). Pure insertions (no base lines) only split in the simple shapes: at
 * most one non-shared piece, or a conflict followed by a final one-sided piece; otherwise the
 * leading shared pieces are kept and the rest stays one conflict.
 */
function placeBase(pieces: Piece[], base: Range): MergeChunk[] {
  if (len(base) === 0) {
    const others = pieces.filter((p) => p.kind !== 'both')
    const last = pieces[pieces.length - 1]
    const simple =
      others.length <= 1 ||
      (others.length === 2 &&
        others[0].kind === 'conflict' &&
        others[1].kind !== 'conflict' &&
        others[1] === last)
    let kept = pieces
    if (!simple) {
      const lead = pieces.findIndex((p) => p.kind !== 'both')
      const rest = pieces.slice(lead)
      kept = [
        ...pieces.slice(0, lead),
        {
          kind: 'conflict',
          left: { start: rest[0].left.start, end: rest[rest.length - 1].left.end },
          right: { start: rest[0].right.start, end: rest[rest.length - 1].right.end }
        }
      ]
    }
    return kept.map((p) => ({ ...p, base: { start: base.start, end: base.start } }))
  }
  let remaining = len(base)
  let sharedLeft = pieces.reduce((n, p) => n + (p.kind === 'both' ? len(p.left) : 0), 0)
  let cursor = base.start
  const out: MergeChunk[] = pieces.map((p) => {
    let take: number
    if (p.kind === 'both') {
      take = Math.min(len(p.left), remaining)
      sharedLeft -= len(p.left)
    } else take = Math.max(0, remaining - sharedLeft)
    const range = { start: cursor, end: cursor + take }
    cursor += take
    remaining -= take
    const kind: MergeChunkKind = p.kind !== 'both' && take > 0 ? 'conflict' : p.kind
    return { ...p, kind, base: range }
  })
  if (remaining > 0) {
    const last = out[out.length - 1]
    last.base = { start: last.base.start, end: base.end }
    if (last.kind !== 'both') last.kind = 'conflict'
  }
  return out
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
