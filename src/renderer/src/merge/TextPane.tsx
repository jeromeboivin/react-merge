import { useVirtualizer } from '@tanstack/react-virtual'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import { comparePos, type EditDoc, type Pos } from '../../../shared/merge/doc'
import type { InlineSpan } from '../../../shared/merge/inline'
import { nextWordCol, prevWordCol, TextMeasurer, wordAt } from './measure'
import type { SyntaxSeg } from './syntax'

/** How one line is painted. */
export interface LineDecor {
  bg?: string
  spans?: readonly InlineSpan[]
  /** Fill and outline colours of inline spans. */
  spanBg?: string
  spanEdge?: string
  /** Lines drawn across the pane above/below the line (chunk edges): colour and width. */
  top?: string
  bottom?: string
  edgeWidth?: number
}

/** A line across the pane between two lines (where the other side has lines this one lacks). */
export interface PaneMarker {
  beforeLine: number
  style: string
}

export interface TextPaneHandle {
  scroller(): HTMLDivElement | null
  focus(): void
  hasFocus(): boolean
  getCursor(): Pos
  getSelection(): { anchor: Pos; head: Pos }
  setSelection(anchor: Pos, head: Pos, reveal?: 'center' | 'nearest'): void
  selectedText(): string
  selectAll(): void
  clipboard(cmd: 'copy' | 'cut' | 'paste'): void
  /** Scroll so that the (fractional) line is at the vertical centre. */
  centerOn(line: number): void
  lineHeight: number
}

export interface TextPaneProps {
  id: string
  doc: EditDoc
  version: number
  editable: boolean
  decor?: (line: number) => LineDecor | undefined
  markers?: readonly PaneMarker[]
  syntax?: readonly (readonly SyntaxSeg[])[] | null
  showLineNumbers: boolean
  lineLabel?: (line: number) => string
  showWhitespace: boolean
  tabWidth: number
  insertSpaces: boolean
  fontFamily: string
  fontSize: number
  newEol: '\n' | '\r\n' | '\r'
  /** Hide the vertical scrollbar (panes scrolled by a sibling). */
  hideVScroll?: boolean
  onScroll?: (id: string) => void
  onFocus?: (id: string) => void
  onEdit?: (id: string) => void
  /** Called when a read-only pane receives typing (to offer making it editable). */
  onReadOnlyInput?: (id: string) => void
}

const PAD = 6

export const TextPane = forwardRef<TextPaneHandle, TextPaneProps>(function TextPane(props, ref) {
  const {
    id,
    doc,
    version,
    editable,
    decor,
    markers,
    syntax,
    showLineNumbers,
    lineLabel,
    showWhitespace,
    tabWidth,
    insertSpaces,
    fontFamily,
    fontSize,
    newEol,
    hideVScroll,
    onScroll,
    onFocus,
    onEdit,
    onReadOnlyInput
  } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [focused, setFocused] = useState(false)
  const [sel, setSel] = useState<{ anchor: Pos; head: Pos }>({
    anchor: { line: 0, col: 0 },
    head: { line: 0, col: 0 }
  })
  const selRef = useRef(sel)
  selRef.current = sel
  const goalX = useRef<number | null>(null)
  const composing = useRef(false)

  const lineHeight = Math.round(fontSize * 1.5)
  const font = `${fontSize}px ${fontFamily}`
  const measurer = useMemo(() => new TextMeasurer(font, tabWidth), [font, tabWidth])
  const lineCount = doc.lineCount()

  const gutterChars = Math.max(
    3,
    String(lineCount).length + (lineLabel ? String(lineCount).length + 1 : 0)
  )
  const gutterW = showLineNumbers ? Math.ceil(gutterChars * measurer.charWidth('0') + 16) : 0
  const textLeft = gutterW + PAD

  // Widest line (approximate, in columns) for the horizontal extent.
  const contentWidth = useMemo(() => {
    let maxCols = 0
    for (const l of doc.lines) {
      let cols = 0
      for (let i = 0; i < l.text.length; i++)
        cols = l.text.charCodeAt(i) === 9 ? (Math.floor(cols / tabWidth) + 1) * tabWidth : cols + 1
      if (cols > maxCols) maxCols = cols
    }
    return textLeft + Math.ceil(maxCols * measurer.charWidth('M') * 1.05) + 48
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for the mutable doc's content
  }, [doc, version, tabWidth, measurer, textLeft])

  const virtualizer = useVirtualizer({
    count: lineCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => lineHeight,
    overscan: 12
  })
  useEffect(() => {
    virtualizer.measure()
  }, [lineHeight, virtualizer])

  const clamp = useCallback((p: Pos) => doc.clampPos(p), [doc])

  // Keep the selection inside the document when it shrinks (undo, reload...).
  useLayoutEffect(() => {
    const s = selRef.current
    const a = clamp(s.anchor)
    const h = clamp(s.head)
    if (comparePos(a, s.anchor) !== 0 || comparePos(h, s.head) !== 0) setSel({ anchor: a, head: h })
  }, [version, clamp])

  const reveal = useCallback(
    (p: Pos, mode: 'center' | 'nearest' = 'nearest') => {
      const el = scrollRef.current
      if (!el) return
      const y = p.line * lineHeight
      if (mode === 'center') el.scrollTop = Math.max(0, y - el.clientHeight / 2 + lineHeight / 2)
      else if (y < el.scrollTop) el.scrollTop = y
      else if (y + lineHeight > el.scrollTop + el.clientHeight)
        el.scrollTop = y + lineHeight - el.clientHeight
      const x = textLeft + measurer.xAt(doc.lineText(p.line), p.col)
      const visibleLeft = el.scrollLeft + textLeft
      if (x < visibleLeft + 4) el.scrollLeft = Math.max(0, x - textLeft - 40)
      else if (x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = x - el.clientWidth + 60
    },
    [doc, lineHeight, measurer, textLeft]
  )

  const setSelection = useCallback(
    (anchor: Pos, head: Pos, mode?: 'center' | 'nearest') => {
      const a = clamp(anchor)
      const h = clamp(head)
      setSel({ anchor: a, head: h })
      selRef.current = { anchor: a, head: h }
      if (mode) reveal(h, mode)
    },
    [clamp, reveal]
  )

  const selectedText = useCallback((): string => {
    const { anchor, head } = selRef.current
    return doc.getText(anchor, head, newEol === '\r\n' ? '\r\n' : '\n')
  }, [doc, newEol])

  const edit = useCallback(
    (text: string, group: string | null = null, range?: [Pos, Pos]) => {
      if (!editable) {
        onReadOnlyInput?.(id)
        return
      }
      const { anchor, head } = selRef.current
      const [a, b] = range ?? [anchor, head]
      const end = doc.replace(a, b, text, newEol, head, group)
      goalX.current = null
      setSelection(end, end, 'nearest')
      onEdit?.(id)
    },
    [doc, editable, id, newEol, onEdit, onReadOnlyInput, setSelection]
  )

  const clipboard = useCallback(
    (cmd: 'copy' | 'cut' | 'paste') => {
      inputRef.current?.focus({ preventScroll: true })
      const { anchor, head } = selRef.current
      if (cmd === 'paste') {
        void navigator.clipboard.readText().then((t) => {
          if (t) edit(t, null)
        })
        return
      }
      if (comparePos(anchor, head) === 0) return
      void navigator.clipboard.writeText(selectedText())
      if (cmd === 'cut') edit('')
    },
    [edit, selectedText]
  )

  useImperativeHandle(
    ref,
    (): TextPaneHandle => ({
      scroller: () => scrollRef.current,
      focus: () => inputRef.current?.focus({ preventScroll: true }),
      hasFocus: () => document.activeElement === inputRef.current,
      getCursor: () => selRef.current.head,
      getSelection: () => selRef.current,
      setSelection,
      selectedText,
      selectAll: () => {
        const last = doc.lineCount() - 1
        setSelection({ line: 0, col: 0 }, { line: last, col: doc.lineText(last).length })
      },
      clipboard,
      centerOn: (line: number) => {
        const el = scrollRef.current
        if (el) el.scrollTop = Math.max(0, line * lineHeight - el.clientHeight / 2)
      },
      lineHeight
    }),
    [clipboard, doc, lineHeight, selectedText, setSelection]
  )

  // ── Mouse ──

  const posFromEvent = useCallback(
    (clientX: number, clientY: number): Pos => {
      const content = contentRef.current
      if (!content) return { line: 0, col: 0 }
      const r = content.getBoundingClientRect()
      const y = clientY - r.top
      const line = Math.max(0, Math.min(doc.lineCount() - 1, Math.floor(y / lineHeight)))
      const x = clientX - r.left - textLeft
      return { line, col: measurer.colAt(doc.lineText(line), x) }
    },
    [doc, lineHeight, measurer, textLeft]
  )

  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    inputRef.current?.focus({ preventScroll: true })
    const pos = posFromEvent(e.clientX, e.clientY)
    const content = contentRef.current
    const inGutter = content ? e.clientX - content.getBoundingClientRect().left < gutterW : false
    goalX.current = null
    let anchor = e.shiftKey ? selRef.current.anchor : pos
    let unit: 'char' | 'word' | 'line' = 'char'
    if (inGutter || e.detail >= 3) {
      unit = 'line'
      anchor = { line: pos.line, col: 0 }
      const next =
        pos.line + 1 < doc.lineCount()
          ? { line: pos.line + 1, col: 0 }
          : { line: pos.line, col: doc.lineText(pos.line).length }
      setSelection(anchor, next)
    } else if (e.detail === 2) {
      unit = 'word'
      const [s, en] = wordAt(doc.lineText(pos.line), pos.col)
      anchor = { line: pos.line, col: s }
      setSelection(anchor, { line: pos.line, col: en })
    } else setSelection(anchor, pos)
    const wordAnchor = selRef.current
    let lastX = e.clientX
    let lastY = e.clientY
    const extend = (): void => {
      const p = posFromEvent(lastX, lastY)
      if (unit === 'line') {
        if (comparePos(p, anchor) >= 0)
          setSelection(
            anchor,
            p.line + 1 < doc.lineCount()
              ? { line: p.line + 1, col: 0 }
              : { line: p.line, col: doc.lineText(p.line).length }
          )
        else
          setSelection(
            {
              line: anchor.line + 1 < doc.lineCount() ? anchor.line + 1 : anchor.line,
              col: anchor.line + 1 < doc.lineCount() ? 0 : doc.lineText(anchor.line).length
            },
            { line: p.line, col: 0 }
          )
      } else if (unit === 'word') {
        const [s, en] = wordAt(doc.lineText(p.line), p.col)
        if (comparePos(p, wordAnchor.anchor) >= 0)
          setSelection(wordAnchor.anchor, { line: p.line, col: en })
        else setSelection(wordAnchor.head, { line: p.line, col: s })
      } else setSelection(anchor, p)
    }
    const timer = window.setInterval(() => {
      const el = scrollRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (lastY < r.top) el.scrollTop -= lineHeight
      else if (lastY > r.bottom) el.scrollTop += lineHeight
      if (lastX < r.left) el.scrollLeft -= 20
      else if (lastX > r.right) el.scrollLeft += 20
      else if (lastY >= r.top && lastY <= r.bottom) return
      extend()
    }, 50)
    const move = (ev: MouseEvent): void => {
      lastX = ev.clientX
      lastY = ev.clientY
      extend()
    }
    const up = (): void => {
      window.clearInterval(timer)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ── Keyboard ──

  const visibleRows = (): number =>
    Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / lineHeight) - 1)

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (composing.current) return
    const { anchor, head } = selRef.current
    const ctrl = e.ctrlKey || e.metaKey
    const shift = e.shiftKey
    const hasSel = comparePos(anchor, head) !== 0
    const text = doc.lineText(head.line)
    const move = (p: Pos, keepGoal = false): void => {
      if (!keepGoal) goalX.current = null
      setSelection(shift ? anchor : p, p, 'nearest')
      e.preventDefault()
    }
    const vertical = (delta: number): void => {
      goalX.current ??= measurer.xAt(text, head.col)
      const line = Math.max(0, Math.min(doc.lineCount() - 1, head.line + delta))
      const col =
        line === head.line && delta !== 0
          ? delta < 0
            ? 0
            : doc.lineText(line).length
          : measurer.colAt(doc.lineText(line), goalX.current)
      move({ line, col }, true)
    }
    const [selStart, selEnd] = comparePos(anchor, head) <= 0 ? [anchor, head] : [head, anchor]
    switch (e.key) {
      case 'ArrowLeft':
        if (!shift && hasSel && !ctrl) {
          move(selStart)
          return
        }
        if (ctrl) {
          move(
            head.col === 0 && head.line > 0
              ? { line: head.line - 1, col: doc.lineText(head.line - 1).length }
              : { line: head.line, col: prevWordCol(text, head.col) }
          )
          return
        }
        {
          move(
            head.col > 0
              ? { line: head.line, col: head.col - 1 }
              : head.line > 0
                ? { line: head.line - 1, col: doc.lineText(head.line - 1).length }
                : head
          )
          return
        }
      case 'ArrowRight':
        if (!shift && hasSel && !ctrl) {
          move(selEnd)
          return
        }
        if (ctrl) {
          move(
            head.col >= text.length && head.line + 1 < doc.lineCount()
              ? { line: head.line + 1, col: 0 }
              : { line: head.line, col: nextWordCol(text, head.col) }
          )
          return
        }
        {
          move(
            head.col < text.length
              ? { line: head.line, col: head.col + 1 }
              : head.line + 1 < doc.lineCount()
                ? { line: head.line + 1, col: 0 }
                : head
          )
          return
        }
      case 'ArrowUp':
        if (ctrl) {
          if (scrollRef.current) scrollRef.current.scrollTop -= lineHeight
          e.preventDefault()
          return
        }
        {
          vertical(-1)
          return
        }
      case 'ArrowDown':
        if (ctrl) {
          if (scrollRef.current) scrollRef.current.scrollTop += lineHeight
          e.preventDefault()
          return
        }
        {
          vertical(1)
          return
        }
      case 'PageUp':
        if (scrollRef.current) scrollRef.current.scrollTop -= visibleRows() * lineHeight
        {
          vertical(-visibleRows())
          return
        }
      case 'PageDown':
        if (scrollRef.current) scrollRef.current.scrollTop += visibleRows() * lineHeight
        {
          vertical(visibleRows())
          return
        }
      case 'Home': {
        if (ctrl) {
          move({ line: 0, col: 0 })
          return
        }
        const indent = text.length - text.trimStart().length
        move({ line: head.line, col: head.col === indent ? 0 : indent })
        return
      }
      case 'End':
        if (ctrl) {
          const last = doc.lineCount() - 1
          move({ line: last, col: doc.lineText(last).length })
          return
        }
        {
          move({ line: head.line, col: text.length })
          return
        }
      case 'Backspace': {
        e.preventDefault()
        if (hasSel) {
          edit('')
          return
        }
        if (head.col === 0 && head.line === 0) return
        const from =
          head.col > 0
            ? { line: head.line, col: ctrl ? prevWordCol(text, head.col) : head.col - 1 }
            : { line: head.line - 1, col: doc.lineText(head.line - 1).length }
        edit('', ctrl ? null : 'delete', [from, head])
        return
      }
      case 'Delete': {
        e.preventDefault()
        if (shift && !hasSel) return
        if (hasSel) {
          edit('')
          return
        }
        const last = doc.lineCount() - 1
        if (head.line === last && head.col >= text.length) return
        const to =
          head.col < text.length
            ? { line: head.line, col: ctrl ? nextWordCol(text, head.col) : head.col + 1 }
            : { line: head.line + 1, col: 0 }
        edit('', ctrl ? null : 'forwardDelete', [head, to])
        return
      }
      case 'Enter':
        e.preventDefault()
        {
          edit('\n', null)
          return
        }
      case 'Tab': {
        if (ctrl || e.altKey) return
        e.preventDefault()
        if (shift) return
        if (insertSpaces) {
          const col = Math.round(
            measurer.xAt(doc.lineText(selStart.line), selStart.col) / measurer.spaceWidth
          )
          edit(' '.repeat(tabWidth - (col % tabWidth)), 'typing')
          return
        }
        edit('\t', 'typing')
        return
      }
      case 'Escape':
        if (hasSel) {
          setSelection(head, head)
          e.preventDefault()
        }
        return
    }
    if (ctrl && !e.altKey && (e.key === 'a' || e.key === 'A') && !shift) {
      e.preventDefault()
      const last = doc.lineCount() - 1
      setSelection({ line: 0, col: 0 }, { line: last, col: doc.lineText(last).length })
    }
  }

  const onInput = (e: React.InputEvent<HTMLTextAreaElement>): void => {
    const ta = e.currentTarget
    if (composing.current) return
    const value = ta.value
    ta.value = ''
    if (value) edit(value, /^\S$/.test(value) || value === ' ' ? 'typing' : null)
  }

  const onCopy = (e: React.ClipboardEvent): void => {
    e.preventDefault()
    e.clipboardData.setData('text/plain', selectedText())
  }
  const onCut = (e: React.ClipboardEvent): void => {
    e.preventDefault()
    e.clipboardData.setData('text/plain', selectedText())
    if (comparePos(selRef.current.anchor, selRef.current.head) !== 0) edit('')
  }
  const onPaste = (e: React.ClipboardEvent): void => {
    e.preventDefault()
    const t = e.clipboardData.getData('text/plain')
    if (t) edit(t, null)
  }

  // ── Rendering ──

  const items = virtualizer.getVirtualItems()
  const totalHeight = Math.max(virtualizer.getTotalSize(), lineHeight)
  const [selStart, selEnd] =
    comparePos(sel.anchor, sel.head) <= 0 ? [sel.anchor, sel.head] : [sel.head, sel.anchor]
  const hasSelection = comparePos(selStart, selEnd) !== 0
  const caretX = textLeft + measurer.xAt(doc.lineText(sel.head.line), sel.head.col)
  const caretY = sel.head.line * lineHeight

  const rows: ReactNode[] = []
  for (const it of items) {
    const i = it.index
    const d = decor?.(i)
    const text = doc.lineText(i)
    const shadows: string[] = []
    const ew = d?.edgeWidth ?? 1
    if (d?.top) shadows.push(`inset 0 ${ew}px 0 ${d.top}`)
    if (d?.bottom) shadows.push(`inset 0 -${ew}px 0 ${d.bottom}`)
    let selRect: ReactNode = null
    if (hasSelection && i >= selStart.line && i <= selEnd.line) {
      const x1 = i === selStart.line ? measurer.xAt(text, selStart.col) : 0
      const x2 =
        i === selEnd.line
          ? measurer.xAt(text, selEnd.col)
          : measurer.width(text) + measurer.spaceWidth
      if (x2 > x1)
        selRect = (
          <div
            className="absolute"
            style={{
              left: textLeft + x1,
              width: x2 - x1,
              top: 0,
              height: lineHeight,
              background: 'var(--m-selection)'
            }}
          />
        )
    }
    rows.push(
      <div
        key={i}
        className="absolute left-0"
        style={{
          top: it.start,
          height: lineHeight,
          width: '100%',
          minWidth: contentWidth,
          background: d?.bg,
          boxShadow: shadows.length ? shadows.join(',') : undefined
        }}
      >
        {selRect}
        <div
          className="m-text absolute"
          style={{ left: textLeft, top: 0, lineHeight: `${lineHeight}px`, tabSize: tabWidth }}
        >
          {renderLine(text, syntax?.[i], d, showWhitespace)}
        </div>
        {showLineNumbers && (
          <div
            className="sticky left-0 z-[2] h-full select-none pr-2 text-right"
            style={{
              width: gutterW,
              lineHeight: `${lineHeight}px`,
              background: 'var(--m-gutter)',
              color: 'var(--color-text-muted)',
              borderRight: '1px solid var(--color-border-light)',
              fontSize: fontSize - 1
            }}
          >
            {lineLabel ? lineLabel(i) : i < doc.lines.length || i === 0 ? i + 1 : ''}
          </div>
        )}
      </div>
    )
  }

  const scrollStyle: CSSProperties = {
    fontFamily,
    fontSize,
    background: 'var(--m-editor-bg)',
    color: 'var(--color-text)',
    overflowY: hideVScroll ? 'hidden' : 'auto',
    overflowX: 'auto'
  }

  return (
    <div
      ref={scrollRef}
      className="relative h-full w-full outline-none"
      style={scrollStyle}
      data-pane={id}
      onScroll={() => onScroll?.(id)}
      onMouseDown={onMouseDown}
    >
      <div
        ref={contentRef}
        className="relative cursor-text"
        style={{ height: totalHeight, minWidth: contentWidth }}
      >
        {rows}
        {markers?.map((m, k) => (
          <div
            key={`m${k}`}
            className="pointer-events-none absolute right-0 z-[1]"
            style={{
              left: textLeft - PAD,
              top: m.beforeLine * lineHeight - 1,
              height: 0,
              borderTop: m.style
            }}
          />
        ))}
        {focused && (
          <div
            className={editable ? 'm-caret absolute z-[3]' : 'absolute z-[3]'}
            style={{
              left: caretX,
              top: caretY,
              width: editable ? 2 : 1,
              height: lineHeight,
              background: editable ? 'var(--color-text)' : 'var(--color-text-muted)'
            }}
          />
        )}
        <textarea
          ref={inputRef}
          aria-label={`${id} text`}
          className="absolute z-0 resize-none overflow-hidden border-0 p-0 opacity-0 outline-none"
          style={{ left: caretX, top: caretY, width: 2, height: lineHeight, fontSize }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          wrap="off"
          onFocus={() => {
            setFocused(true)
            onFocus?.(id)
          }}
          onBlur={() => {
            setFocused(false)
          }}
          onKeyDown={onKeyDown}
          onInput={onInput}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={(e) => {
            composing.current = false
            const ta = e.currentTarget
            ta.value = ''
            if (e.data) edit(e.data)
          }}
          onCopy={onCopy}
          onCut={onCut}
          onPaste={onPaste}
        />
      </div>
    </div>
  )
})

/** Paint one line: syntax colours, inline-difference boxes and visible white space. */
function renderLine(
  text: string,
  syntax: readonly SyntaxSeg[] | undefined,
  d: LineDecor | undefined,
  showWs: boolean
): ReactNode {
  if (text.length === 0) return '​'
  const segs: readonly SyntaxSeg[] = syntax && syntax.length > 0 ? syntax : [{ text, cls: '' }]
  const spans = d?.spans ?? []
  // Cut points from both layers.
  const cuts = new Set<number>([0, text.length])
  let p = 0
  for (const s of segs) {
    cuts.add(p)
    p += s.text.length
  }
  for (const s of spans) {
    cuts.add(Math.min(s.start, text.length))
    cuts.add(Math.min(s.end, text.length))
  }
  const points = [...cuts].sort((a, b) => a - b)
  // Class at a position.
  const clsAt: string[] = []
  {
    let pos = 0
    for (const s of segs) {
      for (let k = 0; k < s.text.length; k++) clsAt[pos + k] = s.cls
      pos += s.text.length
    }
  }
  const out: ReactNode[] = []
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k]
    const b = points[k + 1]
    if (b <= a) continue
    const piece = text.slice(a, b)
    const cls = clsAt[a] ?? ''
    const hl = spans.some((s) => s.start <= a && s.end >= b)
    const style: CSSProperties | undefined = hl
      ? {
          background: d?.spanBg,
          boxShadow: d?.spanEdge ? `inset 0 0 0 1px ${d.spanEdge}` : undefined,
          borderRadius: 2
        }
      : undefined
    const className = cls ? `token ${cls}` : undefined
    out.push(
      <span key={a} className={className} style={style}>
        {showWs ? renderWs(piece, a) : piece}
      </span>
    )
  }
  return out
}

function renderWs(piece: string, base: number): ReactNode {
  if (!/[ \t]/.test(piece)) return piece
  const out: ReactNode[] = []
  let run = ''
  for (let i = 0; i < piece.length; i++) {
    const ch = piece[i]
    if (ch === ' ' || ch === '\t') {
      if (run) out.push(run)
      run = ''
      out.push(
        <span key={base + i} className={ch === ' ' ? 'm-ws-space' : 'm-ws-tab'}>
          {ch}
        </span>
      )
    } else run += ch
  }
  if (run) out.push(run)
  return out
}
