import { diff3 } from './diff'
import {
  buildMergeDoc,
  buildPlainDoc,
  generateLines,
  toggleSelection,
  type EditDoc,
  type Pos,
  type Segment
} from './doc'
import { splitLines } from './text'

const L = splitLines
const text = (d: EditDoc): string => d.serialize('\n')
const p = (line: number, col: number): Pos => ({ line, col })

describe('EditDoc editing', () => {
  it('inserts, splits and joins lines with undo/redo', () => {
    const d = buildPlainDoc(L('abc\ndef\n'))
    const end = d.replace(p(0, 1), p(0, 1), 'X\nY', '\n', p(0, 1))
    expect(end).toEqual(p(1, 1))
    expect(text(d)).toBe('aX\nYbc\ndef\n')
    expect(d.dirty).toBe(true)
    d.replace(p(0, 1), p(2, 1), '', '\n', end)
    expect(text(d)).toBe('aef\n')
    expect(d.undo()).toEqual(end)
    expect(text(d)).toBe('aX\nYbc\ndef\n')
    d.undo()
    expect(text(d)).toBe('abc\ndef\n')
    expect(d.dirty).toBe(false)
    d.redo()
    d.redo()
    expect(text(d)).toBe('aef\n')
  })

  it('groups consecutive typing into one undo step', () => {
    const d = buildPlainDoc(L('x\n'))
    let c = p(0, 1)
    for (const ch of 'abc') c = d.replace(c, c, ch, '\n', c, 'typing')
    expect(text(d)).toBe('xabc\n')
    d.undo()
    expect(text(d)).toBe('x\n')
  })

  it('edits an empty document', () => {
    const d = buildPlainDoc([])
    expect(d.lineCount()).toBe(1)
    d.replace(p(0, 0), p(0, 0), 'hi\nthere', '\n', p(0, 0))
    expect(d.serialize('\r\n')).toBe('hi\r\nthere')
  })

  it('edits the empty line after a final terminator', () => {
    const d = buildPlainDoc(L('a\n}\n'))
    expect(d.lineCount()).toBe(3)
    let c = d.replace(p(2, 0), p(2, 0), '// end', '\n', p(2, 0))
    expect(text(d)).toBe('a\n}\n// end')
    expect(c).toEqual(p(2, 6))
    c = d.replace(c, c, '\n', '\n', c)
    expect(text(d)).toBe('a\n}\n// end\n')
    expect(d.lines).toHaveLength(3)
    // Deleting the last line's content and its terminator.
    d.replace(p(1, 1), p(3, 0), '', '\n', p(3, 0))
    expect(text(d)).toBe('a\n}')
    expect(d.lineCount()).toBe(2)
    d.undo()
    expect(text(d)).toBe('a\n}\n// end\n')
  })

  it('selects all text including the final terminator', () => {
    const d = buildPlainDoc(L('a\nb\n'))
    expect(d.getText(p(0, 0), p(2, 0))).toBe('a\nb\n')
    d.replace(p(0, 0), p(2, 0), 'x', '\n', p(0, 0))
    expect(text(d)).toBe('x')
  })

  it('keeps a missing final line terminator', () => {
    const d = buildPlainDoc(L('a\nb'))
    d.replace(p(1, 1), p(1, 1), '!', '\n', p(1, 1))
    expect(text(d)).toBe('a\nb!')
    d.replace(p(1, 2), p(1, 2), '\n', '\n', p(1, 2))
    expect(text(d)).toBe('a\nb!\n')
  })
})

describe('merge document', () => {
  const files = {
    base: L('one\nint x = 1;\nthree\n'),
    left: L('zero\none\nint x = 10;\nthree\n'),
    right: L('one\nint x = 5;\nthree\nfour\n')
  }
  const chunks = diff3(files.base, files.left, files.right, 'lineEndings')

  it('starts from the default selections', () => {
    expect(chunks.map((c) => c.kind)).toEqual(['left', 'equal', 'conflict', 'equal', 'right'])
    const d = buildMergeDoc(files, chunks, 'lineEndings')
    expect(text(d)).toBe('zero\none\nint x = 1;\nint x = 10;\nint x = 5;\nthree\nfour\n')
    expect(d.segments?.map((s) => s.resolved)).toEqual([true, true, false, true, true])
    expect(d.lines[3]).toMatchObject({ origin: 'left', src: 2 })
  })

  it('resolves a conflict by picking sources in click order', () => {
    const d = buildMergeDoc(files, chunks, 'lineEndings')
    const seg = (): Segment => (d.segments ?? [])[2]
    let sel = toggleSelection(seg(), 'right')
    d.setSelection(2, sel, generateLines(files, chunks[2], sel, 'lineEndings'), p(0, 0))
    expect(text(d)).toBe('zero\none\nint x = 5;\nthree\nfour\n')
    sel = toggleSelection(seg(), 'left')
    expect(sel).toEqual(['right', 'left'])
    d.setSelection(2, sel, generateLines(files, chunks[2], sel, 'lineEndings'), p(0, 0))
    expect(text(d)).toBe('zero\none\nint x = 5;\nint x = 10;\nthree\nfour\n')
    expect(seg().resolved).toBe(true)
    d.undo()
    d.undo()
    expect(seg().resolved).toBe(false)
  })

  it('tracks segment boundaries through edits spanning segments', () => {
    const d = buildMergeDoc(files, chunks, 'lineEndings')
    // Delete from the middle of "one" (segment 1) to the middle of "int x = 10;" (segment 2).
    d.replace(p(1, 2), p(3, 4), '', '\n', p(1, 2))
    expect(text(d)).toBe('zero\nonx = 10;\nint x = 5;\nthree\nfour\n')
    const segs = d.segments ?? []
    expect(segs.map((s) => [s.start, s.count])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1]
    ])
    expect(segs[1].edited && segs[2].edited && segs[2].resolved).toBe(true)
    expect(d.segmentAt(2)).toBe(2)
  })

  it('extends the last segment when typing after the end', () => {
    const d = buildMergeDoc(files, chunks, 'lineEndings')
    const last = d.lineCount() - 1
    d.replace(p(last, 0), p(last, 0), 'five', '\n', p(last, 0))
    expect(text(d)).toBe('zero\none\nint x = 1;\nint x = 10;\nint x = 5;\nthree\nfour\nfive')
    const segs = d.segments ?? []
    expect(segs[4]).toMatchObject({ start: 6, count: 2, edited: true })
  })

  it('emits identical content once for a change made on both sides', () => {
    const f = { base: L('a\n'), left: L('a\nb\n'), right: L('a\nb\n') }
    const c = diff3(f.base, f.left, f.right, 'lineEndings')
    expect(text(buildMergeDoc(f, c, 'lineEndings'))).toBe('a\nb\n')
  })
})
