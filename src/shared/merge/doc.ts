import type { ComparisonMethod } from './compare'
import { sameContent, type MergeChunk, type Source } from './diff'
import { joinWithEol, splitTyped, type Eol, type Line } from './text'

/** Where a line of an editable document came from. */
export type Origin = Source | 'common' | 'edit'

export interface DocLine extends Line {
  origin: Origin
  /** Index of the line in its source file, or -1 for user-typed lines. */
  src: number
}

/**
 * The part of the merge result produced by one merge chunk. Segments tile the document in
 * chunk order; `selection` lists the sources picked for the chunk in the order they were picked.
 */
export interface Segment {
  chunk: number
  start: number
  count: number
  selection: Source[]
  /** The user typed inside the segment, so its text no longer follows `selection`. */
  edited: boolean
  /** False only for a conflict nobody has decided yet. */
  resolved: boolean
}

export interface Pos {
  line: number
  col: number
}

interface Change {
  at: number
  removed: DocLine[]
  inserted: DocLine[]
  segBefore: Segment[] | null
  segAfter: Segment[] | null
}

interface UndoEntry {
  changes: Change[]
  cursorBefore: Pos
  cursorAfter: Pos
  group: string | null
  time: number
}

export const comparePos = (a: Pos, b: Pos): number => a.line - b.line || a.col - b.col

const cloneSegs = (s: readonly Segment[]): Segment[] =>
  s.map((x) => ({ ...x, selection: [...x.selection] }))

const cloneSegments = (s: Segment[] | null): Segment[] | null =>
  s ? s.map((x) => ({ ...x, selection: [...x.selection] })) : null

/** An editable text document with undo/redo; with segments, the editable merge result. */
export class EditDoc {
  lines: DocLine[]
  segments: Segment[] | null
  /** Bumped on every change, so views can memoize on it. */
  version = 0
  private savedVersion = 0
  private undoStack: UndoEntry[] = []
  private redoStack: UndoEntry[] = []
  private versionAtUndoDepth: number[] = [0]
  private nextVersion = 1

  constructor(lines: DocLine[], segments: Segment[] | null = null) {
    this.lines = lines
    this.segments = segments
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  get dirty(): boolean {
    return this.version !== this.savedVersion
  }

  markSaved(): void {
    this.savedVersion = this.version
  }

  /** Forget the undo history (after a reload); the document counts as saved. */
  clearHistory(): void {
    this.undoStack = []
    this.redoStack = []
    this.versionAtUndoDepth = [this.version]
    this.savedVersion = this.version
  }

  /** Lines shown, including the empty line after a final line terminator. */
  lineCount(): number {
    const n = this.lines.length
    if (n === 0) return 1
    return this.lines[n - 1].eol !== '' ? n + 1 : n
  }

  lineText(i: number): string {
    return i < this.lines.length ? this.lines[i].text : ''
  }

  clampPos(p: Pos): Pos {
    const line = Math.max(0, Math.min(p.line, this.lineCount() - 1))
    const col = Math.max(0, Math.min(p.col, this.lineText(line).length))
    return { line, col }
  }

  getText(from: Pos, to: Pos, eol = '\n'): string {
    const [a, b] = comparePos(from, to) <= 0 ? [from, to] : [to, from]
    if (a.line === b.line) return this.lineText(a.line).slice(a.col, b.col)
    const parts = [this.lineText(a.line).slice(a.col)]
    for (let i = a.line + 1; i < b.line; i++) parts.push(this.lineText(i))
    parts.push(this.lineText(b.line).slice(0, b.col))
    return parts.join(eol)
  }

  serialize(eol: Exclude<Eol, ''>): string {
    return joinWithEol(this.lines, eol)
  }

  /** Serialize keeping each line's own terminator; lines that lack one (but need one) get `eol`. */
  serializePreserving(eol: Exclude<Eol, ''>): string {
    const parts: string[] = []
    const last = this.lines.length - 1
    this.lines.forEach((l, i) => {
      parts.push(l.text, l.eol !== '' ? l.eol : i < last ? eol : '')
    })
    return parts.join('')
  }

  /** The segment holding line `i` (the first non-empty one that contains it). */
  segmentAt(line: number): number {
    const segs = this.segments
    if (!segs) return -1
    for (let s = 0; s < segs.length; s++) {
      const g = segs[s]
      if (g.count > 0 && line >= g.start && line < g.start + g.count) return s
    }
    return -1
  }

  /**
   * Replace the text between two positions with `text` (which may contain newlines). New line
   * breaks get `newEol`. Returns the position just after the inserted text.
   */
  replace(
    from: Pos,
    to: Pos,
    text: string,
    newEol: Exclude<Eol, ''>,
    cursorBefore: Pos,
    group: string | null = null
  ): Pos {
    let [a, b] = comparePos(from, to) <= 0 ? [from, to] : [to, from]
    a = this.clampPos(a)
    b = this.clampPos(b)
    const pieces = splitTyped(text)
    const n = this.lines.length
    // Line n is the empty line after a final line terminator (or the only line of an empty doc).
    const sl = a.line
    const el = b.line
    const oldFirst = sl < n ? this.lines[sl] : undefined
    const oldLast = el < n ? this.lines[el] : undefined
    const prefix = (oldFirst?.text ?? '').slice(0, a.col)
    const suffix = (oldLast?.text ?? '').slice(b.col)
    if (text === '' && comparePos(a, b) === 0) return a

    const inserted: DocLine[] = pieces.map((p, k) => {
      const isFirst = k === 0
      const isLast = k === pieces.length - 1
      const t = (isFirst ? prefix : '') + p + (isLast ? suffix : '')
      const eol: Eol = isLast ? (oldLast?.eol ?? '') : newEol
      if (isFirst && t === oldFirst?.text && (!isLast || eol === oldFirst.eol))
        return { ...oldFirst, eol }
      if (isLast && !isFirst && t === oldLast?.text) return { ...oldLast }
      return { text: t, eol, origin: 'edit', src: -1 }
    })
    // A trailing empty line without terminator is the implicit last line: drop it.
    const lastIns = inserted.length > 0 ? inserted[inserted.length - 1] : undefined
    const before =
      inserted.length > 1 ? inserted[inserted.length - 2] : sl > 0 ? this.lines[sl - 1] : undefined
    const beforeEol = before?.eol ?? ''
    if (lastIns?.text === '' && lastIns.eol === '' && el >= n - 1 && beforeEol !== '')
      inserted.pop()

    const touchEnd = Math.min(el, n - 1)
    const removed = sl < n ? this.lines.slice(sl, touchEnd + 1) : []
    const segBefore = cloneSegments(this.segments)
    let segAfter: Segment[] | null = null
    if (this.segments) {
      segAfter = cloneSegs(this.segments)
      const k = inserted.length
      let firstTouched = -1
      for (let s = 0; s < segAfter.length; s++) {
        const g = segAfter[s]
        const gEnd = g.start + g.count - 1
        const touched = sl <= touchEnd && g.count > 0 && g.start <= touchEnd && gEnd >= sl
        if (!touched) continue
        const keepBefore = Math.max(0, sl - g.start)
        const keepAfter = Math.max(0, gEnd - touchEnd)
        g.count = keepBefore + keepAfter
        if (firstTouched < 0) {
          firstTouched = s
          g.count += k
        }
        g.edited = true
        g.resolved = true
      }
      if (firstTouched < 0 && segAfter.length > 0) {
        // Typing past the last line (or into an empty document) extends the last segment.
        const g = segAfter[segAfter.length - 1]
        g.count += k
        g.edited = true
        g.resolved = true
      }
      restart(segAfter)
    }
    const end: Pos = {
      line: sl + pieces.length - 1,
      col: (pieces.length === 1 ? prefix.length : 0) + pieces[pieces.length - 1].length
    }
    this.apply({ at: sl, removed, inserted, segBefore, segAfter }, cursorBefore, end, group)
    return end
  }

  /** Re-generate a merge segment from a new selection of sources. */
  setSelection(
    segIndex: number,
    selection: Source[],
    generated: DocLine[],
    cursorBefore: Pos
  ): void {
    if (!this.segments) return
    const segBefore = cloneSegments(this.segments)
    const segAfter = cloneSegs(this.segments)
    const g = segAfter[segIndex]
    const removed = this.lines.slice(g.start, g.start + g.count)
    g.count = generated.length
    g.selection = [...selection]
    g.edited = false
    g.resolved = true
    restart(segAfter)
    const at = segBefore ? segBefore[segIndex].start : 0
    const cursor = { line: at, col: 0 }
    this.apply(
      { at, removed, inserted: generated, segBefore, segAfter },
      cursorBefore,
      cursor,
      null
    )
  }

  private apply(change: Change, cursorBefore: Pos, cursorAfter: Pos, group: string | null): void {
    this.splice(change, false)
    const now = Date.now()
    const top = this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1] : undefined
    if (
      group !== null &&
      top?.group === group &&
      now - top.time < 1500 &&
      comparePos(top.cursorAfter, cursorBefore) === 0 &&
      this.redoStack.length === 0
    ) {
      top.changes.push(change)
      top.cursorAfter = cursorAfter
      top.time = now
      this.versionAtUndoDepth[this.undoStack.length] = this.version
      return
    }
    this.undoStack.push({ changes: [change], cursorBefore, cursorAfter, group, time: now })
    this.redoStack = []
    this.versionAtUndoDepth.length = this.undoStack.length
    this.versionAtUndoDepth.push(this.version)
  }

  private splice(c: Change, reverse: boolean): void {
    if (reverse) {
      this.lines.splice(c.at, c.inserted.length, ...c.removed)
      this.segments = cloneSegments(c.segBefore)
    } else {
      this.lines.splice(c.at, c.removed.length, ...c.inserted)
      this.segments = cloneSegments(c.segAfter)
    }
    this.version = this.nextVersion++
  }

  undo(): Pos | null {
    const e = this.undoStack.pop()
    if (!e) return null
    for (let i = e.changes.length - 1; i >= 0; i--) this.splice(e.changes[i], true)
    this.version = this.versionAtUndoDepth[this.undoStack.length]
    this.redoStack.push(e)
    return e.cursorBefore
  }

  redo(): Pos | null {
    const e = this.redoStack.pop()
    if (!e) return null
    for (const c of e.changes) this.splice(c, false)
    this.undoStack.push(e)
    this.version = this.versionAtUndoDepth[this.undoStack.length]
    e.group = null // never extend a redone entry
    return e.cursorAfter
  }
}

function restart(segs: Segment[]): void {
  let pos = 0
  for (const g of segs) {
    g.start = pos
    pos += g.count
  }
}

export type MergeFiles = Record<Source, readonly Line[]>

/** The lines a selection of sources produces for one chunk (same-content sources appear once). */
export function generateLines(
  files: MergeFiles,
  chunk: MergeChunk,
  selection: readonly Source[],
  method: ComparisonMethod
): DocLine[] {
  const out: DocLine[] = []
  const used: Source[] = []
  for (const src of selection) {
    if (used.some((u) => sameContent(files, chunk, u, src, method))) continue
    used.push(src)
    const r = chunk[src]
    const origin: Origin = chunk.kind === 'equal' ? 'common' : src
    for (let i = r.start; i < r.end; i++) out.push({ ...files[src][i], origin, src: i })
  }
  return out
}

/** The starting choice for each kind of chunk. */
export function defaultSelection(chunk: MergeChunk): { selection: Source[]; resolved: boolean } {
  switch (chunk.kind) {
    case 'equal':
      return { selection: ['base'], resolved: true }
    case 'left':
      return { selection: ['left'], resolved: true }
    case 'right':
      return { selection: ['right'], resolved: true }
    case 'both':
      return { selection: ['left', 'right'], resolved: true }
    case 'conflict':
      return { selection: ['base', 'left', 'right'], resolved: false }
  }
}

export function buildMergeDoc(
  files: MergeFiles,
  chunks: readonly MergeChunk[],
  method: ComparisonMethod
): EditDoc {
  const lines: DocLine[] = []
  const segments: Segment[] = []
  chunks.forEach((chunk, i) => {
    const { selection, resolved } = defaultSelection(chunk)
    const gen = generateLines(files, chunk, selection, method)
    segments.push({
      chunk: i,
      start: lines.length,
      count: gen.length,
      selection,
      edited: false,
      resolved
    })
    lines.push(...gen)
  })
  return new EditDoc(lines, segments)
}

/** A plain editable file (2-way diff panes). */
export function buildPlainDoc(lines: readonly Line[]): EditDoc {
  return new EditDoc(lines.map((l, i) => ({ ...l, origin: 'common' as const, src: i })))
}

/**
 * The selection after the user clicks a source's button: an undecided conflict switches to just
 * that source; otherwise the source is toggled, keeping click order.
 */
export function toggleSelection(seg: Segment, src: Source): Source[] {
  if (!seg.resolved) return [src]
  return seg.selection.includes(src)
    ? seg.selection.filter((s) => s !== src)
    : [...seg.selection, src]
}
