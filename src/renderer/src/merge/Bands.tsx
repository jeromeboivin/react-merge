import type { Range } from '../../../shared/merge/diff'

export interface BandSpec {
  a: Range
  b: Range
  fill: string
  current: boolean
}

interface BandsProps {
  width: number
  height: number
  lineHeight: number
  aTop: number
  bTop: number
  bands: readonly BandSpec[]
}

/**
 * The strip between two panes: each changed chunk is a curved band joining its lines on the
 * left to its lines on the right, following both panes' scroll positions.
 */
export function Bands({
  width,
  height,
  lineHeight,
  aTop,
  bTop,
  bands
}: BandsProps): React.JSX.Element {
  const paths: React.JSX.Element[] = []
  const w = width
  const mid = w / 2
  bands.forEach((band, k) => {
    const a1 = band.a.start * lineHeight - aTop
    const a2 = band.a.end * lineHeight - aTop
    const b1 = band.b.start * lineHeight - bTop
    const b2 = band.b.end * lineHeight - bTop
    if (Math.max(a2, b2) < -2 || Math.min(a1, b1) > height + 2) return
    const d = `M0,${a1} C${mid},${a1} ${mid},${b1} ${w},${b1} L${w},${b2} C${mid},${b2} ${mid},${a2} 0,${a2} Z`
    paths.push(
      <path
        key={k}
        d={d}
        fill={band.fill}
        stroke={
          band.current
            ? 'var(--m-current)'
            : 'color-mix(in srgb, var(--color-text-muted) 55%, transparent)'
        }
        strokeWidth={band.current ? 1.5 : 0.75}
      />
    )
  })
  return (
    <svg
      width={w}
      height={height}
      className="block"
      style={{ background: 'var(--color-surface)' }}
      aria-hidden
    >
      {paths}
    </svg>
  )
}
