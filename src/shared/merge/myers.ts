/**
 * Line (or token) diff with deterministic choices, which matter whenever several minimal
 * edit scripts exist:
 *
 * - Myers' O(ND) search, linear-space variant, finding the *middle snake* (the matching run where
 *   the forward and backward searches meet) and recursing on both sides of it.
 * - Each region first loses its common prefix (recorded as a run) or, failing that, its common
 *   suffix (the part before it is solved first).
 * - The search visits diagonals in ascending order each round, prefers moving right (dropping a
 *   line of `a`) on ties, and splits at the first overlap found.
 * - Past a cost cap (inputs with huge differences) the region is split at its geometric middle,
 *   with the matching run through that point, which keeps the result valid if not minimal.
 * - Finally a "forward bias" pass moves every ambiguous gap as far down as it can go, merging
 *   gaps that meet.
 */

/** a[aStart..aEnd) is replaced by b[bStart..bEnd). Hunks are sorted and never touch. */
export interface Hunk {
  aStart: number
  aEnd: number
  bStart: number
  bEnd: number
}

type Seq = ArrayLike<number>

export interface DiffOptions {
  /** Slide ambiguous gaps down (forward bias). Default true. */
  slide?: boolean
}

/** A matching run: a[x..u) equals b[y..v). */
interface Run {
  x: number
  u: number
  y: number
  v: number
}

export function diffSequences(a: Seq, b: Seq, options: DiffOptions = {}): Hunk[] {
  const runs = matchingRuns(a, b)
  bracket(runs, a.length, b.length)
  if (options.slide !== false) forwardBias(runs, a, b)
  const hunks: Hunk[] = []
  for (let i = 1; i < runs.length; i++) {
    const p = runs[i - 1]
    const r = runs[i]
    if (r.x > p.u || r.y > p.v) hunks.push({ aStart: p.u, aEnd: r.x, bStart: p.v, bEnd: r.y })
  }
  return hunks
}

/** The largest number of edit rounds tried before splitting a region at its middle. */
function costCap(n: number, m: number): number {
  const half = Math.trunc((n + m) / 2)
  let limit = half < 50_000 ? 100_000_000 : 10_000_000
  if (half !== 0) limit = Math.trunc(limit / half)
  return Math.max(42, Math.min(half, limit))
}

function matchingRuns(a: Seq, b: Seq): Run[] {
  const runs: Run[] = []
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return runs
  const cap = costCap(n, m)
  // Diagonal arrays, indexed from -size..size.
  const size = cap + 2
  const fwd = new Int32Array(2 * size + 1)
  const bwd = new Int32Array(2 * size + 1)
  const F = (k: number): number => fwd[k + size]
  const B = (c: number): number => bwd[c + size]

  /** The middle snake of a[x0..x1) × b[y0..y1) (both non-empty, no common prefix/suffix). */
  const middle = (x0: number, y0: number, x1: number, y1: number): Run => {
    const N = x1 - x0
    const M = y1 - y0
    const delta = N - M
    const odd = (delta & 1) !== 0
    fwd[size] = x0
    bwd[size] = x1
    for (let d = 1; d <= cap; d++) {
      const kLo = d > M ? d - 2 * M : -d
      const kHi = d <= N ? d : 2 * N - d
      // The backward search's range after d - 1 rounds.
      const cLoPrev = d - 1 <= N ? 1 - d : d - 1 - 2 * N
      const cHiPrev = d - 1 <= M ? d - 1 : 2 * M - (d - 1)
      for (let k = kLo; k <= kHi; k += 2) {
        let x: number
        if (k === kLo) x = F(k + 1)
        else if (k === kHi || F(k + 1) <= F(k - 1)) x = F(k - 1) + 1
        else x = F(k + 1)
        let y = x - k + (y0 - x0)
        const sx = x
        const sy = y
        while (x < x1 && y < y1 && a[x] === b[y]) {
          x++
          y++
        }
        if (odd) {
          const c = k - delta
          if (c >= cLoPrev && c <= cHiPrev && B(c) <= x) return { x: sx, u: x, y: sy, v: y }
        }
        fwd[k + size] = x
      }
      const cLo = -kHi
      const cHi = -kLo
      for (let c = cLo; c <= cHi; c += 2) {
        let x: number
        if (c === cHi) x = B(c - 1)
        else if (c === cLo || B(c + 1) <= B(c - 1)) x = B(c + 1) - 1
        else x = B(c - 1)
        let y = x + (y1 - x1) - c
        const ex = x
        const ey = y
        while (x > x0 && y > y0 && a[x - 1] === b[y - 1]) {
          x--
          y--
        }
        if (!odd) {
          const k = c + delta
          if (k >= kLo && k <= kHi && x <= F(k)) return { x, u: ex, y, v: ey }
        }
        bwd[c + size] = x
      }
    }
    // Too expensive: take the matching run through the middle of the region.
    let x = x0 + Math.trunc(N / 2)
    let y = y0 + Math.trunc(M / 2)
    if (x <= x0) return { x, u: x, y, v: y } // degenerate: skip b[y0..y)
    if (y > y0) {
      while (x > x0 && y > y0 && a[x - 1] === b[y - 1]) {
        x--
        y--
      }
    }
    let u = x0 + Math.trunc(N / 2)
    let v = y0 + Math.trunc(M / 2)
    while (u < x1 && v < y1 && a[u] === b[v]) {
      u++
      v++
    }
    return { x, u, y, v }
  }

  // Explicit stack of regions to solve, processed in order so runs come out sorted.
  const solve = (sx0: number, sy0: number, sx1: number, sy1: number): void => {
    let x0 = sx0
    let y0 = sy0
    const x1 = sx1
    const y1 = sy1
    for (;;) {
      if (x0 >= x1 || y0 >= y1) return
      // Common prefix.
      let px = x0
      let py = y0
      while (px < x1 && py < y1 && a[px] === b[py]) {
        px++
        py++
      }
      if (px > x0) {
        runs.push({ x: x0, u: px, y: y0, v: py })
        x0 = px
        y0 = py
        continue
      }
      // Common suffix: solve what precedes it, then record it.
      let qx = x1
      let qy = y1
      while (qx > x0 && qy > y0 && a[qx - 1] === b[qy - 1]) {
        qx--
        qy--
      }
      if (qx < x1) {
        if (qx > x0 && qy > y0) solve(x0, y0, qx, qy)
        runs.push({ x: qx, u: x1, y: qy, v: y1 })
        return
      }
      const s = middle(x0, y0, x1, y1)
      if (s.x > x0 && s.y > y0) solve(x0, y0, s.x, s.y)
      if (s.u > s.x) runs.push(s)
      x0 = s.u
      y0 = s.v
    }
  }
  solve(0, 0, n, m)
  return runs
}

/** Make sure the runs start at (0,0) and end at (n,m), with empty runs if needed. */
function bracket(runs: Run[], n: number, m: number): void {
  const first = runs.length > 0 ? runs[0] : undefined
  if (first?.x !== 0 || first.y !== 0) runs.unshift({ x: 0, u: 0, y: 0, v: 0 })
  const last = runs[runs.length - 1]
  if (last.u < n || last.v < m) runs.push({ x: n, u: n, y: m, v: m })
}

/**
 * Grow each run forward while the lines after it still match, taking them from the start of the
 * next run; a run emptied this way disappears (except the final one), so the gaps around it merge.
 */
function forwardBias(runs: Run[], a: Seq, b: Seq): void {
  let i = 0
  while (i + 1 < runs.length) {
    const cur = runs[i]
    while (cur.u < a.length && cur.v < b.length && a[cur.u] === b[cur.v]) {
      cur.u++
      cur.v++
      const next = runs[i + 1] as Run | undefined
      if (!next) break
      if (next.x < cur.u || next.y < cur.v) {
        next.x++
        next.y++
        if (next.x === next.u && i + 1 !== runs.length - 1) runs.splice(i + 1, 1)
      }
    }
    i++
  }
}
