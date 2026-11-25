import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { APP_NAME, type LaunchOptions } from '../../../shared/args'
import { charsetLabel } from '../../../shared/charsets'
import type { Command, CommandId, MenuState, Preferences, Session } from '../../../shared/ipc'
import type { ComparisonMethod } from '../../../shared/merge/compare'
import type { Range, Source } from '../../../shared/merge/diff'
import {
  generateLines,
  toggleSelection,
  type EditDoc,
  type MergeFiles,
  type Pos
} from '../../../shared/merge/doc'
import { EOL_OF_STYLE, type LineEndingStyle } from '../../../shared/merge/text'
import { MergeDiagram, StatusBar, Toolbar, type ToolbarState } from './Chrome'
import {
  AboutDialog,
  CharsetDialog,
  CompareDialog,
  FindDialog,
  FontDialog,
  GotoDialog,
  HelpDialog,
  MessageDialog,
  PreferencesDialog,
  TabOptionsDialog,
  type AskOptions,
  type FindOptions
} from './dialogs/Dialogs'
import type { MergeHost } from './host'
import {
  baseName,
  buildPlainDoc,
  buildUnified,
  computeDiff,
  computeMerge,
  makeSide,
  mergeSideDocs,
  newMergeDoc,
  type DiffData,
  type MergeData,
  type Side,
  type UnifiedView
} from './model'
import { highlightLines, languageFor, type SyntaxSeg } from './syntax'
import { useLatest, type Handles } from './hooks'
import type { TextPaneHandle } from './TextPane'
import { DiffView, MergeView, UnifiedDiffView, type PaneSettings } from './Views'

type Loaded =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'diff'; left: Side; right: Side; leftDoc: EditDoc; rightDoc: EditDoc; data: DiffData }
  | {
      kind: 'merge'
      base: Side
      left: Side
      right: Side
      files: MergeFiles
      data: MergeData
      doc: EditDoc
      baseDoc: EditDoc
      leftDoc: EditDoc
      rightDoc: EditDoc
      mergePath: string | null
      mergeLabel: string
    }

function panesFor(l: Loaded, v: Preferences): string[] {
  if (l.kind === 'diff') return v.singlePane ? ['unified'] : ['left', 'right']
  if (l.kind === 'merge')
    return v.showBase ? ['left', 'base', 'right', 'merge'] : ['left', 'right', 'merge']
  return []
}

function rangesFor(l: Loaded, pane: string, unified: UnifiedView | null): Range[] {
  if (l.kind === 'diff') {
    if (pane === 'unified' && unified) return unified.ranges
    return l.data.chunks.map((c) => (pane === 'right' ? c.right : c.left))
  }
  if (l.kind === 'merge') {
    if (pane === 'merge')
      return (l.doc.segments ?? []).map((g) => ({ start: g.start, end: g.start + g.count }))
    const src = pane === 'base' || pane === 'right' ? pane : 'left'
    return l.data.chunks.map((c) => c[src])
  }
  return []
}

function docFor(l: Loaded, pane: string, unified: UnifiedView | null): EditDoc | null {
  if (l.kind === 'diff') {
    if (pane === 'unified') return unified?.doc ?? null
    return pane === 'right' ? l.rightDoc : l.leftDoc
  }
  if (l.kind === 'merge') {
    if (pane === 'merge') return l.doc
    return pane === 'base' ? l.baseDoc : pane === 'right' ? l.rightDoc : l.leftDoc
  }
  return null
}

type DialogState =
  | { kind: 'compare' }
  | { kind: 'prefs' }
  | { kind: 'tab' }
  | { kind: 'font'; family: string; size: number; done: (f: string, s: number) => void }
  | { kind: 'goto' }
  | { kind: 'about' }
  | { kind: 'help' }
  | { kind: 'charset'; files: string[] }
  | null

const BIG_FILES = 20 * 1024 * 1024
const PERSISTED_VIEW: (keyof Preferences)[] = [
  'showLineNumbers',
  'inlineDiffs',
  'syntaxHighlighting',
  'showWhitespace',
  'showToolbar',
  'singlePane',
  'showBase',
  'mergeSplit'
]

/** Settings in effect for this window: the preferences, overridden by the command line. */
function initialView(session: Session): Preferences {
  const o = session.options
  return {
    ...session.prefs,
    comparison: o.comparison ?? session.prefs.comparison,
    tabWidth: o.tabWidth ?? session.prefs.tabWidth,
    charset: o.charset ?? session.prefs.charset,
    lineEnding: o.lineEnding ?? session.prefs.lineEnding
  }
}

export function MergeApp({
  host,
  session,
  onPrefs
}: {
  host: MergeHost
  session: Session
  onPrefs: (p: Preferences) => void
}): React.JSX.Element {
  const [launch, setLaunch] = useState<LaunchOptions>(session.options)
  const [view, setView] = useState<Preferences>(() => initialView(session))
  const viewRef = useLatest(view)
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'none' })
  const loadedRef = useLatest(loaded)
  const [version, bump] = useReducer((x: number) => x + 1, 0)
  const [editLeft, setEditLeft] = useState(false)
  const [editRight, setEditRight] = useState(false)
  const [mergeEol, setMergeEol] = useState<LineEndingStyle>(view.lineEnding)
  const [formatDirty, setFormatDirty] = useState(false)
  const [current, setCurrent] = useState<number | null>(null)
  const [active, setActive] = useState<string>('merge')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [asks, setAsks] = useState<{ opts: AskOptions; resolve: (i: number) => void }[]>([])
  const [find, setFind] = useState<{ opts: FindOptions; message: string | null } | null>(null)
  const findOpts = useRef<FindOptions>({
    text: '',
    ignoreCase: true,
    wholeWord: false,
    onlyDiffs: false
  })
  const [syntax, setSyntax] = useState<Record<string, SyntaxSeg[][] | null>>({})
  const handles = useRef<Handles>({})
  const register = useCallback((id: string, h: TextPaneHandle | null) => {
    handles.current[id] = h
  }, [])

  const ask = useCallback(
    (opts: AskOptions) =>
      new Promise<number>((resolve) => {
        setAsks((q) => [...q, { opts, resolve }])
      }),
    []
  )

  // ── Loading ──

  const load = useCallback(
    async (o: LaunchOptions, charset: string, keepView = false): Promise<void> => {
      if (!o.left || !o.right) {
        setLoaded({ kind: 'none' })
        return
      }
      setLoaded((l) => (keepView ? l : { kind: 'loading' }))
      const paths = { base: o.base, left: o.left, right: o.right }
      let files: Partial<Record<Source, Awaited<ReturnType<MergeHost['loadFile']>>>> = {}
      try {
        const entries = await Promise.all(
          (Object.entries(paths) as [Source, string | undefined][])
            .filter(([, p]) => p !== undefined)
            .map(async ([k, p]) => [k, await host.loadFile(p ?? '', charset)] as const)
        )
        files = Object.fromEntries(entries)
      } catch (e) {
        await ask({
          title: 'Error opening files',
          message: 'Error opening files',
          detail: String(e),
          buttons: ['OK']
        })
        setLoaded({ kind: 'none' })
        return
      }
      const all = Object.values(files)
      const merging = o.base !== undefined
      if (all.some((f) => f.binary)) {
        const a = await ask({
          title: APP_NAME,
          message: `One or more of the files is not a text file.\nDo you want to proceed with a text ${merging ? 'merge' : 'diff'} of these files?`,
          buttons: ['Yes', 'No'],
          defaultId: 1
        })
        if (a !== 0) {
          setLoaded({ kind: 'none' })
          return
        }
      }
      if (all.reduce((n, f) => n + f.size, 0) > BIG_FILES) {
        const a = await ask({
          title: APP_NAME,
          message: `The size of the files selected could cause ${APP_NAME} to become temporarily unresponsive.\nDo you want to continue?`,
          buttons: ['Yes', 'No']
        })
        if (a !== 0) {
          setLoaded({ kind: 'none' })
          return
        }
      }
      const v = viewRef.current
      if (!files.left || !files.right) return
      const left = makeSide(o.left, o.labels.left, files.left)
      const right = makeSide(o.right, o.labels.right, files.right)
      if (o.base !== undefined && files.base) {
        const base = makeSide(o.base, o.labels.base, files.base)
        const mf: MergeFiles = { base: base.lines, left: left.lines, right: right.lines }
        const data = computeMerge(mf, v.comparison)
        const doc = newMergeDoc(mf, data, v.comparison)
        setLoaded({
          kind: 'merge',
          base,
          left,
          right,
          files: mf,
          data,
          doc,
          baseDoc: buildPlainDoc(base.lines),
          ...mergeSideDocs(mf, data),
          mergePath: o.merge ?? null,
          mergeLabel: o.labels.merge ?? (o.merge ? baseName(o.merge) : 'Merge result (unsaved)')
        })
        setMergeEol(o.lineEnding ?? v.lineEnding)
        setActive('merge')
        const firstDiff = data.chunks.findIndex((c) => c.kind !== 'equal')
        setCurrent(firstDiff >= 0 ? firstDiff : null)
      } else {
        const data = computeDiff(left.lines, right.lines, v.comparison)
        setLoaded({
          kind: 'diff',
          left,
          right,
          leftDoc: buildPlainDoc(left.lines),
          rightDoc: buildPlainDoc(right.lines),
          data
        })
        setActive('left')
        const firstDiff = data.chunks.findIndex((c) => !c.equal)
        setCurrent(firstDiff >= 0 ? firstDiff : null)
      }
      setFormatDirty(false)
      bump()
      const suspect = all.filter((f) => f.suspect).map((f) => f.path)
      if (suspect.length > 0) setDialog({ kind: 'charset', files: suspect })
    },
    [ask, host, viewRef]
  )

  useEffect(() => {
    void load(launch, viewRef.current.charset)
  }, [launch, load, viewRef])

  // ── Derived state ──

  const mode: 'none' | 'diff' | 'merge' =
    loaded.kind === 'diff' || loaded.kind === 'merge' ? loaded.kind : 'none'
  const unresolved =
    loaded.kind === 'merge' ? (loaded.doc.segments ?? []).filter((s) => !s.resolved).length : 0
  const diffChunks: { equal: boolean; conflict: boolean }[] = useMemo(() => {
    if (loaded.kind === 'diff')
      return loaded.data.chunks.map((c) => ({ equal: c.equal, conflict: false }))
    if (loaded.kind === 'merge')
      return loaded.data.chunks.map((c) => ({
        equal: c.kind === 'equal',
        conflict: c.kind === 'conflict'
      }))
    return []
  }, [loaded])
  const diffCount = diffChunks.filter((c) => !c.equal).length
  const dirty =
    loaded.kind === 'merge'
      ? loaded.doc.dirty || formatDirty
      : loaded.kind === 'diff'
        ? loaded.leftDoc.dirty || loaded.rightDoc.dirty
        : false
  const unified = useMemo(
    () =>
      loaded.kind === 'diff' && view.singlePane
        ? buildUnified(loaded.leftDoc.lines, loaded.rightDoc.lines, loaded.data)
        : null,
    [loaded, view.singlePane]
  )

  const outputCharset = (l: Loaded): string => {
    if (l.kind !== 'merge') return view.charset
    return view.charset === 'none' ? l.base.file.charset : view.charset
  }

  const unifiedRef = useLatest(unified)
  const panes = panesFor(loaded, view)
  // The focused pane, or the first visible one when it was hidden (layout change).
  const activePane = panes.includes(active) ? active : (panes[0] ?? active)
  const activeRef = useLatest(activePane)

  /** The pane ranges per chunk (for navigation and "only in differences"). */
  const rangesOf = useCallback(
    (pane: string): Range[] => rangesFor(loadedRef.current, pane, unifiedRef.current),
    [loadedRef, unifiedRef]
  )
  const docOf = useCallback(
    (pane: string): EditDoc | null => docFor(loadedRef.current, pane, unifiedRef.current),
    [loadedRef, unifiedRef]
  )
  const visiblePanes = useCallback(
    (): string[] => panesFor(loadedRef.current, viewRef.current),
    [loadedRef, viewRef]
  )

  // ── Re-diff edited 2-way panes ──

  useEffect(() => {
    if (loaded.kind !== 'diff' || (!editLeft && !editRight)) return
    const t = window.setTimeout(() => {
      const l = loadedRef.current
      if (l.kind !== 'diff') return
      const data = computeDiff(l.leftDoc.lines, l.rightDoc.lines, viewRef.current.comparison)
      setLoaded({ ...l, data })
    }, 250)
    return () => {
      window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on every edit (version)
  }, [version])

  // ── Syntax highlighting ──

  useEffect(() => {
    if (!view.syntaxHighlighting || (loaded.kind !== 'diff' && loaded.kind !== 'merge')) return
    let cancelled = false
    const t = window.setTimeout(() => {
      const l = loadedRef.current
      const jobs: [string, EditDoc, string | null][] = []
      if (l.kind === 'diff') {
        const lang =
          languageFor(l.left.path) ?? languageFor(l.right.path) ?? languageFor(l.left.label)
        jobs.push(['left', l.leftDoc, lang], ['right', l.rightDoc, lang])
        if (unifiedRef.current) jobs.push(['unified', unifiedRef.current.doc, lang])
      } else if (l.kind === 'merge') {
        const lang =
          languageFor(l.mergePath ?? undefined) ??
          languageFor(l.base.path) ??
          languageFor(l.left.path) ??
          languageFor(l.base.label)
        jobs.push(
          ['base', l.baseDoc, lang],
          ['left', l.leftDoc, lang],
          ['right', l.rightDoc, lang],
          ['merge', l.doc, lang]
        )
      }
      void Promise.all(
        jobs.map(
          async ([id, doc, lang]) =>
            [
              id,
              await highlightLines(
                doc.lines.map((x) => x.text),
                lang
              )
            ] as const
        )
      ).then((res) => {
        if (!cancelled) setSyntax(Object.fromEntries(res))
      })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [loaded, version, view.syntaxHighlighting, unified, loadedRef, unifiedRef])

  // ── Navigation ──

  const goToChunk = useCallback(
    (k: number) => {
      setCurrent(k)
      for (const id of visiblePanes()) {
        const h = handles.current[id]
        const r = rangesOf(id)[k] as Range | undefined
        if (!h || !r) continue
        h.centerOn(r.start + (r.end - r.start) / 2)
      }
      const a = activeRef.current
      const r = rangesOf(a)[k] as Range | undefined
      if (r) handles.current[a]?.setSelection({ line: r.start, col: 0 }, { line: r.start, col: 0 })
    },
    [rangesOf, visiblePanes, activeRef]
  )

  const navigate = useCallback(
    (dir: 1 | -1, conflictsOnly: boolean) => {
      const ok = (k: number): boolean =>
        !diffChunks[k].equal && (!conflictsOnly || diffChunks[k].conflict)
      let from = current
      if (from === null) {
        // Start from what the active pane shows.
        const h = handles.current[activeRef.current]
        const el = h?.scroller()
        const ranges = rangesOf(activeRef.current)
        if (h && el) {
          const line = (el.scrollTop + el.clientHeight / 2) / h.lineHeight
          from = ranges.findIndex((r) => r.end > line)
          if (from < 0) from = ranges.length
          if (dir === 1) from--
          else from = Math.max(from, 0)
        } else from = dir === 1 ? -1 : diffChunks.length
      }
      for (let k = from + dir; k >= 0 && k < diffChunks.length; k += dir) {
        if (ok(k)) {
          goToChunk(k)
          return
        }
      }
    },
    [current, diffChunks, goToChunk, rangesOf, activeRef]
  )

  const navState = useMemo(() => {
    const has = (dir: 1 | -1, conflicts: boolean): boolean => {
      const start = current ?? (dir === 1 ? -1 : diffChunks.length)
      for (let k = start + dir; k >= 0 && k < diffChunks.length; k += dir)
        if (!diffChunks[k].equal && (!conflicts || diffChunks[k].conflict)) return true
      return false
    }
    return {
      prevDiff: has(-1, false),
      nextDiff: has(1, false),
      prevConflict: has(-1, true),
      nextConflict: has(1, true)
    }
  }, [current, diffChunks])

  // ── Saving ──

  const saveMerge = useCallback(
    async (saveAs: boolean): Promise<boolean> => {
      const l = loadedRef.current
      if (l.kind !== 'merge') return false
      const pending = (l.doc.segments ?? []).filter((s) => !s.resolved).length
      const name = l.mergePath ? baseName(l.mergePath) : l.mergeLabel
      if (pending > 0) {
        const a = await ask({
          title: APP_NAME,
          message: `One or more conflicts have not been resolved.\nDo you still want to save your changes to '${name}'?`,
          buttons: ['Save', 'Cancel'],
          defaultId: 1
        })
        if (a !== 0) return false
      }
      let path = l.mergePath
      if (!path || saveAs) {
        path = await host.showSaveDialog(
          'Save File As',
          l.mergePath ?? l.base.path.replace(/(\.[^./\\]*)?$/, '.merged$1')
        )
        if (!path) return false
      }
      try {
        await host.saveFile(path, l.doc.serialize(EOL_OF_STYLE[mergeEol]), outputCharset(l))
      } catch (e) {
        await ask({
          title: APP_NAME,
          message: 'Could not save file!',
          detail: String(e),
          buttons: ['OK']
        })
        return false
      }
      l.doc.markSaved()
      setFormatDirty(false)
      setLoaded({
        ...l,
        mergePath: path,
        mergeLabel: launch.labels.merge && path === l.mergePath ? l.mergeLabel : baseName(path)
      })
      bump()
      return true
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- outputCharset reads `view`
    [ask, host, mergeEol, launch, view.charset]
  )

  const saveDiff = useCallback(
    async (saveAs: boolean): Promise<boolean> => {
      const l = loadedRef.current
      if (l.kind !== 'diff') return false
      const targets: ('left' | 'right')[] = saveAs
        ? [activeRef.current === 'right' && editRight ? 'right' : editLeft ? 'left' : 'right']
        : (['left', 'right'] as const).filter((s) =>
            s === 'left' ? editLeft && l.leftDoc.dirty : editRight && l.rightDoc.dirty
          )
      let next = l
      for (const s of targets) {
        const side = next[s]
        const doc = s === 'left' ? next.leftDoc : next.rightDoc
        let path = side.path
        if (saveAs) {
          const p = await host.showSaveDialog('Save File As', side.path)
          if (!p) return false
          path = p
        }
        try {
          await host.saveFile(
            path,
            doc.serializePreserving(EOL_OF_STYLE[side.eol ?? viewRef.current.lineEnding]),
            side.file.charset
          )
        } catch (e) {
          await ask({
            title: APP_NAME,
            message: 'Could not save file!',
            detail: String(e),
            buttons: ['OK']
          })
          return false
        }
        doc.markSaved()
        if (path !== side.path) next = { ...next, [s]: { ...side, path, label: baseName(path) } }
      }
      setLoaded(next)
      bump()
      return true
    },
    [ask, editLeft, editRight, host, activeRef, loadedRef, viewRef]
  )

  const save = useCallback(
    (saveAs = false) => (loadedRef.current.kind === 'merge' ? saveMerge(saveAs) : saveDiff(saveAs)),
    [saveDiff, saveMerge, loadedRef]
  )

  const dirtyName = useCallback((): string => {
    const l = loadedRef.current
    if (l.kind === 'merge') return l.mergePath ? baseName(l.mergePath) : l.mergeLabel
    if (l.kind === 'diff')
      return [l.leftDoc.dirty ? l.left.label : null, l.rightDoc.dirty ? l.right.label : null]
        .filter(Boolean)
        .join(' and ')
    return ''
  }, [loadedRef])

  /** Ask before losing changes. Returns false when the user cancels. */
  const confirmDiscard = useCallback(
    async (action: string): Promise<boolean> => {
      if (!dirty) return true
      const a = await ask({
        title: APP_NAME,
        message: `Are you sure you want to ${action}?\nThis will cause your changes to '${dirtyName()}' to be lost.`,
        buttons: ['Yes', 'Cancel'],
        defaultId: 1,
        danger: 0
      })
      return a === 0
    },

    [ask, dirty, dirtyName]
  )

  const requestClose = useCallback(async (): Promise<void> => {
    if (dirty) {
      const a = await ask({
        title: APP_NAME,
        message: `Do you want to save your changes to '${dirtyName()}'?`,
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2
      })
      if (a === 2) return
      if (a === 0 && !(await save())) return
    }
    host.closeWindow()
  }, [ask, dirty, host, save, dirtyName])

  useEffect(() => host.onCloseRequest(() => void requestClose()), [host, requestClose])

  // ── Settings ──

  const updateView = useCallback(
    (patch: Partial<Preferences>) => {
      setView((v) => ({ ...v, ...patch }))
      const persisted: Partial<Preferences> = {}
      for (const k of PERSISTED_VIEW)
        if (k in patch) (persisted as Record<string, unknown>)[k] = patch[k]
      if (Object.keys(persisted).length > 0) void host.setPrefs(persisted).then(onPrefs)
    },
    [host, onPrefs]
  )

  const changeComparison = useCallback(
    async (m: ComparisonMethod) => {
      const l = loadedRef.current
      if (m === viewRef.current.comparison) return
      if (l.kind === 'merge') {
        if (l.doc.dirty && !(await confirmDiscard('change the comparison method'))) return
        const data = computeMerge(l.files, m)
        setLoaded({
          ...l,
          data,
          doc: newMergeDoc(l.files, data, m),
          ...mergeSideDocs(l.files, data)
        })
        setCurrent(null)
      } else if (l.kind === 'diff') {
        setLoaded({ ...l, data: computeDiff(l.leftDoc.lines, l.rightDoc.lines, m) })
        setCurrent(null)
      }
      setView((v) => ({ ...v, comparison: m }))
      bump()
    },
    [confirmDiscard, loadedRef, viewRef]
  )

  const changeCharset = useCallback(
    async (c: string) => {
      if (!(await confirmDiscard('change the character encoding'))) return
      setView((v) => ({ ...v, charset: c }))
      viewRef.current = { ...viewRef.current, charset: c }
      await load(launch, c, true)
    },
    [confirmDiscard, launch, load, viewRef]
  )

  const refresh = useCallback(async () => {
    if (!(await confirmDiscard('refresh'))) return
    await load(launch, viewRef.current.charset, true)
  }, [confirmDiscard, launch, load, viewRef])

  // ── Merge choices ──

  const pick = useCallback(
    async (segIndex: number, src: Source) => {
      const l = loadedRef.current
      if (l.kind !== 'merge' || !l.doc.segments) return
      const seg = l.doc.segments[segIndex]
      if (seg.edited) {
        const a = await ask({
          title: APP_NAME,
          message: `Are you sure you want to change this selection?\nThis will cause your edits to this part of '${l.mergeLabel}' to be lost.`,
          buttons: ['Yes', 'Cancel'],
          defaultId: 1
        })
        if (a !== 0) return
      }
      const sel = seg.edited ? [src] : toggleSelection(seg, src)
      const chunk = l.data.chunks[seg.chunk]
      const cursor = handles.current.merge?.getCursor() ?? { line: 0, col: 0 }
      l.doc.setSelection(
        segIndex,
        sel,
        generateLines(l.files, chunk, sel, viewRef.current.comparison),
        cursor
      )
      setCurrent(seg.chunk)
      bump()
    },
    [ask, loadedRef, viewRef]
  )

  // ── Find ──

  const runFind = useCallback(
    (o: FindOptions, backwards: boolean) => {
      findOpts.current = o
      const pane = activeRef.current
      const doc = docOf(pane)
      const h = handles.current[pane]
      if (!doc || !h || !o.text) return
      const esc = o.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(
        o.wholeWord ? `(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])` : esc,
        `gu${o.ignoreCase ? 'i' : ''}`
      )
      const n = doc.lineCount()
      const allowed = (line: number): boolean => {
        if (!o.onlyDiffs) return true
        const ranges = rangesOf(pane)
        return ranges.some((r, k) => !diffChunks[k]?.equal && line >= r.start && line < r.end)
      }
      const matchesIn = (line: number): [number, number][] => {
        if (!allowed(line)) return []
        const out: [number, number][] = []
        re.lastIndex = 0
        for (let m = re.exec(doc.lineText(line)); m; m = re.exec(doc.lineText(line))) {
          out.push([m.index, m.index + m[0].length])
          if (m[0].length === 0) re.lastIndex++
        }
        return out
      }
      const sel = h.getSelection()
      const [s, e] = [sel.anchor, sel.head].sort((a, b) => a.line - b.line || a.col - b.col) as [
        Pos,
        Pos
      ]
      const origin = backwards ? s : e
      let wrapped = false
      for (let step = 0; step <= n; step++) {
        let line: number
        if (backwards) {
          line = origin.line - step
          if (line < 0) {
            line += n
            wrapped = true
          }
        } else {
          line = origin.line + step
          if (line >= n) {
            line -= n
            wrapped = true
          }
        }
        const ms = matchesIn(line)
        const pickM = backwards
          ? [...ms].reverse().find(([a]) => step > 0 || a < origin.col)
          : ms.find(([a]) => step > 0 || a >= origin.col)
        const usable = pickM ?? (step === n ? (backwards ? ms[ms.length - 1] : ms[0]) : undefined)
        if (usable) {
          h.setSelection({ line, col: usable[0] }, { line, col: usable[1] }, 'center')
          setFind({
            opts: o,
            message: wrapped
              ? `Continuing search from ${backwards ? 'end' : 'beginning'} of ${pane === 'merge' ? 'the merge result' : 'the file'}.`
              : null
          })
          return
        }
      }
      setFind({ opts: o, message: 'The search item was not found.' })
    },
    [diffChunks, docOf, rangesOf, activeRef]
  )

  // ── Commands ──

  const activeEditable = useCallback((): string | null => {
    const l = loadedRef.current
    if (l.kind === 'merge') return 'merge'
    if (l.kind === 'diff') {
      const a = activeRef.current
      if (a === 'left' && editLeft) return 'left'
      if (a === 'right' && editRight) return 'right'
      return editLeft ? 'left' : editRight ? 'right' : null
    }
    return null
  }, [editLeft, editRight, activeRef, loadedRef])

  const undoRedo = useCallback(
    (redo: boolean) => {
      const pane = activeEditable()
      const doc = pane ? docOf(pane) : null
      if (!pane || !doc) return
      const pos = redo ? doc.redo() : doc.undo()
      if (pos) handles.current[pane]?.setSelection(pos, pos, 'center')
      bump()
    },
    [activeEditable, docOf]
  )

  const run = useCallback(
    (cmd: Command) => {
      const v = viewRef.current
      const pane = handles.current[activeRef.current]
      switch (cmd.id) {
        case 'new':
          setDialog({ kind: 'compare' })
          break
        case 'save':
          void save(false)
          break
        case 'saveAs':
          void save(true)
          break
        case 'close':
          if (cmd.arg === 'quitAll') host.quit()
          else void requestClose()
          break
        case 'preferences':
          setDialog({ kind: 'prefs' })
          break
        case 'about':
          setDialog({ kind: 'about' })
          break
        case 'help':
          setDialog({ kind: 'help' })
          break
        case 'undo':
          undoRedo(false)
          break
        case 'redo':
          undoRedo(true)
          break
        case 'cut':
        case 'copy':
        case 'paste':
          pane?.clipboard(cmd.id)
          break
        case 'selectAll':
          pane?.selectAll()
          pane?.focus()
          break
        case 'useSelectionForFind': {
          const t = pane?.selectedText() ?? ''
          if (t && !t.includes('\n')) {
            findOpts.current = { ...findOpts.current, text: t }
            setFind((f) => (f ? { opts: findOpts.current, message: null } : f))
          }
          break
        }
        case 'editLeft':
          setEditLeft((x) => !x)
          setActive('left')
          break
        case 'editRight':
          setEditRight((x) => !x)
          setActive('right')
          break
        case 'font':
          setDialog({
            kind: 'font',
            family: v.fontFamily,
            size: v.fontSize,
            done: (fontFamily, fontSize) => {
              setView((x) => ({ ...x, fontFamily, fontSize }))
              void host.setPrefs({ fontFamily, fontSize }).then(onPrefs)
            }
          })
          break
        case 'tabOptions':
          setDialog({ kind: 'tab' })
          break
        case 'charset':
          if (cmd.arg) void changeCharset(cmd.arg)
          break
        case 'lineEnding':
          if (cmd.arg) {
            setMergeEol(cmd.arg as LineEndingStyle)
            setFormatDirty(true)
          }
          break
        case 'comparison':
          if (cmd.arg) void changeComparison(cmd.arg as ComparisonMethod)
          break
        case 'toggleToolbar':
          updateView({ showToolbar: !v.showToolbar })
          break
        case 'doublePane':
          updateView({ singlePane: false })
          break
        case 'singlePane':
          updateView({ singlePane: true })
          break
        case 'toggleBase':
          updateView({ showBase: !v.showBase })
          break
        case 'toggleInline':
          updateView({ inlineDiffs: !v.inlineDiffs })
          break
        case 'toggleLineNumbers':
          updateView({ showLineNumbers: !v.showLineNumbers })
          break
        case 'toggleSyntax':
          updateView({ syntaxHighlighting: !v.syntaxHighlighting })
          break
        case 'toggleWhitespace':
          updateView({ showWhitespace: !v.showWhitespace })
          break
        case 'prevDiff':
          navigate(-1, false)
          break
        case 'nextDiff':
          navigate(1, false)
          break
        case 'prevConflict':
          navigate(-1, true)
          break
        case 'nextConflict':
          navigate(1, true)
          break
        case 'find': {
          const t = pane?.selectedText() ?? ''
          if (t && !t.includes('\n')) findOpts.current = { ...findOpts.current, text: t }
          setFind({ opts: { ...findOpts.current }, message: null })
          break
        }
        case 'goto':
          setDialog({ kind: 'goto' })
          break
        case 'refresh':
          void refresh()
          break
      }
    },
    [
      changeCharset,
      changeComparison,
      host,
      navigate,
      onPrefs,
      refresh,
      requestClose,
      save,
      undoRedo,
      updateView,
      activeRef,
      viewRef
    ]
  )

  useEffect(() => host.onCommand(run), [host, run])

  // Keyboard shortcuts (the native menu only displays them, so the view works without it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (asks.length > 0 || (dialog && dialog.kind !== 'charset')) return
      const t = e.target as HTMLElement
      const inField =
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') &&
        !t.closest('[data-pane]')
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      let id: CommandId | null = null
      if (e.key === 'F5') id = 'refresh'
      else if (e.key === 'F1') id = 'help'
      else if (e.key === 'F3') {
        if (findOpts.current.text) runFind(findOpts.current, e.shiftKey)
        e.preventDefault()
        return
      } else if (ctrl && !e.altKey) {
        if (e.shiftKey) {
          if (k === 'h') id = 'toggleSyntax'
          else if (k === 'z' && !inField) id = 'redo'
          else if (k === 's') id = 'saveAs'
        } else if (inField && 'zyacxv'.includes(k)) return
        else
          id =
            (
              {
                n: 'new',
                s: 'save',
                w: 'close',
                q: 'close',
                z: 'undo',
                y: 'redo',
                e: 'useSelectionForFind',
                i: 'toggleInline',
                l: 'toggleLineNumbers',
                '1': 'prevDiff',
                '2': 'nextDiff',
                '3': 'prevConflict',
                '4': 'nextConflict',
                f: 'find',
                g: 'goto'
              } as Record<string, CommandId>
            )[k] ?? null
        if (id === 'close' && k === 'q') {
          e.preventDefault()
          run({ id: 'close', arg: 'quitAll' })
          return
        }
      }
      if (!id) return
      e.preventDefault()
      run({ id })
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [asks.length, dialog, run, runFind])

  // ── Window title and native menu ──

  useEffect(() => {
    const l = loaded
    const star = dirty ? '*' : ''
    if (l.kind === 'diff')
      host.setTitle(`${l.left.label} and ${l.right.label}${star} - ${APP_NAME}`)
    else if (l.kind === 'merge') host.setTitle(`${l.mergeLabel}${star} - ${APP_NAME}`)
    else host.setTitle(APP_NAME)
  }, [dirty, host, loaded])

  const editablePane =
    loaded.kind === 'merge'
      ? 'merge'
      : loaded.kind === 'diff'
        ? activePane === 'left' && editLeft
          ? 'left'
          : activePane === 'right' && editRight
            ? 'right'
            : editLeft
              ? 'left'
              : editRight
                ? 'right'
                : null
        : null
  const activeDoc = editablePane ? docFor(loaded, editablePane, unified) : null
  const shownSyntax = view.syntaxHighlighting ? syntax : {}
  const menuState: MenuState = {
    mode,
    canSave: mode === 'merge' ? dirty || !(loaded.kind === 'merge' && loaded.mergePath) : dirty,
    canUndo: activeDoc?.canUndo ?? false,
    canRedo: activeDoc?.canRedo ?? false,
    editLeft,
    editRight,
    charset: view.charset,
    lineEnding: mergeEol,
    comparison: view.comparison,
    showToolbar: view.showToolbar,
    singlePane: view.singlePane,
    showBase: view.showBase,
    inlineDiffs: view.inlineDiffs,
    showLineNumbers: view.showLineNumbers,
    syntaxHighlighting: view.syntaxHighlighting,
    showWhitespace: view.showWhitespace,
    hasPrevDiff: navState.prevDiff,
    hasNextDiff: navState.nextDiff,
    hasPrevConflict: navState.prevConflict,
    hasNextConflict: navState.nextConflict
  }
  const menuKey = JSON.stringify(menuState)
  useEffect(() => {
    host.setMenuState(JSON.parse(menuKey) as MenuState)
  }, [host, menuKey])

  // ── Rendering ──

  const settings: PaneSettings = {
    showLineNumbers: view.showLineNumbers,
    showWhitespace: view.showWhitespace,
    inlineDiffs: view.inlineDiffs,
    tabWidth: view.tabWidth,
    insertSpaces: view.insertSpaces,
    fontFamily: view.fontFamily,
    fontSize: view.fontSize,
    newEol:
      EOL_OF_STYLE[
        loaded.kind === 'merge'
          ? mergeEol
          : loaded.kind === 'diff'
            ? (loaded.left.eol ?? view.lineEnding)
            : view.lineEnding
      ]
  }

  const onFocusPane = useCallback((id: string) => {
    setActive(id)
  }, [])
  const onEdit = useCallback(() => {
    bump()
  }, [])
  const onReadOnlyInput = useCallback(
    (id: string) => {
      if (loadedRef.current.kind !== 'diff') return
      void ask({
        title: APP_NAME,
        message: `The ${id} pane is read-only.\nDo you want to edit the ${id} file?`,
        buttons: ['Edit', 'Cancel']
      }).then((a) => {
        if (a !== 0) return
        if (id === 'left') setEditLeft(true)
        else setEditRight(true)
      })
    },
    [ask, loadedRef]
  )

  const toolbarState: ToolbarState = {
    mode: mode === 'merge' ? 'merge' : 'diff',
    canSave: menuState.canSave,
    canUndo: menuState.canUndo,
    canRedo: menuState.canRedo,
    editLeft,
    editRight,
    hasPrevDiff: navState.prevDiff,
    hasNextDiff: navState.nextDiff,
    hasPrevConflict: navState.prevConflict,
    hasNextConflict: navState.nextConflict,
    showWhitespace: view.showWhitespace,
    showLineNumbers: view.showLineNumbers,
    inlineDiffs: view.inlineDiffs,
    syntaxHighlighting: view.syntaxHighlighting,
    singlePane: view.singlePane,
    showBase: view.showBase
  }
  const runId = (id: CommandId): void => {
    run({ id })
  }

  let body: React.JSX.Element
  if (loaded.kind === 'none')
    body = (
      <CompareDialog
        embedded
        host={host}
        initial={launch}
        onCancel={() => undefined}
        onOk={(o) => {
          setLaunch(o)
        }}
      />
    )
  else if (loaded.kind === 'loading')
    body = <div className="flex flex-1 items-center justify-center text-text-muted">Loading…</div>
  else if (loaded.kind === 'diff')
    body =
      view.singlePane && unified ? (
        <UnifiedDiffView
          left={loaded.left}
          right={loaded.right}
          view={unified}
          settings={settings}
          syntax={shownSyntax.unified ?? null}
          current={current}
          register={register}
          onFocusPane={onFocusPane}
        />
      ) : (
        <DiffView
          left={loaded.left}
          right={loaded.right}
          leftDoc={loaded.leftDoc}
          rightDoc={loaded.rightDoc}
          data={loaded.data}
          version={version}
          editLeft={editLeft}
          editRight={editRight}
          settings={settings}
          syntax={shownSyntax}
          current={current}
          active={activePane}
          handles={handles}
          register={register}
          onFocusPane={onFocusPane}
          onEdit={onEdit}
          onReadOnlyInput={onReadOnlyInput}
        />
      )
  else
    body = (
      <>
        <MergeDiagram
          labels={{
            base: loaded.base.label,
            left: loaded.left.label,
            right: loaded.right.label,
            merge: loaded.mergeLabel
          }}
          stats={loaded.data.stats}
          unresolved={unresolved}
        />
        <MergeView
          base={loaded.base}
          left={loaded.left}
          right={loaded.right}
          mergeLabel={loaded.mergeLabel}
          mergePath={loaded.mergePath}
          files={loaded.files}
          data={loaded.data}
          method={view.comparison}
          baseDoc={loaded.baseDoc}
          leftDoc={loaded.leftDoc}
          rightDoc={loaded.rightDoc}
          doc={loaded.doc}
          version={version}
          settings={settings}
          showBase={view.showBase}
          split={view.mergeSplit}
          onSplit={(f) => {
            updateView({ mergeSplit: f })
          }}
          syntax={shownSyntax}
          current={current}
          active={activePane}
          handles={handles}
          register={register}
          onFocusPane={onFocusPane}
          onEdit={onEdit}
          onPick={(si, src) => void pick(si, src)}
          onSelectChunk={setCurrent}
          dirty={dirty}
        />
      </>
    )

  const gotoMax = docFor(loaded, activePane, unified)?.lineCount() ?? 1
  return (
    <div className={`flex h-full flex-col ${view.syntaxHighlighting ? '' : 'm-syntax-off'}`}>
      {mode !== 'none' && view.showToolbar && <Toolbar s={toolbarState} run={runId} />}
      {mode !== 'none' && (
        <StatusBar
          mode={mode}
          diffs={diffCount}
          comparison={view.comparison}
          tabWidth={view.tabWidth}
          insertSpaces={view.insertSpaces}
          charset={
            loaded.kind === 'merge' && view.charset === 'none'
              ? loaded.base.file.charset
              : view.charset
          }
          lineEnding={mergeEol}
          onComparison={(m) => void changeComparison(m)}
          onCharset={(c) => void changeCharset(c)}
          onLineEnding={(le) => {
            setMergeEol(le)
            setFormatDirty(true)
          }}
          onTabOptions={() => {
            setDialog({ kind: 'tab' })
          }}
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>

      {dialog?.kind === 'compare' && (
        <CompareDialog
          host={host}
          onCancel={() => {
            setDialog(null)
          }}
          onOk={(o) => {
            setDialog(null)
            if (loadedRef.current.kind === 'none') setLaunch(o)
            else host.openWindow(o)
          }}
        />
      )}
      {dialog?.kind === 'prefs' && (
        <PreferencesDialog
          prefs={{ ...session.prefs, ...view }}
          onCancel={() => {
            setDialog(null)
          }}
          onChooseFont={(p, done) => {
            setDialog({
              kind: 'font',
              family: p.fontFamily,
              size: p.fontSize,
              done: (f, s) => {
                done(f, s)
                setDialog({ kind: 'prefs' })
              }
            })
          }}
          onSave={(p) => {
            setDialog(null)
            const charsetChanged = p.charset !== viewRef.current.charset
            const methodChanged = p.comparison !== viewRef.current.comparison
            setView((v) => ({ ...v, ...p, charset: v.charset, comparison: v.comparison }))
            void host.setPrefs(p).then(onPrefs)
            if (methodChanged) void changeComparison(p.comparison)
            if (charsetChanged) void changeCharset(p.charset)
          }}
        />
      )}
      {dialog?.kind === 'font' && (
        <FontDialog
          family={dialog.family}
          size={dialog.size}
          onCancel={() => {
            setDialog(null)
          }}
          onOk={(f, s) => {
            setDialog(null)
            dialog.done(f, s)
          }}
        />
      )}
      {dialog?.kind === 'tab' && (
        <TabOptionsDialog
          tabWidth={view.tabWidth}
          insertSpaces={view.insertSpaces}
          onCancel={() => {
            setDialog(null)
          }}
          onOk={(tabWidth, insertSpaces) => {
            setDialog(null)
            setView((v) => ({ ...v, tabWidth, insertSpaces }))
          }}
        />
      )}
      {dialog?.kind === 'goto' && (
        <GotoDialog
          max={gotoMax}
          onCancel={() => {
            setDialog(null)
          }}
          onGo={(line) => {
            setDialog(null)
            const h = handles.current[activeRef.current]
            h?.setSelection({ line, col: 0 }, { line, col: 0 }, 'center')
            h?.focus()
          }}
        />
      )}
      {dialog?.kind === 'about' && (
        <AboutDialog
          version={session.version}
          onClose={() => {
            setDialog(null)
          }}
        />
      )}
      {dialog?.kind === 'help' && (
        <HelpDialog
          onClose={() => {
            setDialog(null)
          }}
        />
      )}
      {dialog?.kind === 'charset' && (
        <CharsetDialog
          files={dialog.files}
          charset={view.charset}
          onKeep={() => {
            setDialog(null)
          }}
          onUse={(c) => {
            setDialog(null)
            void changeCharset(c)
          }}
        />
      )}
      {find && (
        <FindDialog
          initial={find.opts}
          message={find.message}
          onFind={runFind}
          onClose={() => {
            setFind(null)
            handles.current[activeRef.current]?.focus()
          }}
        />
      )}
      {asks.length > 0 && (
        <MessageDialog
          opts={asks[0].opts}
          onAnswer={(i) => {
            const [first, ...rest] = asks
            setAsks(rest)
            first.resolve(i)
          }}
        />
      )}
      <span className="hidden" data-testid="encoding">
        {charsetLabel(view.charset)}
      </span>
    </div>
  )
}
