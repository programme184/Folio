import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { t } from '@shared/i18n'
import { PAPER_HIGHLIGHT_COLOR, PAPER_MARK_COLORS, type PaperMarkType } from '@shared/paper-passages'
import { useLocale } from '../lib/i18n'

export interface PaperMarkBarApi {
  enabled: boolean
  highlightActive: boolean
  underlineActive: boolean
  color: string
  setColor: (color: string) => void
  toggle: (type: PaperMarkType) => void
  hold: () => void
  release: () => void
}

interface PaperMarkBarSnapshot {
  ready: boolean
  enabled: boolean
  highlightActive: boolean
  underlineActive: boolean
  color: string
}

const EMPTY_SNAPSHOT: PaperMarkBarSnapshot = {
  ready: false,
  enabled: false,
  highlightActive: false,
  underlineActive: false,
  color: PAPER_HIGHLIGHT_COLOR
}

interface PaperMarkSlot {
  current: PaperMarkBarApi | null
  publish: (api: PaperMarkBarApi | null) => void
  subscribe: (listener: () => void) => () => void
  snapshot: () => PaperMarkBarSnapshot
}

const SlotContext = createContext<PaperMarkSlot | null>(null)

export function PaperMarkBarProvider({ children }: { children: ReactNode }) {
  const slot = useRef<PaperMarkSlot | null>(null)
  if (!slot.current) {
    let snapshot = EMPTY_SNAPSHOT
    const listeners = new Set<() => void>()
    const emit = (next: PaperMarkBarSnapshot) => {
      if (
        snapshot.ready === next.ready
        && snapshot.enabled === next.enabled
        && snapshot.highlightActive === next.highlightActive
        && snapshot.underlineActive === next.underlineActive
        && snapshot.color === next.color
      ) return
      snapshot = next
      for (const listener of listeners) listener()
    }
    slot.current = {
      current: null,
      publish: api => {
        slot.current!.current = api
        emit(api ? {
          ready: true,
          enabled: api.enabled,
          highlightActive: api.highlightActive,
          underlineActive: api.underlineActive,
          color: api.color
        } : EMPTY_SNAPSHOT)
      },
      subscribe: listener => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      snapshot: () => snapshot
    }
  }
  return <SlotContext.Provider value={slot.current}>{children}</SlotContext.Provider>
}

export function usePublishPaperMarkBar(api: PaperMarkBarApi) {
  const slot = useContext(SlotContext)
  const apiRef = useRef(api)
  apiRef.current = api
  useEffect(() => {
    slot?.publish(apiRef.current)
  })
  useEffect(() => () => slot?.publish(null), [slot])
}

export function PaperMarkBar() {
  useLocale()
  const slot = useContext(SlotContext)
  const snapshot = useSyncExternalStore(
    slot ? slot.subscribe : () => () => {},
    slot ? slot.snapshot : () => EMPTY_SNAPSHOT,
    () => EMPTY_SNAPSHOT
  )
  const [open, setOpen] = useState(false)
  const [menuBox, setMenuBox] = useState<{ top: number; left: number } | null>(null)
  const colorButton = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const hold = () => slot?.current?.hold()
  const release = () => slot?.current?.release()
  const canMark = snapshot.ready && snapshot.enabled
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = colorButton.current?.getBoundingClientRect()
      if (!rect) return
      setMenuBox({ top: rect.bottom + 4, left: Math.max(8, rect.right - 168) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menu.current?.contains(target) || colorButton.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const colorMenu = open && menuBox ? createPortal(
    <div
      ref={menu}
      className="paper-mark-colors"
      role="menu"
      aria-label={t('papers.markColor')}
      style={{ top: menuBox.top, left: menuBox.left }}
      onMouseEnter={hold}
      onMouseLeave={release}
      onMouseDown={event => event.preventDefault()}
    >
      {PAPER_MARK_COLORS.map(item => {
        const selected = item.value === snapshot.color
        return <button
          key={item.id}
          type="button"
          role="menuitemradio"
          aria-checked={selected}
          onClick={() => {
            slot?.current?.setColor(item.value)
            setOpen(false)
          }}
        >
          <Check size={14} aria-hidden="true" style={{ visibility: selected ? 'visible' : 'hidden' }} />
          <span className="paper-mark-swatch" style={{ background: item.value }} />
          <span>{t(`papers.color.${item.id}`)}</span>
        </button>
      })}
    </div>,
    document.body
  ) : null
  return <div
    className="paper-mark-bar"
    role="group"
    aria-label={t('papers.markBar')}
    onMouseEnter={hold}
    onMouseLeave={release}
    onMouseDown={event => event.preventDefault()}
  >
    <button
      type="button"
      aria-pressed={snapshot.highlightActive}
      aria-label={t('papers.highlight')}
      title={canMark ? (snapshot.highlightActive ? t('papers.removeHighlight') : t('papers.highlightHint')) : t('papers.markNeedsSelection')}
      disabled={!canMark}
      onClick={() => slot?.current?.toggle('highlight')}
    >
      <span className="paper-mark-swatch" style={{ background: snapshot.color }} />
    </button>
    <button
      type="button"
      aria-pressed={snapshot.underlineActive}
      aria-label={t('papers.underline')}
      title={canMark ? (snapshot.underlineActive ? t('papers.removeUnderline') : t('papers.underlineHint')) : t('papers.markNeedsSelection')}
      disabled={!canMark}
      onClick={() => slot?.current?.toggle('underline')}
    >
      <span className="paper-mark-letter" style={{ color: snapshot.color }}>A</span>
    </button>
    <button
      ref={colorButton}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={t('papers.markColor')}
      title={t('papers.markColor')}
      disabled={!snapshot.ready}
      onClick={() => setOpen(current => !current)}
    >
      <ChevronDown size={13} aria-hidden="true" />
    </button>
    {colorMenu}
  </div>
}
