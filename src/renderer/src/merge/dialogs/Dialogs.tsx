import { FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { APP_NAME, CLI_NAME, type LaunchOptions } from '../../../../shared/args'
import { CHARSET_GROUPS, CHARSETS } from '../../../../shared/charsets'
import type { Preferences, ThemeId } from '../../../../shared/ipc'
import {
  COMPARISON_LABELS,
  COMPARISON_METHODS,
  type ComparisonMethod
} from '../../../../shared/merge/compare'
import { LINE_ENDING_LABELS, type LineEndingStyle } from '../../../../shared/merge/text'
import type { MergeHost } from '../host'
import { RoleIcon, type Role } from '../icons'
import { Button, Check, Field, inputClass, Modal } from './Modal'

// ── Message box ──

export interface AskOptions {
  title: string
  message: string
  detail?: string
  buttons: string[]
  /** Index of the highlighted button (Enter). */
  defaultId?: number
  /** Index returned by Escape / the close box. */
  cancelId?: number
  danger?: number
}

export function MessageDialog({
  opts,
  onAnswer
}: {
  opts: AskOptions
  onAnswer: (i: number) => void
}): React.JSX.Element {
  const cancel = opts.cancelId ?? opts.buttons.length - 1
  const def = opts.defaultId ?? 0
  return (
    <Modal
      title={opts.title}
      width={440}
      onClose={() => {
        onAnswer(cancel)
      }}
      footer={opts.buttons.map((b, i) => (
        <Button
          key={b}
          primary={i === def}
          danger={i === opts.danger}
          autoFocus={i === def}
          onClick={() => {
            onAnswer(i)
          }}
        >
          {b}
        </Button>
      ))}
    >
      <p className="whitespace-pre-line text-text">{opts.message}</p>
      {opts.detail && (
        <p className="mt-2 whitespace-pre-line text-meta text-text-secondary">{opts.detail}</p>
      )}
    </Modal>
  )
}

// ── New Merge or Diff ──

type SlotKey = 'base' | 'left' | 'right' | 'merge'

export function CompareDialog({
  host,
  initial,
  onOk,
  onCancel,
  embedded
}: {
  host: MergeHost
  initial?: LaunchOptions
  onOk: (o: LaunchOptions) => void
  onCancel: () => void
  /** Shown as the window's content (no files open), not over a document. */
  embedded?: boolean
}): React.JSX.Element {
  const [mode, setMode] = useState<'diff' | 'merge'>(initial?.base ? 'merge' : 'diff')
  const [paths, setPaths] = useState<Record<SlotKey, string>>({
    base: initial?.base ?? '',
    left: initial?.left ?? '',
    right: initial?.right ?? '',
    merge: initial?.merge ?? ''
  })
  const [error, setError] = useState<string | null>(null)
  const slots: { key: SlotKey; role: Role; label: string }[] =
    mode === 'merge'
      ? [
          { key: 'base', role: 'base', label: 'Base:' },
          { key: 'left', role: 'left', label: 'Left (1st):' },
          { key: 'right', role: 'right', label: 'Right (2nd):' },
          { key: 'merge', role: 'merge', label: 'Merge result (optional):' }
        ]
      : [
          { key: 'left', role: 'left', label: 'Left (1st):' },
          { key: 'right', role: 'right', label: 'Right (2nd):' }
        ]
  const browse = async (key: SlotKey): Promise<void> => {
    const p =
      key === 'merge'
        ? await host.showSaveDialog('Merge result', paths[key] || undefined)
        : await host.showOpenDialog('Choose file', paths[key] || undefined)
    if (p) setPaths((s) => ({ ...s, [key]: p }))
  }
  const ok = async (): Promise<void> => {
    const need: SlotKey[] = mode === 'merge' ? ['base', 'left', 'right'] : ['left', 'right']
    for (const k of need) {
      if (!paths[k].trim()) {
        setError('Choose all the files to compare.')
        return
      }
      if (!(await host.fileExists(paths[k].trim()))) {
        setError(`'${paths[k]}' is not a file (or does not exist).`)
        return
      }
    }
    const o: LaunchOptions = { labels: {}, left: paths.left.trim(), right: paths.right.trim() }
    if (mode === 'merge') {
      o.base = paths.base.trim()
      if (paths.merge.trim()) o.merge = paths.merge.trim()
    }
    onOk(o)
  }
  const body = (
    <>
      <div className="mb-3 flex gap-4" role="radiogroup">
        {(['diff', 'merge'] as const).map((m) => (
          <label key={m} className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              className="accent-[var(--color-brand)]"
              checked={mode === m}
              onChange={() => {
                setMode(m)
              }}
            />
            {m === 'diff' ? 'Compare 2 files (diff)' : 'Merge 3 files'}
          </label>
        ))}
      </div>
      <p className="mb-2 text-meta text-text-secondary">
        {mode === 'diff' ? 'Choose files to diff:' : 'Choose files to merge:'}
      </p>
      {slots.map((s) => (
        <div key={s.key} className="mb-2">
          <span className="mb-1 flex items-center gap-1.5 text-meta text-text-secondary">
            <RoleIcon role={s.role} size={12} /> {s.label}
          </span>
          <div className="flex gap-2">
            <input
              className={inputClass}
              value={paths[s.key]}
              aria-label={s.label}
              onChange={(e) => {
                setPaths((p) => ({ ...p, [s.key]: e.target.value }))
                setError(null)
              }}
            />
            <Button onClick={() => void browse(s.key)}>
              <span className="flex items-center gap-1">
                <FolderOpen size={14} /> Browse...
              </span>
            </Button>
          </div>
        </div>
      ))}
      {error && <p className="mt-2 text-meta text-error">{error}</p>}
    </>
  )
  const footer = (
    <>
      {!embedded && <Button onClick={onCancel}>Cancel</Button>}
      <Button primary onClick={() => void ok()}>
        OK
      </Button>
    </>
  )
  if (embedded)
    return (
      <div className="flex h-full items-center justify-center">
        <div
          className="w-[560px] rounded-[var(--radius-menu)] border border-border bg-surface-white p-5"
          style={{ boxShadow: 'var(--shadow-md)' }}
        >
          <h1 className="mb-4 flex items-center gap-2 text-[18px] font-semibold text-title">
            <RoleIcon role="merge" size={18} /> {APP_NAME}
          </h1>
          <div
            onKeyDown={(e) => {
              if (e.key === 'Enter') void ok()
            }}
          >
            {body}
          </div>
          <div className="mt-4 flex justify-end gap-2">{footer}</div>
        </div>
      </div>
    )
  return (
    <Modal
      title="New Merge or Diff"
      width={560}
      onClose={onCancel}
      onEnter={() => void ok()}
      footer={footer}
    >
      {body}
    </Modal>
  )
}

// ── Preferences ──

const COMPARISON_EXAMPLE: Record<ComparisonMethod, string> = {
  all: 'Every difference counts, including CR/LF and spaces vs tabs.',
  lineEndings: '"text⏎" and "text␍⏎" are equal.',
  whitespaceLength: '"a b" and "a<tab>b" are equal; "ab" differs.',
  whitespace: '"a b", "a<tab>b" and "ab" are all equal.'
}

export function PreferencesDialog({
  prefs,
  onSave,
  onCancel,
  onChooseFont
}: {
  prefs: Preferences
  onSave: (p: Preferences) => void
  onCancel: () => void
  onChooseFont: (current: Preferences, done: (family: string, size: number) => void) => void
}): React.JSX.Element {
  const [p, setP] = useState(prefs)
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]): void => {
    setP((x) => ({ ...x, [k]: v }))
  }
  const section = 'mb-1 mt-3 text-meta font-semibold uppercase tracking-wide text-text-muted'
  return (
    <Modal
      title="Preferences"
      width={560}
      onClose={onCancel}
      onEnter={() => {
        onSave(p)
      }}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            primary
            onClick={() => {
              onSave(p)
            }}
          >
            OK
          </Button>
        </>
      }
    >
      <div className={section}>Text format</div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate" style={{ fontFamily: p.fontFamily, fontSize: p.fontSize }}>
          {p.fontFamily.split(',')[0].replace(/'/g, '')}, {p.fontSize}px
        </span>
        <Button
          onClick={() => {
            onChooseFont(p, (family, size) => {
              setP((x) => ({ ...x, fontFamily: family, fontSize: size }))
            })
          }}
        >
          Choose...
        </Button>
      </div>
      <div className="flex gap-4">
        <Field label="Tab spacing:">
          <input
            type="number"
            min={1}
            max={32}
            className={inputClass}
            value={p.tabWidth}
            onChange={(e) => {
              set('tabWidth', Math.max(1, Math.min(32, Number(e.target.value) || 1)))
            }}
          />
        </Field>
        <div className="pt-6">
          <Check
            label="Insert spaces instead of tabs"
            checked={p.insertSpaces}
            onChange={(v) => {
              set('insertSpaces', v)
            }}
          />
        </div>
      </div>

      <div className={section}>File format</div>
      <div className="flex gap-4">
        <Field label="Character encoding:">
          <CharsetSelect
            value={p.charset}
            onChange={(v) => {
              set('charset', v)
            }}
          />
        </Field>
        <Field label="Line ending type (merge file only):">
          <select
            className={inputClass}
            value={p.lineEnding}
            onChange={(e) => {
              set('lineEnding', e.target.value as LineEndingStyle)
            }}
          >
            {(['unix', 'win', 'mac'] as const).map((le) => (
              <option key={le} value={le}>
                {LINE_ENDING_LABELS[le]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className={section}>Comparison method</div>
      {COMPARISON_METHODS.map((m) => (
        <label key={m} className="mb-1 flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            className="mt-1 accent-[var(--color-brand)]"
            checked={p.comparison === m}
            onChange={() => {
              set('comparison', m)
            }}
          />
          <span>
            {COMPARISON_LABELS[m]}
            <span className="block text-meta text-text-muted">{COMPARISON_EXAMPLE[m]}</span>
          </span>
        </label>
      ))}

      <div className={section}>Display</div>
      <div className="grid grid-cols-2">
        <Check
          label="Line numbers"
          checked={p.showLineNumbers}
          onChange={(v) => {
            set('showLineNumbers', v)
          }}
        />
        <Check
          label="Inline differences"
          checked={p.inlineDiffs}
          onChange={(v) => {
            set('inlineDiffs', v)
          }}
        />
        <Check
          label="Syntax highlighting"
          checked={p.syntaxHighlighting}
          onChange={(v) => {
            set('syntaxHighlighting', v)
          }}
        />
        <Check
          label="Tabs and spaces"
          checked={p.showWhitespace}
          onChange={(v) => {
            set('showWhitespace', v)
          }}
        />
      </div>
      <Field label="Color scheme:">
        <select
          className={inputClass}
          value={p.theme}
          onChange={(e) => {
            set('theme', e.target.value as ThemeId)
          }}
        >
          <option value="system">Same as system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Field>
    </Modal>
  )
}

export function CharsetSelect({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <select
      className={inputClass}
      value={value}
      aria-label="Character encoding"
      onChange={(e) => {
        onChange(e.target.value)
      }}
    >
      {CHARSET_GROUPS.map((g) => (
        <optgroup key={g} label={g}>
          {CHARSETS.filter((c) => c.group === g).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

// ── Tab and space options ──

export function TabOptionsDialog({
  tabWidth,
  insertSpaces,
  onOk,
  onCancel
}: {
  tabWidth: number
  insertSpaces: boolean
  onOk: (w: number, s: boolean) => void
  onCancel: () => void
}): React.JSX.Element {
  const [w, setW] = useState(String(tabWidth))
  const [s, setS] = useState(insertSpaces)
  const valid = /^\d+$/.test(w) && Number(w) >= 1 && Number(w) <= 32
  const ok = (): void => {
    if (valid) onOk(Number(w), s)
  }
  return (
    <Modal
      title="Tab and Space Options"
      width={360}
      onClose={onCancel}
      onEnter={ok}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button primary disabled={!valid} onClick={ok}>
            OK
          </Button>
        </>
      }
    >
      <Field label="Tab spacing:">
        <input
          className={inputClass}
          value={w}
          onChange={(e) => {
            setW(e.target.value)
          }}
        />
      </Field>
      <Check label="Insert spaces instead of tabs" checked={s} onChange={setS} />
    </Modal>
  )
}

// ── Font ──

const MONO_FONTS = [
  'JetBrains Mono',
  'Cascadia Code',
  'Fira Code',
  'Source Code Pro',
  'DejaVu Sans Mono',
  'Liberation Mono',
  'Ubuntu Mono',
  'Noto Sans Mono',
  'Consolas',
  'Menlo',
  'Courier New',
  'monospace'
]

export function FontDialog({
  family,
  size,
  onOk,
  onCancel
}: {
  family: string
  size: number
  onOk: (family: string, size: number) => void
  onCancel: () => void
}): React.JSX.Element {
  const first = family.split(',')[0].replace(/['"]/g, '').trim()
  const [f, setF] = useState(first)
  const [s, setS] = useState(size)
  const available = MONO_FONTS.filter(
    (m) => m === 'monospace' || document.fonts.check(`12px "${m}"`)
  )
  const fullFamily = (name: string): string => (name === first ? family : `'${name}', ${family}`)
  const ok = (): void => {
    onOk(fullFamily(f), s)
  }
  return (
    <Modal
      title="Select Font"
      width={420}
      onClose={onCancel}
      onEnter={ok}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button primary onClick={ok}>
            OK
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <Field label="Font:">
          <input
            className={inputClass}
            list="m-fonts"
            value={f}
            onChange={(e) => {
              setF(e.target.value)
            }}
          />
          <datalist id="m-fonts">
            {available.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <div className="w-24">
          <Field label="Size:">
            <input
              type="number"
              min={7}
              max={40}
              className={inputClass}
              value={s}
              onChange={(e) => {
                setS(Math.max(7, Math.min(40, Number(e.target.value) || 12)))
              }}
            />
          </Field>
        </div>
      </div>
      <div
        className="rounded-[var(--radius-control)] border border-border-light p-3"
        style={{
          fontFamily: fullFamily(f),
          fontSize: s,
          whiteSpace: 'pre',
          background: 'var(--m-editor-bg)'
        }}
      >
        {'int main(void) {\n    return 0; // 0O lI1\n}'}
      </div>
    </Modal>
  )
}

// ── Go to line ──

export function GotoDialog({
  max,
  onGo,
  onCancel
}: {
  max: number
  onGo: (line: number) => void
  onCancel: () => void
}): React.JSX.Element {
  const [v, setV] = useState('')
  const n = Number(v)
  const valid = /^\d+$/.test(v) && n >= 1 && n <= max
  const go = (): void => {
    if (valid) onGo(n - 1)
  }
  return (
    <Modal
      title="Go To Line Number"
      width={320}
      onClose={onCancel}
      onEnter={go}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button primary disabled={!valid} onClick={go}>
            Go
          </Button>
        </>
      }
    >
      <Field label={`Line number (1 - ${max}):`}>
        <input
          className={inputClass}
          value={v}
          inputMode="numeric"
          onChange={(e) => {
            setV(e.target.value)
          }}
        />
      </Field>
    </Modal>
  )
}

// ── Find ──

export interface FindOptions {
  text: string
  ignoreCase: boolean
  wholeWord: boolean
  onlyDiffs: boolean
}

export function FindDialog({
  initial,
  message,
  onFind,
  onClose
}: {
  initial: FindOptions
  message: string | null
  onFind: (o: FindOptions, backwards: boolean) => void
  onClose: () => void
}): React.JSX.Element {
  const [o, setO] = useState(initial)
  const [prevInitial, setPrevInitial] = useState(initial)
  if (initial !== prevInitial) {
    setPrevInitial(initial)
    setO(initial)
  }
  return (
    <Modal
      title="Find"
      width={380}
      floating
      onClose={onClose}
      onEnter={() => {
        onFind(o, false)
      }}
      footer={
        <>
          <Button
            disabled={!o.text}
            onClick={() => {
              onFind(o, true)
            }}
          >
            Previous
          </Button>
          <Button
            primary
            disabled={!o.text}
            onClick={() => {
              onFind(o, false)
            }}
          >
            Next
          </Button>
        </>
      }
    >
      <Field label="Find:">
        <input
          className={inputClass}
          value={o.text}
          onChange={(e) => {
            setO({ ...o, text: e.target.value })
          }}
        />
      </Field>
      <Check
        label="Ignore case"
        checked={o.ignoreCase}
        onChange={(v) => {
          setO({ ...o, ignoreCase: v })
        }}
      />
      <Check
        label="Match whole word only"
        checked={o.wholeWord}
        onChange={(v) => {
          setO({ ...o, wholeWord: v })
        }}
      />
      <Check
        label="Search only in differences"
        checked={o.onlyDiffs}
        onChange={(v) => {
          setO({ ...o, onlyDiffs: v })
        }}
      />
      {message && <p className="mt-2 text-meta text-error">{message}</p>}
    </Modal>
  )
}

// ── Character set confirmation ──

export function CharsetDialog({
  files,
  charset,
  onUse,
  onKeep
}: {
  files: string[]
  charset: string
  onUse: (charset: string) => void
  onKeep: () => void
}): React.JSX.Element {
  const [c, setC] = useState(charset === 'none' ? 'winansi' : charset)
  return (
    <Modal
      title="Character Encoding"
      width={460}
      onClose={onKeep}
      footer={
        <>
          <Button onClick={onKeep}>Keep</Button>
          <Button
            primary
            onClick={() => {
              onUse(c)
            }}
          >
            Reload
          </Button>
        </>
      }
    >
      <p className="mb-2">These files may not display correctly with the current encoding:</p>
      <ul className="mb-3 list-disc pl-5 text-meta text-text-secondary">
        {files.map((f) => (
          <li key={f} className="break-all">
            {f}
          </li>
        ))}
      </ul>
      <Field label="Use character encoding:">
        <CharsetSelect value={c} onChange={setC} />
      </Field>
    </Modal>
  )
}

// ── About / Help ──

export function AboutDialog({
  version,
  onClose
}: {
  version: string
  onClose: () => void
}): React.JSX.Element {
  return (
    <Modal
      title={`About ${APP_NAME}`}
      width={400}
      onClose={onClose}
      footer={
        <Button primary onClick={onClose}>
          OK
        </Button>
      }
    >
      <div className="flex items-center gap-3">
        <RoleIcon role="merge" size={32} />
        <div>
          <div className="text-[16px] font-semibold text-title">{APP_NAME}</div>
          <div className="text-meta text-text-secondary">Version {version}</div>
        </div>
      </div>
      <p className="mt-3 text-meta text-text-secondary">
        Visual 2-way diff and 3-way merge tool. It can be used as an external diff and merge tool
        (git mergetool and similar).
      </p>
    </Modal>
  )
}

const KEYS: [string, string][] = [
  ['Ctrl+N', 'New merge or diff'],
  ['Ctrl+S', 'Save'],
  ['Ctrl+W', 'Close'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
  ['Ctrl+1 / Ctrl+2', 'Previous / next diff'],
  ['Ctrl+3 / Ctrl+4', 'Previous / next conflict'],
  ['Ctrl+F', 'Find'],
  ['Ctrl+E', 'Use selection for find'],
  ['Ctrl+G', 'Go to line number'],
  ['Ctrl+I', 'Inline differences'],
  ['Ctrl+L', 'Line numbers'],
  ['Ctrl+Shift+H', 'Syntax highlighting'],
  ['F5', 'Refresh all']
]

export function HelpDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <Modal
      title={`${APP_NAME} Help`}
      width={620}
      onClose={onClose}
      footer={
        <Button primary onClick={onClose}>
          Close
        </Button>
      }
    >
      <h3 className="mb-1 font-semibold">Merging</h3>
      <p className="mb-3 text-text-secondary">
        The top panes show the left file, the base (common ancestor) and the right file; the bottom
        pane is the merge result. Each change has a group of marks beside the result: click a
        file&apos;s mark to add or remove its text. Conflicts (both sides changed the same lines)
        start with all three texts and a red outline, and must be decided before saving. You can
        also type directly in the result.
      </p>
      <h3 className="mb-1 font-semibold">Command line</h3>
      <pre className="mb-3 overflow-auto rounded-[var(--radius-control)] bg-surface p-2 text-meta">{`${CLI_NAME} [options] left right
${CLI_NAME} [options] base left right [merge]
${CLI_NAME} -h   (all options)`}</pre>
      <h3 className="mb-1 font-semibold">Keyboard</h3>
      <table className="w-full text-meta">
        <tbody>
          {KEYS.map(([k, v]) => (
            <tr key={k}>
              <td className="py-0.5 pr-4 font-mono text-text-secondary">{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}
