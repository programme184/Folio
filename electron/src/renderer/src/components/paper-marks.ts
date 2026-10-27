import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PAPER_HIGHLIGHT_COLOR,
  PAPER_MARK_COLORS,
  paperMarkActive,
  recolorPaperMarks,
  togglePaperMark,
  type PaperHit,
  type PaperMark,
  type PaperMarkType,
  type PaperPageIndex
} from '@shared/paper-passages'

const PAPER_MARK_SAVE_MS = 300

export function usePaperMarks(documentKey: string | null | undefined) {
  const [marks, setMarks] = useState<PaperMark[]>([])
  const keyRef = useRef<string | null>(documentKey ?? null)
  const marksRef = useRef(marks)
  const pending = useRef<{ key: string; marks: PaperMark[] } | null>(null)
  const timer = useRef<number | null>(null)
  const dirty = useRef(false)
  keyRef.current = documentKey ?? null
  marksRef.current = marks

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    const item = pending.current
    pending.current = null
    if (!item) return
    const save = window.agentsDock?.papers?.saveMarks
    if (!save) return
    void save(item.key, item.marks).catch(() => undefined)
  }, [])

  const replace = useCallback((next: PaperMark[]) => {
    dirty.current = true
    marksRef.current = next
    setMarks(next)
    const key = keyRef.current
    if (!key || !window.agentsDock?.papers?.saveMarks) return
    pending.current = { key, marks: next }
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, PAPER_MARK_SAVE_MS)
  }, [flush])

  useEffect(() => {
    const key = documentKey ?? null
    dirty.current = false
    keyRef.current = key
    marksRef.current = []
    setMarks([])
    if (!key) return
    const load = window.agentsDock?.papers?.loadMarks
    if (!load) return
    let cancelled = false
    void load(key).then(loaded => {
      if (cancelled || keyRef.current !== key || dirty.current) return
      const parsed = Array.isArray(loaded) ? loaded : []
      marksRef.current = parsed
      setMarks(parsed)
    }).catch(() => {
      if (cancelled || keyRef.current !== key) return
      marksRef.current = []
      setMarks([])
    })
    return () => {
      cancelled = true
      flush()
    }
  }, [documentKey, flush])

  return { marks, replace }
}

export function usePaperMarkController(
  documentKey: string | null | undefined,
  getPages: () => PaperPageIndex[],
  selection: { hits: PaperHit[] } | null
) {
  const { marks, replace } = usePaperMarks(documentKey)
  const [color, setColorState] = useState(PAPER_HIGHLIGHT_COLOR)
  const toggle = useCallback((type: PaperMarkType) => {
    if (!selection) return
    replace(togglePaperMark(marks, {
      type,
      hits: selection.hits,
      pages: getPages(),
      id: newMarkId(),
      color
    }))
  }, [selection, marks, replace, getPages, color])
  const setColor = useCallback((next: string) => {
    if (!PAPER_MARK_COLORS.some(item => item.value === next)) return
    setColorState(current => current === next ? current : next)
    if (!selection) return
    const updated = recolorPaperMarks(marks, selection.hits, next)
    if (updated) replace(updated)
  }, [selection, marks, replace])
  usePaperMarkShortcuts(selection !== null, toggle)
  return {
    marks,
    replace,
    toggle,
    color,
    setColor,
    highlightActive: selection ? paperMarkActive(marks, 'highlight', selection.hits) : false,
    underlineActive: selection ? paperMarkActive(marks, 'underline', selection.hits) : false
  }
}

function usePaperMarkShortcuts(enabled: boolean, onToggle: (type: PaperMarkType) => void) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey || event.repeat) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return
      const type = event.code === 'Digit1' || event.key === '1'
        ? 'highlight'
        : event.code === 'Digit2' || event.key === '2'
          ? 'underline'
          : null
      if (!type) return
      event.preventDefault()
      onToggle(type)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, onToggle])
}

function newMarkId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `mark-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}
