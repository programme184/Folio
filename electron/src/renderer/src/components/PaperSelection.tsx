import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import { t } from '@shared/i18n'
import {
  columnScopedHits,
  indexPaperPage,
  locatePassages,
  paperAskDraft,
  paperToolbarPosition,
  type LocatedPassage,
  type PaperGlyph,
  type PaperPageIndex,
  type PaperParagraph,
  type ToolbarRect
} from '@shared/paper-passages'
import { useLocale } from '../lib/i18n'
import { sideQuestionError } from './SideQuestionPanel'

export interface PaperAskInput {
  kind: 'explain' | 'translate'
  passage: LocatedPassage
  translateTo?: 'zh-CN' | 'en'
}

export type PaperAsk = (input: PaperAskInput, signal: AbortSignal) => Promise<string>

export interface PaperViewPage {
  page: number
  glyphs: PaperGlyph[]
  width?: number
  height?: number
}

interface SelectionToolbar {
  passage: LocatedPassage
  left: number
  top: number
  placement: 'above' | 'below'
}

export function readPaperHits(root: HTMLElement): Array<{ page: number; glyphIndexes: number[] }> {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return []
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return []
  const hits = new Map<number, number[]>()
  for (const span of root.querySelectorAll<HTMLElement>('[data-paper-item]')) {
    if (!rangeIntersects(range, span)) continue
    const page = Number(span.closest<HTMLElement>('[data-paper-page]')?.dataset.paperPage)
    const index = Number(span.dataset.paperItem)
    if (!Number.isInteger(page) || !Number.isInteger(index)) continue
    const list = hits.get(page) ?? []
    list.push(index)
    hits.set(page, list)
  }
  return [...hits].map(([page, glyphIndexes]) => ({ page, glyphIndexes }))
}

export function usePaperSelection(root: RefObject<HTMLElement | null>, getPages: () => PaperPageIndex[]) {
  const [selection, setSelection] = useState<SelectionToolbar | null>(null)
  const blankPress = useRef(false)
  const hovered = useRef<string | null>(null)
  const pinned = useRef(false)
  const marked = useRef<HTMLElement[]>([])
  const hideTimer = useRef<number | null>(null)
  const mark = (spans: HTMLElement[]) => {
    for (const span of marked.current) span.classList.remove('paper-paragraph-hot')
    for (const span of spans) span.classList.add('paper-paragraph-hot')
    marked.current = spans
  }
  const cancelHide = () => {
    if (hideTimer.current === null) return
    window.clearTimeout(hideTimer.current)
    hideTimer.current = null
  }
  const clearHover = () => {
    cancelHide()
    hovered.current = null
    pinned.current = false
    mark([])
    setSelection(null)
  }
  const scheduleHide = () => {
    cancelHide()
    hideTimer.current = window.setTimeout(clearHover, 220)
  }
  const showPassage = (passage: LocatedPassage, rects: ToolbarRect[]) => {
    const element = root.current
    if (!element) return
    const frame = rectBox(element.getBoundingClientRect())
    const position = paperToolbarPosition(
      rects.length ? rects : [{ left: frame.left + 24, top: frame.top + 24, width: 8, height: 8 }],
      frame
    )
    setSelection({ passage, ...position })
  }
  const showParagraph = (pageNumber: number, glyphIndex: number) => {
    const element = root.current
    if (!element) return
    const paragraph = paragraphAt(getPages(), pageNumber, glyphIndex)
    if (!paragraph || paragraph.id === hovered.current) return
    const passage = locatePassages(getPages(), [{ page: paragraph.page, glyphIndexes: paragraph.glyphIndexes }])
    if (!passage) return
    hovered.current = paragraph.id
    pinned.current = false
    const spans = spansFor(element, paragraph.page, paragraph.glyphIndexes)
    mark(spans)
    showPassage(passage, spanRects(spans))
  }
  useEffect(() => () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    for (const span of marked.current) span.classList.remove('paper-paragraph-hot')
  }, [])
  const onMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = eventElement(event.target)
    if (!target || target.closest('.paper-toolbar')) return
    blankPress.current = !target.closest('[data-paper-item]')
    if (blankPress.current) {
      window.getSelection()?.removeAllRanges()
      clearHover()
    }
  }
  const onMouseMove = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.buttons !== 0 || pinned.current) return
    cancelHide()
    const target = eventElement(event.target)
    if (!target || target.closest('.paper-toolbar')) return
    const hit = glyphHit(target)
    if (!hit) return
    showParagraph(hit.page, hit.index)
  }
  const onMouseLeave = (event: ReactMouseEvent<HTMLElement>) => {
    const next = eventElement(event.relatedTarget)
    if (next?.closest('.paper-toolbar') || next?.closest('.paper-paragraph-hot')) return
    scheduleHide()
  }
  const onMouseUp = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return
    if (blankPress.current) {
      blankPress.current = false
      clearHover()
      return
    }
    const target = eventElement(event.target)
    if (target?.closest('.paper-toolbar')) return
    const element = root.current
    if (!element) return
    const pointer = target ? glyphHit(target) : null
    const hits = columnScopedHits(getPages(), readPaperHits(element), pointer ?? undefined)
    const passage = locatePassages(getPages(), hits)
    if (!passage) return
    pinned.current = true
    hovered.current = null
    window.getSelection()?.removeAllRanges()
    const spans = hits.flatMap(hit => spansFor(element, hit.page, hit.glyphIndexes))
    mark(spans)
    showPassage(passage, spanRects(spans))
  }
  return {
    selection,
    onMouseDown,
    onMouseMove,
    onMouseLeave,
    onMouseUp,
    holdToolbar: cancelHide,
    releaseToolbar: scheduleHide
  }
}

export function PaperPassageView({ pages, canAsk, askPassage, onAsk }: {
  pages: PaperViewPage[]
  canAsk: boolean
  askPassage?: PaperAsk
  onAsk?: (draft: string) => void
}) {
  useLocale()
  const root = useRef<HTMLDivElement>(null)
  const indexed = useMemo(() => pages.map(page => indexPaperPage(page.page, page.glyphs)), [pages])
  const indexedRef = useRef(indexed)
  indexedRef.current = indexed
  const getPages = useCallback(() => indexedRef.current, [])
  const { selection, onMouseDown, onMouseMove, onMouseLeave, onMouseUp, holdToolbar, releaseToolbar } = usePaperSelection(root, getPages)
  return <div className="paper-passage-view" ref={root} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} onMouseUp={onMouseUp}>
    {pages.map(page => {
      const width = page.width ?? 612
      const height = page.height ?? 792
      return <article key={page.page} className="paper-page" data-paper-page={page.page} style={{ width, height }}>
        {page.glyphs.map((glyph, index) => <span
          key={index}
          data-paper-item={index}
          style={{
            left: glyph.x,
            top: height - glyph.y - glyph.height,
            width: Math.max(glyph.width, 4),
            height: Math.max(glyph.height, 8)
          }}
        >{glyph.text}</span>)}
      </article>
    })}
    {selection && <PaperToolbar selection={selection} canAsk={canAsk} askPassage={askPassage} onAsk={onAsk} onHold={holdToolbar} onRelease={releaseToolbar} />}
  </div>
}

const passageTranslations = new Map<string, string>()

export function PaperToolbar({ selection, canAsk, askPassage, onAsk, onHold, onRelease }: {
  selection: SelectionToolbar
  canAsk: boolean
  askPassage?: PaperAsk
  onAsk?: (draft: string) => void
  onHold?: () => void
  onRelease?: () => void
}) {
  useLocale()
  const [copied, setCopied] = useState(false)
  const [answer, setAnswer] = useState<{ status: 'pending' | 'done' | 'error' | 'cancelled'; text?: string; kind?: 'explain' | 'translate' } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const token = useRef(0)
  const copiedTimer = useRef<number | null>(null)
  useEffect(() => () => {
    abort.current?.abort()
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
  }, [])
  useEffect(() => {
    abort.current?.abort()
    setAnswer(null)
  }, [selection.passage.text])
  const run = (kind: 'explain') => {
    if (!canAsk || !askPassage) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const current = ++token.current
    setAnswer({ status: 'pending', kind })
    void askPassage({ kind, passage: selection.passage }, controller.signal).then(text => {
      if (token.current === current) setAnswer({ status: 'done', text })
    }).catch(error => {
      if (token.current !== current) return
      if (controller.signal.aborted) setAnswer({ status: 'cancelled' })
      else setAnswer({ status: 'error', text: sideQuestionError(error) })
    })
  }
  const copy = () => {
    const text = selection.passage.text
    void window.agentsDock.native.writeClipboard(text).then(() => {
      setCopied(true)
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1200)
    }).catch(() => setAnswer({ status: 'error', text: t('papers.copyFailed') }))
  }
  const translate = () => {
    const source = selection.passage.text
    const remembered = passageTranslations.get(source)
    const current = ++token.current
    abort.current?.abort()
    if (remembered) {
      setAnswer({ status: 'done', kind: 'translate', text: remembered })
      return
    }
    const translatePassage = window.agentsDock.papers?.translate
    if (!translatePassage) {
      setAnswer({ status: 'error', kind: 'translate', text: t('papers.translateFailed') })
      return
    }
    setAnswer({ status: 'pending', kind: 'translate' })
    void translatePassage(source).then(text => {
      if (token.current !== current) return
      passageTranslations.set(source, text)
      setAnswer({ status: 'done', kind: 'translate', text })
    }).catch(() => {
      if (token.current !== current) setAnswer(null)
      else setAnswer({ status: 'error', kind: 'translate', text: t('papers.translateFailed') })
    })
  }
  const unavailable = t('papers.needChat')
  return <div
    className={`paper-toolbar${selection.placement === 'above' ? ' above' : ''}`}
    style={{ left: selection.left, top: `min(${selection.top}px, calc(100vh - 320px))` }}
    role="toolbar"
    aria-label={t('papers.selection')}
    onMouseDown={event => { event.preventDefault(); event.stopPropagation() }}
    onMouseUp={event => event.stopPropagation()}
    onMouseEnter={onHold}
    onMouseLeave={onRelease}
  >
    <div className="paper-toolbar-actions">
      <button type="button" disabled={!canAsk || !askPassage} title={canAsk ? t('papers.explain') : unavailable} onClick={() => run('explain')}>{t('papers.explain')}</button>
      <button type="button" title={t('papers.translateHint')} onClick={translate}>{t('papers.translate')}</button>
      <button type="button" onClick={copy}>{copied ? t('papers.copied') : t('papers.copy')}</button>
      <button type="button" disabled={!canAsk || !onAsk} title={canAsk ? t('papers.ask') : unavailable} onClick={() => onAsk?.(paperAskDraft(selection.passage))}>{t('papers.ask')}</button>
    </div>
    {answer && <div className="paper-answer" role="status">
      {answer.status === 'pending' && <p><LoaderCircle className="spin" size={14} />{t(answer.kind === 'translate' ? 'papers.translating' : 'papers.answering')}</p>}
      {answer.status === 'done' && <p>{answer.text}</p>}
      {answer.status === 'error' && <p>{answer.text}</p>}
      {answer.status === 'cancelled' && <p>{t('sideChat.cancelled')}</p>}
      {answer.status === 'pending'
        ? <button type="button" onClick={() => { abort.current?.abort(); token.current += 1; setAnswer(null) }}>{t('papers.cancel')}</button>
        : <button type="button" aria-label={t('papers.dismiss')} onClick={() => setAnswer(null)}><X size={14} /></button>}
    </div>}
  </div>
}

function eventElement(target: EventTarget | null): Element | null {
  if (!target || typeof target !== 'object' || (target as Node).nodeType !== 1) return null
  return target as Element
}

function glyphHit(target: Element): { page: number; index: number } | null {
  const item = target.closest<HTMLElement>('[data-paper-item]')
  if (!item) return null
  const page = Number(item.dataset.paperPage ?? item.closest<HTMLElement>('[data-paper-page]')?.dataset.paperPage)
  const index = Number(item.dataset.paperItem)
  if (!Number.isInteger(page) || !Number.isInteger(index)) return null
  return { page, index }
}

function paragraphAt(pages: readonly PaperPageIndex[], pageNumber: number, glyphIndex: number): PaperParagraph | null {
  const page = pages.find(item => item.page === pageNumber)
  if (!page) return null
  return page.paragraphs.find(paragraph => !paragraph.furniture && paragraph.glyphIndexes.includes(glyphIndex)) ?? null
}

function spansFor(root: HTMLElement, pageNumber: number, indexes: readonly number[]): HTMLElement[] {
  const wanted = new Set(indexes)
  return [...root.querySelectorAll<HTMLElement>('[data-paper-item]')].filter(span => {
    const page = Number(span.dataset.paperPage ?? span.closest<HTMLElement>('[data-paper-page]')?.dataset.paperPage)
    return page === pageNumber && wanted.has(Number(span.dataset.paperItem))
  })
}

function spanRects(spans: readonly HTMLElement[]): ToolbarRect[] {
  return spans.map(span => rectBox(span.getBoundingClientRect())).filter(rect => rect.width > 0 || rect.height > 0)
}

function rectBox(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): ToolbarRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function rangeIntersects(range: Range, node: Node): boolean {
  try {
    return range.intersectsNode(node)
  } catch {
    return false
  }
}
