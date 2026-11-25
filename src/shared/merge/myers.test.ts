import { diffSequences, type Hunk } from './myers'

function lcsLength(a: number[], b: number[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  return dp[a.length][b.length]
}

/** Apply hunks to a and check we get b; also check unchanged parts really match. */
function check(a: number[], b: number[], hunks: Hunk[]): number {
  const out: number[] = []
  let i = 0
  let editCost = 0
  for (const h of hunks) {
    expect(h.aStart).toBeGreaterThanOrEqual(i)
    while (i < h.aStart) out.push(a[i++])
    for (let j = h.bStart; j < h.bEnd; j++) out.push(b[j])
    editCost += h.aEnd - h.aStart + (h.bEnd - h.bStart)
    i = h.aEnd
  }
  while (i < a.length) out.push(a[i++])
  expect(out).toEqual(b)
  // Hunks must not touch each other.
  for (let k = 1; k < hunks.length; k++) {
    expect(hunks[k].aStart > hunks[k - 1].aEnd || hunks[k].bStart > hunks[k - 1].bEnd).toBe(true)
  }
  return editCost
}

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

describe('diffSequences', () => {
  it('handles empty inputs', () => {
    expect(diffSequences([], [])).toEqual([])
    expect(diffSequences([1, 2], [])).toEqual([{ aStart: 0, aEnd: 2, bStart: 0, bEnd: 0 }])
    expect(diffSequences([], [3])).toEqual([{ aStart: 0, aEnd: 0, bStart: 0, bEnd: 1 }])
  })

  it('finds a simple change', () => {
    expect(diffSequences([1, 2, 3], [1, 4, 3])).toEqual([
      { aStart: 1, aEnd: 2, bStart: 1, bEnd: 2 }
    ])
  })

  it('is minimal on random inputs', () => {
    const r = rng(42)
    for (let t = 0; t < 600; t++) {
      const alpha = 1 + Math.floor(r() * 5)
      const a = Array.from({ length: Math.floor(r() * 25) }, () => Math.floor(r() * alpha))
      const b = Array.from({ length: Math.floor(r() * 25) }, () => Math.floor(r() * alpha))
      const hunks = diffSequences(a, b, { slide: false })
      const cost = check(a, b, hunks)
      expect(cost).toBe(a.length + b.length - 2 * lcsLength(a, b))
      // Sliding keeps the script valid and the same cost.
      const slid = diffSequences(a, b)
      expect(check(a, b, slid)).toBe(cost)
    }
  })

  it('stays valid on large dissimilar inputs (cost cap)', () => {
    const r = rng(7)
    const a = Array.from({ length: 3000 }, () => Math.floor(r() * 1000))
    const b = Array.from({ length: 3000 }, () => Math.floor(r() * 1000))
    check(a, b, diffSequences(a, b))
  })

  it('places ambiguous insertions and deletions', () => {
    // As far down as possible when nothing changes on the other side nearby.
    // a: a } _ main x   b: a } _ sub } _ main x
    expect(diffSequences([1, 2, 0, 3, 4], [1, 2, 0, 5, 2, 0, 3, 4])).toEqual([
      { aStart: 3, aEnd: 3, bStart: 3, bEnd: 6 }
    ])
    // p q r q r s -> p q r s: the lower "q r" is the deleted one.
    expect(diffSequences([1, 2, 3, 2, 3, 4], [1, 2, 3, 4])).toEqual([
      { aStart: 3, aEnd: 5, bStart: 3, bEnd: 3 }
    ])
    // Next to a changed line it joins it: X } _ M  vs  Y } _ S } _ M  is one replacement.
    expect(diffSequences([1, 2, 0, 3], [9, 2, 0, 5, 2, 0, 3])).toEqual([
      { aStart: 0, aEnd: 1, bStart: 0, bEnd: 4 }
    ])
  })
})
