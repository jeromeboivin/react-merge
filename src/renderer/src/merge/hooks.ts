import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Range } from '../../../shared/merge/diff'
import { mapLine } from './model'
import type { TextPaneHandle } from './TextPane'

export type Handles = Record<string, TextPaneHandle | null>

/** A ref that always holds the latest committed value, for use inside callbacks. */
export function useLatest<T>(value: T): React.RefObject<T> {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}

export function useSize<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  { width: number; height: number }
] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => {
      setSize({ width: el.clientWidth, height: el.clientHeight })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => {
      ro.disconnect()
    }
  }, [])
  return [ref, size]
}

interface ScrollPos {
  top: number
  left: number
}

export interface ScrollSync {
  /** Each pane's scrollTop, refreshed once per frame while scrolling (for drawing bands). */
  tops: Partial<Record<string, number>>
  onScroll: (id: string) => void
}

/**
 * Keep panes scrolled to matching places. The pane the user scrolls drives the others through
 * the chunk mapping, anchored at a point that slides from the top of the view (at the top of the
 * file) to the bottom (at the end), so file starts and ends line up. Horizontal scrolling is
 * shared as is.
 */
export function useScrollSync(
  handles: React.RefObject<Handles>,
  ranges: Record<string, readonly Range[]>
): ScrollSync {
  const expected = useRef(new Map<string, ScrollPos>())
  const last = useRef(new Map<string, ScrollPos>())
  const rangesRef = useLatest(ranges)
  const [tops, setTops] = useState<Partial<Record<string, number>>>({})
  const frame = useRef(0)

  const publish = useCallback(() => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const t: Record<string, number> = {}
      for (const [id, h] of Object.entries(handles.current)) {
        const el = h?.scroller()
        if (el) t[id] = el.scrollTop
      }
      setTops(t)
    })
  }, [handles])

  const syncFrom = useCallback(
    (id: string, vertical: boolean) => {
      const src = handles.current[id]
      const el = src?.scroller()
      if (!src || !el) return
      const rs = rangesRef.current
      const from = rs[id] as readonly Range[] | undefined
      if (!from) return
      const maxTop = Math.max(1, el.scrollHeight - el.clientHeight)
      const f = Math.min(1, el.scrollTop / maxTop)
      const anchor = (el.scrollTop + f * el.clientHeight) / src.lineHeight
      for (const [oid, h] of Object.entries(handles.current)) {
        const to = rs[oid] as readonly Range[] | undefined
        if (oid === id || !h || !to) continue
        const o = h.scroller()
        if (!o) continue
        let top = o.scrollTop
        if (vertical) {
          const y = mapLine(anchor, from, to) * h.lineHeight
          top = Math.round(
            Math.max(0, Math.min(o.scrollHeight - o.clientHeight, y - f * o.clientHeight))
          )
        }
        const left = Math.min(el.scrollLeft, Math.max(0, o.scrollWidth - o.clientWidth))
        if (Math.abs(o.scrollTop - top) >= 1 || Math.abs(o.scrollLeft - left) >= 1) {
          expected.current.set(oid, { top, left })
          o.scrollTop = top
          o.scrollLeft = left
          last.current.set(oid, { top: o.scrollTop, left: o.scrollLeft })
        }
      }
    },
    [handles, rangesRef]
  )

  const onScroll = useCallback(
    (id: string) => {
      const el = handles.current[id]?.scroller()
      if (!el) return
      publish()
      const exp = expected.current.get(id)
      expected.current.delete(id)
      const now = { top: el.scrollTop, left: el.scrollLeft }
      if (exp && Math.abs(now.top - exp.top) < 2 && Math.abs(now.left - exp.left) < 2) {
        last.current.set(id, now)
        return
      }
      const prev = last.current.get(id)
      last.current.set(id, now)
      syncFrom(id, !prev || Math.abs(prev.top - now.top) >= 1)
    },
    [handles, publish, syncFrom]
  )

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
    },
    []
  )

  return { tops, onScroll }
}
