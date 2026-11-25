import { errorReport, parseArgs } from './args'

const exists = (p: string): boolean => !p.startsWith('missing')

describe('parseArgs', () => {
  it('lays out 2, 3 and 4 files', () => {
    expect(parseArgs(['l', 'r'], exists)).toEqual({
      kind: 'run',
      options: { labels: {}, left: 'l', right: 'r' }
    })
    expect(parseArgs(['b', 'l', 'r', 'm'], exists)).toEqual({
      kind: 'run',
      options: { labels: {}, base: 'b', left: 'l', right: 'r', merge: 'm' }
    })
    expect(parseArgs([], exists)).toEqual({ kind: 'run', options: { labels: {} } })
  })

  it('reads options', () => {
    const r = parseArgs(
      ['-dw', '-tw', '4', '-le', 'win', '-C', 'utf8-bom', '-nl', 'Mine', 'l', 'r'],
      exists
    )
    expect(r).toEqual({
      kind: 'run',
      options: {
        labels: { left: 'Mine' },
        comparison: 'whitespace',
        tabWidth: 4,
        lineEnding: 'win',
        charset: 'utf8-bom',
        left: 'l',
        right: 'r'
      }
    })
  })

  it('requires the merge result file to exist', () => {
    expect(parseArgs(['b', 'l', 'r', 'missing-out'], exists)).toEqual({
      kind: 'error',
      errors: ["'missing-out' is not a file (or does not exist)."]
    })
  })

  it('reports every error', () => {
    const r = parseArgs(
      ['-zz', '-db', '-dw', '-le', 'foo', '-C', 'bogus', '-tw', 'abc', 'missing'],
      exists
    )
    expect(r.kind).toBe('error')
    if (r.kind !== 'error') return
    expect(r.errors).toEqual([
      "'-zz' is not a valid option.",
      "'foo' is not a valid line ending.",
      "'bogus' is not a valid character encoding.",
      "'abc' is not a valid tab spacing.",
      '-db, -dw: these comparison options cannot be combined; use only one.',
      'At least two files are needed (React Merge opens 0, 2, 3 or 4 files).',
      "'missing' is not a file (or does not exist)."
    ])
    expect(errorReport(['x'])).toContain("Use 'react-merge -h'")
  })

  it('handles help and version first', () => {
    expect(parseArgs(['-h', 'x'], exists)).toEqual({ kind: 'help' })
    expect(parseArgs(['-V'], exists)).toEqual({ kind: 'version' })
  })
})
