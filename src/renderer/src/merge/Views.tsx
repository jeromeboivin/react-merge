import { Pencil } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { ComparisonMethod } from '../../../shared/merge/compare'
import type { Range, Source } from '../../../shared/merge/diff'
import type { EditDoc } from '../../../shared/merge/doc'
import { Bands, type BandSpec } from './Bands'
import { ChunkButtons } from './ChunkButtons'
import { RoleIcon, type Role } from './icons'
import { useScrollSync, useSize, type Handles } from './hooks'
import {
  BAND_FILL,
  buildPlainDoc,
  sharedText,
  mergeDecor,
  paneDecor,
  unifiedDecor,
  type DiffData,
  type MergeData,
  type Side,
  type UnifiedView
} from './model'
import type { SyntaxSeg } from './syntax'
import { TextPane, type TextPaneHandle } from './TextPane'

export type { Handles }
export type Register = (id: string, h: TextPaneHandle | null) => void

export interface PaneSettings {
  showLineNumbers: boolean
  showWhitespace: boolean
  inlineDiffs: boolean
  tabWidth: number
  insertSpaces: boolean
  fontFamily: string
  fontSize: number
  newEol: '\n' | '\r\n' | '\r'
}

const BAND_W = 44
const HEADER_H = 28

// ── Pieces ──

export function PaneHeader({
  role,
  label,
  title,
  editable,
  dirty,
  active,
  extra
}: {
  role: Role
  label: string
  title?: string
  editable?: boolean
  dirty?: boolean
  active?: boolean
  extra?: ReactNode
}): React.JSX.Element {
  return (
    <div
      className="flex min-w-0 items-center gap-2 border-b border-border-light bg-surface px-2"
      style={{
        height: HEADER_H,
        boxShadow: active ? 'inset 0 -2px 0 var(--color-brand)' : undefined
      }}
      title={title}
    >
      <RoleIcon role={role} size={13} />
      <span className="truncate text-meta font-medium text-text" data-pane-label={role}>
        {label}
        {dirty ? ' *' : ''}
      </span>
      {editable && (
        <span
          className="flex items-center gap-1 rounded bg-brand-soft px-1.5 text-[11px] text-brand"
          title="This pane can be edited"
        >
          <Pencil size={10} /> editing
        </span>
      )}
      <span className="flex-1" />
      {extra}
    </div>
  )
}

function Splitter({ onDrag }: { onDrag: (dy: number, done: boolean) => void }): React.JSX.Element {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className="flex h-[6px] shrink-0 cursor-row-resize items-center justify-center border-y border-border-light bg-surface hover:bg-surface-light"
      onMouseDown={(e) => {
        e.preventDefault()
        const y0 = e.clientY
        const move = (ev: MouseEvent): void => {
          onDrag(ev.clientY - y0, false)
        }
        const up = (ev: MouseEvent): void => {
          onDrag(ev.clientY - y0, true)
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }}
    >
      <span className="h-[2px] w-8 rounded bg-border" />
    </div>
  )
}

function BandColumn({
  height,
  lineHeight,
  aTop,
  bTop,
  bands
}: {
  height: number
  lineHeight: number
  aTop: number
  bTop: number
  bands: BandSpec[]
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 flex-col" style={{ width: BAND_W }}>
      <div
        className="shrink-0 border-b border-border-light bg-surface"
        style={{ height: HEADER_H }}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <Bands
          width={BAND_W}
          height={Math.max(0, height - HEADER_H)}
          lineHeight={lineHeight}
          aTop={aTop}
          bTop={bTop}
          bands={bands}
        />
      </div>
    </div>
  )
}

// ── 2-way, side by side ──

export interface DiffViewProps {
  left: Side
  right: Side
  leftDoc: EditDoc
  rightDoc: EditDoc
  data: DiffData
  version: number
  editLeft: boolean
  editRight: boolean
  settings: PaneSettings
  syntax: Record<string, SyntaxSeg[][] | null>
  current: number | null
  active: string
  handles: React.RefObject<Handles>
  register: Register
  onFocusPane: (id: string) => void
  onEdit: (id: string) => void
  onReadOnlyInput: (id: string) => void
}

export function DiffView(p: DiffViewProps): React.JSX.Element {
  // A read-only right pane shows the left text in unchanged regions.
  const { editRight, rightDoc, leftDoc, data } = p
  const rightShown = useMemo(
    () =>
      editRight
        ? rightDoc
        : buildPlainDoc(
            sharedText(
              rightDoc.lines,
              leftDoc.lines,
              data.chunks.map((c) => ({ equal: c.equal, own: c.right, ref: c.left }))
            )
          ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- docs are mutable; version marks edits
    [editRight, rightDoc, leftDoc, data, p.version]
  )
  const ranges = {
    left: p.data.chunks.map((c) => c.left),
    right: p.data.chunks.map((c) => c.right)
  }
  const sync = useScrollSync(p.handles, ranges)
  const [boxRef, size] = useSize<HTMLDivElement>()
  const colorOf = (k: number): string | null => (p.data.chunks[k].equal ? null : 'x')
  const left = paneDecor(
    ranges.left,
    (k) => (colorOf(k) ? 'left' : null),
    p.settings.inlineDiffs ? p.data.inlineL : null,
    p.current
  )
  const right = paneDecor(
    ranges.right,
    (k) => (colorOf(k) ? 'right' : null),
    p.settings.inlineDiffs ? p.data.inlineR : null,
    p.current
  )
  const lh = Math.round(p.settings.fontSize * 1.5)
  const bands: BandSpec[] = p.data.chunks.flatMap((c, k) =>
    c.equal ? [] : [{ a: c.left, b: c.right, fill: BAND_FILL.change, current: k === p.current }]
  )
  return (
    <div ref={boxRef} className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PaneHeader
          role="left"
          label={p.left.label}
          title={p.left.path}
          editable={p.editLeft}
          dirty={p.leftDoc.dirty}
          active={p.active === 'left'}
        />
        <div className="min-h-0 flex-1">
          <TextPane
            ref={(h) => {
              p.register('left', h)
            }}
            id="left"
            doc={p.leftDoc}
            version={p.version}
            editable={p.editLeft}
            decor={left.decor}
            markers={left.markers}
            syntax={p.syntax.left}
            {...paneProps(p.settings)}
            onScroll={sync.onScroll}
            onFocus={p.onFocusPane}
            onEdit={p.onEdit}
            onReadOnlyInput={p.onReadOnlyInput}
          />
        </div>
      </div>
      <BandColumn
        height={size.height}
        lineHeight={lh}
        aTop={sync.tops.left ?? 0}
        bTop={sync.tops.right ?? 0}
        bands={bands}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <PaneHeader
          role="right"
          label={p.right.label}
          title={p.right.path}
          editable={p.editRight}
          dirty={p.rightDoc.dirty}
          active={p.active === 'right'}
        />
        <div className="min-h-0 flex-1">
          <TextPane
            ref={(h) => {
              p.register('right', h)
            }}
            id="right"
            doc={rightShown}
            version={p.version}
            editable={p.editRight}
            decor={right.decor}
            markers={right.markers}
            syntax={p.syntax.right}
            {...paneProps(p.settings)}
            onScroll={sync.onScroll}
            onFocus={p.onFocusPane}
            onEdit={p.onEdit}
            onReadOnlyInput={p.onReadOnlyInput}
          />
        </div>
      </div>
    </div>
  )
}

function paneProps(s: PaneSettings): Omit<PaneSettings, 'inlineDiffs'> {
  return {
    showLineNumbers: s.showLineNumbers,
    showWhitespace: s.showWhitespace,
    tabWidth: s.tabWidth,
    insertSpaces: s.insertSpaces,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    newEol: s.newEol
  }
}

// ── 2-way, single pane ──

export function UnifiedDiffView({
  left,
  right,
  view,
  settings,
  syntax,
  current,
  register,
  onFocusPane
}: {
  left: Side
  right: Side
  view: UnifiedView
  settings: PaneSettings
  syntax: SyntaxSeg[][] | null
  current: number | null
  register: Register
  onFocusPane: (id: string) => void
}): React.JSX.Element {
  const decor = unifiedDecor(view, current)
  const inlineOff = !settings.inlineDiffs
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader
        role="merge"
        label={`${left.label} → ${right.label}`}
        title={`${left.path}\n${right.path}`}
        extra={
          <span className="flex items-center gap-3 text-meta text-text-secondary">
            <span className="flex items-center gap-1">
              <RoleIcon role="left" size={11} /> {left.label}
            </span>
            <span className="flex items-center gap-1">
              <RoleIcon role="right" size={11} /> {right.label}
            </span>
          </span>
        }
      />
      <div className="min-h-0 flex-1">
        <TextPane
          ref={(h) => {
            register('unified', h)
          }}
          id="unified"
          doc={view.doc}
          version={0}
          editable={false}
          decor={(i) => {
            const d = decor(i)
            return inlineOff && d ? { ...d, spans: undefined } : d
          }}
          syntax={syntax}
          lineLabel={(i) => view.labels[i] ?? ''}
          {...paneProps(settings)}
          onFocus={onFocusPane}
        />
      </div>
    </div>
  )
}

// ── 3-way ──

export interface MergeViewProps {
  base: Side
  left: Side
  right: Side
  mergeLabel: string
  mergePath: string | null
  files: Record<Source, readonly import('../../../shared/merge/text').Line[]>
  data: MergeData
  method: ComparisonMethod
  baseDoc: EditDoc
  leftDoc: EditDoc
  rightDoc: EditDoc
  doc: EditDoc
  version: number
  settings: PaneSettings
  showBase: boolean
  split: number
  onSplit: (f: number) => void
  syntax: Record<string, SyntaxSeg[][] | null>
  current: number | null
  active: string
  handles: React.RefObject<Handles>
  register: Register
  onFocusPane: (id: string) => void
  onEdit: (id: string) => void
  onPick: (segIndex: number, src: Source) => void
  onSelectChunk: (chunk: number) => void
  dirty: boolean
}

export function MergeView(p: MergeViewProps): React.JSX.Element {
  const chunks = p.data.chunks
  const segs = p.doc.segments ?? []
  const ranges: Record<string, Range[]> = {
    left: chunks.map((c) => c.left),
    right: chunks.map((c) => c.right),
    merge: segs.map((g) => ({ start: g.start, end: g.start + g.count })),
    ...(p.showBase ? { base: chunks.map((c) => c.base) } : {})
  }
  const sync = useScrollSync(p.handles, ranges)
  const [boxRef, box] = useSize<HTMLDivElement>()
  const [topRef, topSize] = useSize<HTMLDivElement>()
  const [mergeRef, mergeSize] = useSize<HTMLDivElement>()
  const [dragSplit, setDragSplit] = useState<number | null>(null)
  const split = dragSplit ?? p.split
  const lh = Math.round(p.settings.fontSize * 1.5)
  const inl = p.settings.inlineDiffs

  const changed = (side: 'left' | 'right') => (k: number) => {
    const kind = chunks[k].kind
    return kind === side || kind === 'both' || kind === 'conflict'
  }
  const leftD = paneDecor(
    ranges.left,
    (k) => (changed('left')(k) ? 'left' : null),
    inl ? p.data.inline.left : null,
    p.current
  )
  const rightD = paneDecor(
    ranges.right,
    (k) => (changed('right')(k) ? 'right' : null),
    inl ? p.data.inline.right : null,
    p.current
  )
  const baseD = paneDecor(
    chunks.map((c) => c.base),
    (k) => (chunks[k].kind === 'equal' ? null : 'base'),
    inl ? p.data.inline.base : null,
    p.current
  )
  const mergeD = mergeDecor(p.doc, p.data, p.current)
  const mergeDecorFn = inl
    ? mergeD.decor
    : (i: number) => {
        const d = mergeD.decor(i)
        return d ? { ...d, spans: undefined } : d
      }

  const bandFor = (side: 'left' | 'right', a: 'left' | 'base', b: 'base' | 'right'): BandSpec[] =>
    chunks.flatMap((c, k) =>
      changed(side)(k)
        ? [
            {
              a: c[a],
              b: c[b],
              fill: c.kind === 'conflict' ? BAND_FILL.conflict : BAND_FILL[side],
              current: k === p.current
            }
          ]
        : []
    )
  const lrBands: BandSpec[] = chunks.flatMap((c, k) =>
    c.kind === 'equal'
      ? []
      : [
          {
            a: c.left,
            b: c.right,
            fill: c.kind === 'conflict' ? BAND_FILL.conflict : BAND_FILL.change,
            current: k === p.current
          }
        ]
  )

  const pane = (
    id: 'left' | 'base' | 'right',
    doc: EditDoc,
    side: Side,
    d: ReturnType<typeof paneDecor>
  ): React.JSX.Element => (
    <div className="flex min-w-0 flex-1 flex-col">
      <PaneHeader role={id} label={side.label} title={side.path} active={p.active === id} />
      <div className="min-h-0 flex-1">
        <TextPane
          ref={(h) => {
            p.register(id, h)
          }}
          id={id}
          doc={doc}
          version={0}
          editable={false}
          decor={d.decor}
          markers={d.markers}
          syntax={p.syntax[id]}
          {...paneProps(p.settings)}
          onScroll={sync.onScroll}
          onFocus={p.onFocusPane}
        />
      </div>
    </div>
  )

  const topH = Math.max(80, Math.min(box.height - 120, box.height * split))
  return (
    <div ref={boxRef} className="flex min-h-0 flex-1 flex-col">
      <div ref={topRef} className="flex shrink-0" style={{ height: topH }}>
        {pane('left', p.leftDoc, p.left, leftD)}
        {p.showBase ? (
          <>
            <BandColumn
              height={topSize.height}
              lineHeight={lh}
              aTop={sync.tops.left ?? 0}
              bTop={sync.tops.base ?? 0}
              bands={bandFor('left', 'left', 'base')}
            />
            {pane('base', p.baseDoc, p.base, baseD)}
            <BandColumn
              height={topSize.height}
              lineHeight={lh}
              aTop={sync.tops.base ?? 0}
              bTop={sync.tops.right ?? 0}
              bands={bandFor('right', 'base', 'right')}
            />
          </>
        ) : (
          <BandColumn
            height={topSize.height}
            lineHeight={lh}
            aTop={sync.tops.left ?? 0}
            bTop={sync.tops.right ?? 0}
            bands={lrBands}
          />
        )}
        {pane('right', p.rightDoc, p.right, rightD)}
      </div>
      <Splitter
        onDrag={(dy, done) => {
          const f = Math.max(0.15, Math.min(0.85, (topH + dy) / Math.max(1, box.height)))
          if (done) {
            setDragSplit(null)
            p.onSplit(f)
          } else setDragSplit(f)
        }}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <PaneHeader
          role="merge"
          label={p.mergeLabel}
          title={p.mergePath ?? 'Not saved yet'}
          editable
          dirty={p.dirty}
          active={p.active === 'merge'}
        />
        <div ref={mergeRef} className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <TextPane
              ref={(h) => {
                p.register('merge', h)
              }}
              id="merge"
              doc={p.doc}
              version={p.version}
              editable
              decor={mergeDecorFn}
              markers={mergeD.markers}
              syntax={p.syntax.merge}
              {...paneProps(p.settings)}
              onScroll={sync.onScroll}
              onFocus={p.onFocusPane}
              onEdit={p.onEdit}
            />
          </div>
          <ChunkButtons
            segments={segs}
            chunks={chunks}
            files={p.files}
            method={p.method}
            lineHeight={lh}
            scrollTop={sync.tops.merge ?? 0}
            height={mergeSize.height}
            current={p.current}
            onPick={p.onPick}
            onSelectChunk={p.onSelectChunk}
          />
        </div>
      </div>
    </div>
  )
}
