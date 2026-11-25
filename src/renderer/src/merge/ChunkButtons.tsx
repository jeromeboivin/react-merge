import type { ComparisonMethod } from '../../../shared/merge/compare'
import { SOURCES, sameContent, type MergeChunk, type Source } from '../../../shared/merge/diff'
import type { MergeFiles, Segment } from '../../../shared/merge/doc'
import { RoleIcon } from './icons'
import { ROLE_NAME } from './roles'

interface ChunkButtonsProps {
  segments: readonly Segment[]
  chunks: readonly MergeChunk[]
  files: MergeFiles
  method: ComparisonMethod
  lineHeight: number
  scrollTop: number
  height: number
  current: number | null
  onPick: (segIndex: number, src: Source) => void
  onSelectChunk: (chunk: number) => void
}

export const BUTTON_COLUMN_WIDTH = 82
const GROUP_H = 22

/**
 * The column beside the merge result with one group of buttons per changed chunk: click a file's
 * mark to add or remove its text. A mark shown as a dot has the same text as one to its left.
 */
export function ChunkButtons(props: ChunkButtonsProps): React.JSX.Element {
  const {
    segments,
    chunks,
    files,
    method,
    lineHeight,
    scrollTop,
    height,
    current,
    onPick,
    onSelectChunk
  } = props
  const groups: React.JSX.Element[] = []
  let nextFree = -Infinity
  segments.forEach((seg, si) => {
    const chunk = chunks[seg.chunk]
    if (chunk.kind === 'equal') return
    const ideal = seg.start * lineHeight - scrollTop
    const y = Math.max(ideal, nextFree)
    nextFree = y + GROUP_H + 2
    if (y > height || y + GROUP_H < 0) return
    const unresolved = !seg.resolved
    const isCurrent = seg.chunk === current
    groups.push(
      <div
        key={si}
        data-chunk-kind={chunk.kind}
        className="absolute left-1 right-1 flex items-center justify-center gap-1 rounded-[var(--radius-control)] border"
        style={{
          top: y,
          height: GROUP_H,
          borderColor: unresolved
            ? 'var(--m-conflict)'
            : isCurrent
              ? 'var(--color-text-secondary)'
              : 'var(--color-border)',
          background: unresolved ? 'var(--m-bg-conflict)' : 'var(--color-surface-white)',
          boxShadow: 'var(--shadow-sm)'
        }}
        onMouseDown={(e) => {
          e.preventDefault()
          onSelectChunk(seg.chunk)
        }}
      >
        {SOURCES.map((src, idx) => {
          const dupOf = SOURCES.slice(0, idx).find((o) => sameContent(files, chunk, o, src, method))
          const empty = chunk[src].start === chunk[src].end
          const picked =
            seg.selection.includes(src) || (dupOf !== undefined && seg.selection.includes(dupOf))
          const shown = picked && !seg.edited
          const title = `${shown ? 'Remove' : 'Use'} ${ROLE_NAME[src].toLowerCase()} text${empty ? ' (no lines)' : ''}${dupOf ? ` (same as ${ROLE_NAME[dupOf].toLowerCase()})` : ''}`
          return (
            <button
              key={src}
              type="button"
              title={title}
              aria-label={title}
              aria-pressed={shown}
              data-chunk-button={`${seg.chunk}:${src}`}
              className="flex h-[18px] w-[20px] items-center justify-center rounded hover:bg-surface-light"
              onClick={() => {
                onPick(si, src)
              }}
            >
              {dupOf !== undefined || empty ? (
                <span
                  className="block rounded-full"
                  style={{
                    width: 6,
                    height: 6,
                    background: shown && !empty ? 'var(--color-text-secondary)' : 'transparent',
                    border: '1.5px solid var(--color-text-muted)'
                  }}
                />
              ) : (
                <RoleIcon role={src} size={13} filled={shown} muted={!shown} />
              )}
            </button>
          )
        })}
      </div>
    )
  })
  return (
    <div
      className="relative h-full overflow-hidden border-l border-border-light bg-surface"
      style={{ width: BUTTON_COLUMN_WIDTH }}
    >
      {groups}
    </div>
  )
}
