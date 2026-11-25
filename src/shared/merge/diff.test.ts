import { lineKey } from './compare'
import { diff2, diff3, mergeStats } from './diff'
import { inlineDiff, type InlineMap } from './inline'
import { detectLineEnding, joinLines, joinWithEol, splitLines, type Line } from './text'

const L = (s: string): Line[] => splitLines(s)

describe('splitLines', () => {
  it('keeps terminators and does not add a phantom last line', () => {
    expect(splitLines('')).toEqual([])
    expect(splitLines('a')).toEqual([{ text: 'a', eol: '' }])
    expect(splitLines('a\r\nb\rc\n')).toEqual([
      { text: 'a', eol: '\r\n' },
      { text: 'b', eol: '\r' },
      { text: 'c', eol: '\n' }
    ])
    expect(joinLines(splitLines('x\r\n\ny'))).toBe('x\r\n\ny')
  })

  it('serializes with one line ending, keeping a missing final terminator', () => {
    expect(joinWithEol(splitLines('a\r\nb'), '\n')).toBe('a\nb')
    expect(
      joinWithEol(
        [
          { text: 'a', eol: '' },
          { text: 'b', eol: '\n' }
        ],
        '\r\n'
      )
    ).toBe('a\r\nb\r\n')
  })

  it('detects the dominant line ending', () => {
    expect(detectLineEnding(L('a\r\nb\r\nc\n'))).toBe('win')
    expect(detectLineEnding(L('a\nb'))).toBe('unix')
    expect(detectLineEnding(L('a'))).toBeNull()
  })
})

describe('comparison methods', () => {
  const line = { text: 'sample \texample  text', eol: '\r\n' as const }
  it('normalizes per method', () => {
    expect(lineKey(line, 'all')).toBe('sample \texample  text\r\n')
    expect(lineKey(line, 'lineEndings')).toBe('sample \texample  text')
    expect(lineKey(line, 'whitespaceLength')).toBe('sample example text')
    expect(lineKey(line, 'whitespace')).toBe('sampleexampletext')
  })

  it('-da sees line ending changes, -dl does not', () => {
    expect(diff2(L('a\r\nb\n'), L('a\nb\n'), 'all').filter((c) => !c.equal)).toHaveLength(1)
    expect(diff2(L('a\r\nb\n'), L('a\nb\n'), 'lineEndings').filter((c) => !c.equal)).toHaveLength(0)
  })
})

describe('diff2', () => {
  it('covers both files with alternating chunks', () => {
    const chunks = diff2(L('a\nb\nc\n'), L('a\nB\nc\nd\n'), 'lineEndings')
    expect(chunks).toEqual([
      { equal: true, left: { start: 0, end: 1 }, right: { start: 0, end: 1 } },
      { equal: false, left: { start: 1, end: 2 }, right: { start: 1, end: 2 } },
      { equal: true, left: { start: 2, end: 3 }, right: { start: 2, end: 3 } },
      { equal: false, left: { start: 3, end: 3 }, right: { start: 3, end: 4 } }
    ])
  })
})

describe('diff3', () => {
  it('keeps adjacent edits from both sides apart (no conflict)', () => {
    const base = L('one\ntwo\nthree\nfour\nfive\nsix\nseven\n')
    const left = L('one\nTWO\nthree\nfour\nfive\nsix\nseven\nEIGHT\n')
    const right = L('one\ntwo\nTHREE\nfour\n  five\nsix\nseven\nEIGHT\n')
    const chunks = diff3(base, left, right, 'whitespace')
    expect(chunks.map((c) => c.kind)).toEqual(['equal', 'left', 'right', 'equal', 'both'])
    expect(mergeStats(chunks)).toEqual({
      diffs: 3,
      leftUnique: 1,
      rightUnique: 1,
      common: 1,
      conflicts: 0
    })
    expect(chunks[4]).toEqual({
      kind: 'both',
      base: { start: 7, end: 7 },
      left: { start: 7, end: 8 },
      right: { start: 7, end: 8 }
    })
  })

  it('makes two different insertions at the same point a conflict', () => {
    const chunks = diff3(L('one\ntwo\n'), L('one\ntwo\nx\n'), L('one\ntwo\ny\n'), 'lineEndings')
    expect(chunks.map((c) => c.kind)).toEqual(['equal', 'conflict'])
  })

  it('finds the sample conflict', () => {
    const base = L('int x = 1;\nint y = 2;\n')
    const left = L('int x = 10;\nint y = 2;\n')
    const right = L('int x = 5;\nint y = 2;\n')
    const chunks = diff3(base, left, right, 'lineEndings')
    expect(chunks[0]).toEqual({
      kind: 'conflict',
      base: { start: 0, end: 1 },
      left: { start: 0, end: 1 },
      right: { start: 0, end: 1 }
    })
  })

  it('maps ranges through earlier insertions and deletions', () => {
    const base = L('a\nb\nc\nd\ne\n')
    const left = L('a\nX\nY\nb\nc\nd\ne\n') // insert after a
    const right = L('a\nb\nc\ne\nZ\n') // delete d, append Z
    const chunks = diff3(base, left, right, 'lineEndings')
    expect(chunks).toEqual([
      {
        kind: 'equal',
        base: { start: 0, end: 1 },
        left: { start: 0, end: 1 },
        right: { start: 0, end: 1 }
      },
      {
        kind: 'left',
        base: { start: 1, end: 1 },
        left: { start: 1, end: 3 },
        right: { start: 1, end: 1 }
      },
      {
        kind: 'equal',
        base: { start: 1, end: 3 },
        left: { start: 3, end: 5 },
        right: { start: 1, end: 3 }
      },
      {
        kind: 'right',
        base: { start: 3, end: 4 },
        left: { start: 5, end: 6 },
        right: { start: 3, end: 3 }
      },
      {
        kind: 'equal',
        base: { start: 4, end: 5 },
        left: { start: 6, end: 7 },
        right: { start: 3, end: 4 }
      },
      {
        kind: 'right',
        base: { start: 5, end: 5 },
        left: { start: 7, end: 7 },
        right: { start: 4, end: 5 }
      }
    ])
  })

  it('chunks always tile all three files', () => {
    const r = (() => {
      let s = 99
      return () => (s = (s * 1103515245 + 12345) >>> 0) / 0x100000000
    })()
    const gen = (): string =>
      Array.from({ length: Math.floor(r() * 12) }, () => 'abcde'[Math.floor(r() * 5)] + '\n').join(
        ''
      )
    for (let t = 0; t < 300; t++) {
      const files = { base: L(gen()), left: L(gen()), right: L(gen()) }
      const chunks = diff3(files.base, files.left, files.right, 'lineEndings')
      for (const src of ['base', 'left', 'right'] as const) {
        let pos = 0
        for (const c of chunks) {
          expect(c[src].start).toBe(pos)
          expect(c[src].end).toBeGreaterThanOrEqual(c[src].start)
          pos = c[src].end
        }
        expect(pos).toBe(files[src].length)
      }
      for (const c of chunks) {
        if (c.kind !== 'equal') continue
        for (let k = 0; k < c.base.end - c.base.start; k++) {
          expect(files.left[c.left.start + k].text).toBe(files.base[c.base.start + k].text)
          expect(files.right[c.right.start + k].text).toBe(files.base[c.base.start + k].text)
        }
      }
    }
  })
})

describe('inlineDiff', () => {
  it('highlights only the changed tokens', () => {
    const a = L('    printf("%d\\n", add(x, y));\n')
    const b = L('    printf("sum=%d\\n", add(x, y));\n')
    const ma: InlineMap = new Map()
    const mb: InlineMap = new Map()
    inlineDiff(a, { start: 0, end: 1 }, b, { start: 0, end: 1 }, 'lineEndings', ma, mb)
    expect(ma.get(0)).toBeUndefined()
    const span = mb.get(0)?.[0]
    expect(span && b[0].text.slice(span.start, span.end)).toBe('sum=')
  })

  it('ignores white space tokens under -dw', () => {
    const ma: InlineMap = new Map()
    const mb: InlineMap = new Map()
    inlineDiff(
      L('a b x\n'),
      { start: 0, end: 1 },
      L('a\tb  y\n'),
      { start: 0, end: 1 },
      'whitespace',
      ma,
      mb
    )
    expect(ma.get(0)).toEqual([{ start: 4, end: 5 }])
    expect(mb.get(0)).toEqual([{ start: 5, end: 6 }])
  })
})

/**
 * Conflict rules for touching and overlapping edits, with distinct lines (base l0..l8). Each case is
 * [left edits, right edits, expected non-equal chunk kinds]; an edit is [start, end, new lines].
 */
describe('diff3 on touching and overlapping edits', () => {
  type Edit = [number, number, string[]]
  const base = Array.from({ length: 9 }, (_, i) => `l${i}`)
  const apply = (edits: Edit[]): string => {
    const out = [...base]
    for (const [s, e, n] of [...edits].sort((x, y) => y[0] - x[0])) out.splice(s, e - s, ...n)
    return out.join('\n') + '\n'
  }
  const cases: [string, Edit[], Edit[], string[]][] = [
    ['change | change', [[1, 2, ['L1']]], [[2, 3, ['R2']]], ['left', 'right']],
    ['change | deletion', [[1, 2, ['L1']]], [[2, 3, []]], ['conflict']],
    ['deletion | change', [[1, 2, []]], [[2, 3, ['R2']]], ['left', 'right']],
    ['deletion | deletion', [[1, 2, []]], [[2, 3, []]], ['left', 'right']],
    ['insertion | change', [[2, 2, ['LI']]], [[2, 3, ['R2']]], ['conflict']],
    ['change | insertion', [[3, 3, ['LI']]], [[2, 3, ['R2']]], ['conflict']],
    ['insertion | deletion', [[2, 2, ['LI']]], [[2, 3, []]], ['conflict']],
    ['deletion | insertion', [[3, 3, ['LI']]], [[2, 3, []]], ['right', 'left']],
    ['mirrored change | deletion', [[2, 3, []]], [[1, 2, ['R1']]], ['conflict']],
    ['identical insertions', [[2, 2, ['X']]], [[2, 2, ['X']]], ['both']],
    ['staggered deletions', [[2, 4, []]], [[3, 5, []]], ['left', 'both', 'right']],
    ['deletions with the same start', [[2, 4, []]], [[2, 3, []]], ['both', 'left']],
    ['deletions with the same end', [[2, 4, []]], [[3, 4, []]], ['conflict']],
    ['nested deletions', [[2, 6, []]], [[3, 4, []]], ['conflict']],
    ['insertion inside a change', [[3, 3, ['LI']]], [[2, 5, ['R']]], ['conflict']]
  ]
  for (const [name, l, r, kinds] of cases) {
    it(name, () => {
      const chunks = diff3(L(apply([])), L(apply(l)), L(apply(r)), 'lineEndings')
      expect(chunks.filter((c) => c.kind !== 'equal').map((c) => c.kind)).toEqual(kinds)
    })
  }
})

/**
 * Same-spot edits that share lines: the shared lines become changes common to both, and the
 * rest is one-sided or conflicting. Context lines p0 p1 / q0 q1 surround each case;
 * [base, left, right, expected non-equal chunk kinds].
 */
describe('diff3 splits conflicts on shared lines', () => {
  const wrap = (lines: string[]): Line[] => L(['p0', 'p1', ...lines, 'q0', 'q1'].join('\n') + '\n')
  const cases: [string, string[], string[], string[], string[]][] = [
    ['insertion sharing its end', [], ['a'], ['b', 'a'], ['right', 'both']],
    ['insertion sharing both ends', [], ['a', 'b'], ['a', 'x', 'b'], ['both', 'right', 'both']],
    ['different middles', [], ['a', 'X', 'b'], ['a', 'Y', 'b'], ['both', 'conflict', 'both']],
    ['conflict then one side', [], ['a', 'b'], ['x', 'b', 'c'], ['conflict', 'both', 'right']],
    ['one side on each end', [], ['a', 'b'], ['b', 'c'], ['conflict']],
    ['two conflicts', [], ['a', 'b', 'c'], ['x', 'b', 'y'], ['conflict']],
    ['swapped lines', [], ['a', 'b'], ['b', 'a'], ['conflict']],
    ['shared start then mixed', [], ['a', 'b', 'c'], ['a', 'c', 'b'], ['both', 'conflict']],
    ['no shared line', [], ['x'], ['y'], ['conflict']],
    ['replacement sharing its end', ['old'], ['A', 'B'], ['B'], ['left', 'both']],
    [
      'replacement, one side on each end',
      ['old'],
      ['a', 'b'],
      ['b', 'c'],
      ['left', 'both', 'right']
    ],
    [
      'replacement, two conflicts',
      ['old'],
      ['a', 'b', 'c'],
      ['x', 'b', 'y'],
      ['conflict', 'both', 'conflict']
    ],
    [
      'more base lines than shared ones',
      ['o1', 'o2'],
      ['a', 'b'],
      ['b', 'c'],
      ['conflict', 'both', 'right']
    ],
    ['same shorter replacement on both sides', ['x', 'y', 'u'], ['z'], ['z'], ['both', 'both']],
    ['same longer replacement on both sides', ['x'], ['z', 'w'], ['z', 'w'], ['both']],
    ['shorter replacement on one side', ['x', 'y'], ['z'], ['x', 'y'], ['left']]
  ]
  for (const [name, b, l, r, kinds] of cases) {
    it(name, () => {
      const chunks = diff3(wrap(b), wrap(l), wrap(r), 'lineEndings')
      expect(chunks.filter((c) => c.kind !== 'equal').map((c) => c.kind)).toEqual(kinds)
      // The chunks still tile all three files.
      for (const src of ['base', 'left', 'right'] as const) {
        let pos = 0
        for (const c of chunks) {
          expect(c[src].start).toBe(pos)
          pos = c[src].end
        }
      }
    })
  }
})
