import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Code,
  Columns2,
  Columns3,
  Hash,
  Highlighter,
  ListOrdered,
  Pilcrow,
  RefreshCw,
  Redo2,
  Rows2,
  Save,
  Search,
  SquarePen,
  Undo2,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CHARSET_GROUPS, CHARSETS, charsetLabel } from '../../../shared/charsets'
import type { CommandId } from '../../../shared/ipc'
import {
  COMPARISON_LABELS,
  COMPARISON_METHODS,
  COMPARISON_SHORT,
  type ComparisonMethod
} from '../../../shared/merge/compare'
import type { MergeStats } from '../../../shared/merge/diff'
import { LINE_ENDING_LABELS, type LineEndingStyle } from '../../../shared/merge/text'
import { RoleIcon } from './icons'

export interface ToolbarState {
  mode: 'diff' | 'merge'
  canSave: boolean
  canUndo: boolean
  canRedo: boolean
  editLeft: boolean
  editRight: boolean
  hasPrevDiff: boolean
  hasNextDiff: boolean
  hasPrevConflict: boolean
  hasNextConflict: boolean
  showWhitespace: boolean
  showLineNumbers: boolean
  inlineDiffs: boolean
  syntaxHighlighting: boolean
  singlePane: boolean
  showBase: boolean
}

function ToolButton({
  icon: Icon,
  label,
  shortcut,
  onClick,
  disabled,
  pressed,
  color,
  badge
}: {
  icon: LucideIcon
  label: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  color?: string
  badge?: string
}): React.JSX.Element {
  const title = shortcut ? `${label} (${shortcut})` : label
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault()
      }}
      onClick={onClick}
      className={`relative flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-text-secondary hover:bg-surface-light hover:text-text disabled:pointer-events-none disabled:opacity-35 ${pressed ? 'bg-surface-lighter text-text' : ''}`}
    >
      <Icon size={16} strokeWidth={1.8} style={color && !disabled ? { color } : undefined} />
      {badge && (
        <span className="absolute right-0.5 bottom-0 text-[9px] leading-none font-bold">
          {badge}
        </span>
      )}
    </button>
  )
}

const Sep = (): React.JSX.Element => <span className="mx-1 h-5 w-px bg-border" />

export function Toolbar({
  s,
  run
}: {
  s: ToolbarState
  run: (id: CommandId) => void
}): React.JSX.Element {
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border bg-surface px-2"
      role="toolbar"
      aria-label="Toolbar"
    >
      <ToolButton
        icon={RefreshCw}
        label="Refresh all"
        shortcut="F5"
        onClick={() => {
          run('refresh')
        }}
      />
      <ToolButton
        icon={Save}
        label="Save"
        shortcut="Ctrl+S"
        disabled={!s.canSave}
        onClick={() => {
          run('save')
        }}
      />
      {s.mode === 'diff' && (
        <>
          <Sep />
          <ToolButton
            icon={SquarePen}
            label="Edit file in left pane"
            badge="L"
            pressed={s.editLeft}
            disabled={s.singlePane}
            onClick={() => {
              run('editLeft')
            }}
          />
          <ToolButton
            icon={SquarePen}
            label="Edit file in right pane"
            badge="R"
            pressed={s.editRight}
            disabled={s.singlePane}
            onClick={() => {
              run('editRight')
            }}
          />
        </>
      )}
      <Sep />
      <ToolButton
        icon={Undo2}
        label="Undo"
        shortcut="Ctrl+Z"
        disabled={!s.canUndo}
        onClick={() => {
          run('undo')
        }}
      />
      <ToolButton
        icon={Redo2}
        label="Redo"
        shortcut="Ctrl+Y"
        disabled={!s.canRedo}
        onClick={() => {
          run('redo')
        }}
      />
      <Sep />
      <ToolButton
        icon={ArrowUp}
        label="Previous diff"
        shortcut="Ctrl+1"
        color="var(--m-right)"
        disabled={!s.hasPrevDiff}
        onClick={() => {
          run('prevDiff')
        }}
      />
      <ToolButton
        icon={ArrowDown}
        label="Next diff"
        shortcut="Ctrl+2"
        color="var(--m-right)"
        disabled={!s.hasNextDiff}
        onClick={() => {
          run('nextDiff')
        }}
      />
      {s.mode === 'merge' && (
        <>
          <ToolButton
            icon={ChevronsUp}
            label="Previous conflict"
            shortcut="Ctrl+3"
            color="var(--m-conflict)"
            disabled={!s.hasPrevConflict}
            onClick={() => {
              run('prevConflict')
            }}
          />
          <ToolButton
            icon={ChevronsDown}
            label="Next conflict"
            shortcut="Ctrl+4"
            color="var(--m-conflict)"
            disabled={!s.hasNextConflict}
            onClick={() => {
              run('nextConflict')
            }}
          />
        </>
      )}
      <Sep />
      <ToolButton
        icon={Search}
        label="Find"
        shortcut="Ctrl+F"
        onClick={() => {
          run('find')
        }}
      />
      <ToolButton
        icon={Hash}
        label="Go to line number"
        shortcut="Ctrl+G"
        onClick={() => {
          run('goto')
        }}
      />
      <Sep />
      <ToolButton
        icon={Pilcrow}
        label="Show tabs and spaces"
        pressed={s.showWhitespace}
        onClick={() => {
          run('toggleWhitespace')
        }}
      />
      <ToolButton
        icon={ListOrdered}
        label="Show line numbers"
        shortcut="Ctrl+L"
        pressed={s.showLineNumbers}
        onClick={() => {
          run('toggleLineNumbers')
        }}
      />
      <ToolButton
        icon={Highlighter}
        label="Show inline differences"
        shortcut="Ctrl+I"
        pressed={s.inlineDiffs}
        onClick={() => {
          run('toggleInline')
        }}
      />
      <ToolButton
        icon={Code}
        label="Show syntax highlighting"
        shortcut="Ctrl+Shift+H"
        pressed={s.syntaxHighlighting}
        onClick={() => {
          run('toggleSyntax')
        }}
      />
      <Sep />
      {s.mode === 'diff' ? (
        <>
          <ToolButton
            icon={Columns2}
            label="Double pane diff layout"
            pressed={!s.singlePane}
            onClick={() => {
              run('doublePane')
            }}
          />
          <ToolButton
            icon={Rows2}
            label="Single pane diff layout"
            pressed={s.singlePane}
            onClick={() => {
              run('singlePane')
            }}
          />
        </>
      ) : (
        <ToolButton
          icon={Columns3}
          label="Show base file"
          pressed={s.showBase}
          onClick={() => {
            run('toggleBase')
          }}
        />
      )}
    </div>
  )
}

// ── Status bar ──

interface MenuItem {
  label: string
  checked?: boolean
  header?: boolean
  onClick?: () => void
}

function Popover({
  items,
  onClose,
  anchor
}: {
  items: MenuItem[]
  onClose: () => void
  anchor: DOMRect
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 max-h-[60vh] min-w-[220px] overflow-auto rounded-[var(--radius-menu)] border border-border bg-surface-white p-1.5 text-ui"
      style={{ left: anchor.left, top: anchor.bottom + 4, boxShadow: 'var(--shadow-lg)' }}
    >
      {items.map((it, i) =>
        it.header ? (
          <div key={i} className="px-2 pt-2 pb-1 text-meta font-semibold text-text-muted">
            {it.label}
          </div>
        ) : (
          <button
            key={i}
            type="button"
            role="menuitemradio"
            aria-checked={it.checked}
            className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1 text-left hover:bg-surface-light"
            onClick={() => {
              it.onClick?.()
              onClose()
            }}
          >
            <span className="w-3 text-brand">{it.checked ? '●' : ''}</span>
            {it.label}
          </button>
        )
      )}
    </div>
  )
}

function StatusItem({
  children,
  title,
  menu
}: {
  children: ReactNode
  title: string
  menu?: () => MenuItem[]
}): React.JSX.Element {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  return (
    <>
      <button
        type="button"
        title={title}
        className="h-full rounded px-2 text-meta text-text-secondary hover:bg-surface-light hover:text-text"
        onClick={(e) => {
          if (menu) setAnchor(e.currentTarget.getBoundingClientRect())
        }}
      >
        {children}
      </button>
      {anchor && menu && (
        <Popover
          items={menu()}
          anchor={anchor}
          onClose={() => {
            setAnchor(null)
          }}
        />
      )}
    </>
  )
}

export function StatusBar({
  mode,
  diffs,
  comparison,
  tabWidth,
  insertSpaces,
  charset,
  lineEnding,
  onComparison,
  onCharset,
  onLineEnding,
  onTabOptions
}: {
  mode: 'diff' | 'merge'
  diffs: number
  comparison: ComparisonMethod
  tabWidth: number
  insertSpaces: boolean
  charset: string
  lineEnding: LineEndingStyle
  onComparison: (m: ComparisonMethod) => void
  onCharset: (c: string) => void
  onLineEnding: (l: LineEndingStyle) => void
  onTabOptions: () => void
}): React.JSX.Element {
  const charsetItems = (): MenuItem[] =>
    CHARSET_GROUPS.flatMap((g) => [
      { label: g, header: true },
      ...CHARSETS.filter((c) => c.group === g).map((c) => ({
        label: c.label,
        checked: c.id === charset,
        onClick: () => {
          onCharset(c.id)
        }
      }))
    ])
  const sep = <span className="h-3.5 w-px bg-border" />
  return (
    <div
      className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-surface px-1"
      role="status"
    >
      <StatusItem
        title="Click to change the comparison method"
        menu={() =>
          COMPARISON_METHODS.map((m) => ({
            label: COMPARISON_LABELS[m],
            checked: m === comparison,
            onClick: () => {
              onComparison(m)
            }
          }))
        }
      >
        <span data-testid="diff-count">
          {diffs} {diffs === 1 ? 'diff' : 'diffs'}
        </span>{' '}
        ({COMPARISON_SHORT[comparison]})
      </StatusItem>
      {sep}
      <StatusItem
        title="Click to change tab options"
        menu={() => [{ label: 'Tab and Space Options...', onClick: onTabOptions }]}
      >
        Tab spacing: {tabWidth}
        {insertSpaces ? ' (Insert spaces)' : ''}
      </StatusItem>
      {sep}
      {mode === 'diff' ? (
        <StatusItem title="Click to change the character encoding" menu={charsetItems}>
          Encoding: {charsetLabel(charset)}
        </StatusItem>
      ) : (
        <>
          <StatusItem title="Click to change the character encoding" menu={charsetItems}>
            File format (Encoding: {charsetLabel(charset)}
          </StatusItem>
          <StatusItem
            title="Click to change the line endings of the merge file"
            menu={() =>
              (['unix', 'win', 'mac'] as const).map((l) => ({
                label: LINE_ENDING_LABELS[l],
                checked: l === lineEnding,
                onClick: () => {
                  onLineEnding(l)
                }
              }))
            }
          >
            Line endings: {LINE_ENDING_LABELS[lineEnding]})
          </StatusItem>
        </>
      )}
    </div>
  )
}

// ── 3-way legend ──

export function MergeDiagram({
  labels,
  stats,
  unresolved
}: {
  labels: { base: string; left: string; right: string; merge: string }
  stats: MergeStats
  unresolved: number
}): React.JSX.Element {
  const row = 'flex h-[22px] items-center gap-2'
  return (
    <div
      className="flex shrink-0 items-stretch gap-6 border-b border-border bg-surface px-3 py-1.5 text-meta"
      aria-label="Merge summary"
    >
      <svg width="34" height="88" viewBox="0 0 34 88" aria-hidden className="shrink-0">
        <path
          d="M7 11 V77 H20 M7 33 H18 M7 55 H18"
          fill="none"
          stroke="var(--color-text-muted)"
          strokeWidth="1.2"
        />
        <path
          d="M26 33 H30 V77 H26 M26 55 H30"
          fill="none"
          stroke="var(--color-text-muted)"
          strokeWidth="1.2"
        />
      </svg>
      <div className="-ml-[52px] flex flex-col">
        <div className={row}>
          <RoleIcon role="base" size={14} />
          <span className="w-12 text-right text-text-secondary">Base:</span>
          <span className="font-medium text-text" title={labels.base}>
            {labels.base}
          </span>
        </div>
        <div className={row}>
          <span className="ml-4">
            <RoleIcon role="left" size={14} />
          </span>
          <span className="w-8 text-right text-text-secondary">Left:</span>
          <span className="font-medium text-text">{labels.left}</span>
        </div>
        <div className={row}>
          <span className="ml-4">
            <RoleIcon role="right" size={14} />
          </span>
          <span className="w-8 text-right text-text-secondary">Right:</span>
          <span className="font-medium text-text">{labels.right}</span>
        </div>
        <div className={row}>
          <span className="ml-6">
            <RoleIcon role="merge" size={14} />
          </span>
          <span className="w-10 text-right font-semibold text-text">Merge:</span>
          <span className="font-semibold text-text">{labels.merge}</span>
        </div>
      </div>
      <div className="flex flex-col pl-6">
        <div className={row} />
        <div className={row} data-testid="left-stats">
          Differences from base: {stats.leftUnique}
          {stats.common > 0 ? ' unique' : ''}
        </div>
        <div className={row} data-testid="right-stats">
          Differences from base: {stats.rightUnique}
          {stats.common > 0 ? ' unique' : ''}
        </div>
        <div
          className={row}
          data-testid="conflicts"
          style={{ color: unresolved > 0 ? 'var(--m-conflict)' : undefined }}
        >
          Conflicts: {unresolved}
          {stats.conflicts > 0 && unresolved !== stats.conflicts ? ` (of ${stats.conflicts})` : ''}
        </div>
      </div>
      {stats.common > 0 && (
        <div className="flex flex-col justify-center pb-[22px] text-text-secondary">
          <span className="flex items-center gap-2">
            <span className="text-[26px] leading-none font-light text-text-muted">{'}'}</span>+
            {stats.common} common to both
          </span>
        </div>
      )}
    </div>
  )
}
