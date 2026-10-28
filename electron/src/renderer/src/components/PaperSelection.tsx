import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject, type WheelEvent as ReactWheelEvent } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import { t } from '@shared/i18n'
import {
  continuousMarkRuns,
  dragSelectionHits,
  locateDragPassage,
  indexPaperPage,
  locatePassages,
  paintHitsForMark,
  paperAskDraft,
  paperToolbarPosition,
  retargetPaperMarks,
  type LocatedPassage,
  type PaperGlyph,
  type MarkRunBox,
  type PaperHit,
  type PaperMark,
  type PaperMarkType,
  type PaperPageIndex,
  type PaperParagraph,
  type ToolbarRect
} from '@shared/paper-passages'
import { useLocale } from '../lib/i18n'
import { usePaperMarkController } from './paper-marks'
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
  hits: PaperHit[]
  left: number
  top: number
  placement: 'above' | 'below'
}

/** Crossing the next paragraph on the way to the toolbar must not retarget immediately. */
export const PAPER_PARAGRAPH_RETARGET_MS = 220

export function readPaperHits(root: HTMLElement): Array<{ page: number; glyphIndexes: number[] }> {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return []
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return []
  const hits = new Map<number, number[]>()
  for (const span of root.querySelectorAll<HTMLElement>('[data-paper-item]')) {
    if (!spanOverlapsRange(range, span)) continue
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
  const retargetTimer = useRef<number | null>(null)
  const pendingRetarget = useRef<string | null>(null)
  const pointerDown = useRef(false)
  const applyingSelection = useRef(false)
  const dragPointer = useRef<{ page: number; index: number } | undefined>(undefined)
  const mark = (spans: HTMLElement[]) => {
    for (const span of marked.current) span.classList.remove('paper-paragraph-hot')
    for (const span of spans) span.classList.add('paper-paragraph-hot')
    marked.current = spans
    const element = root.current
    if (element) paintMarkBridges(element)
  }
  const cancelHide = () => {
    if (hideTimer.current === null) return
    window.clearTimeout(hideTimer.current)
    hideTimer.current = null
  }
  const cancelRetarget = () => {
    pendingRetarget.current = null
    if (retargetTimer.current === null) return
    window.clearTimeout(retargetTimer.current)
    retargetTimer.current = null
  }
  const clearHover = () => {
    cancelHide()
    cancelRetarget()
    hovered.current = null
    pinned.current = false
    mark([])
    setSelection(null)
  }
  const scheduleHide = () => {
    cancelHide()
    hideTimer.current = window.setTimeout(clearHover, 220)
  }
  const showPassage = (passage: LocatedPassage, hits: PaperHit[], rects: ToolbarRect[]) => {
    const element = root.current
    if (!element) return
    const frame = rectBox(element.getBoundingClientRect())
    const position = paperToolbarPosition(
      rects.length ? rects : [{ left: frame.left + 24, top: frame.top + 24, width: 8, height: 8 }],
      frame
    )
    setSelection({ passage, hits, ...position })
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
    const hits = [{ page: paragraph.page, glyphIndexes: paragraph.glyphIndexes }]
    const spans = spansFor(element, paragraph.page, paragraph.glyphIndexes)
    mark(spans)
    showPassage(passage, hits, spanRects(spans))
  }
  const scheduleRetarget = (pageNumber: number, glyphIndex: number, id: string) => {
    if (pendingRetarget.current === id) return
    cancelRetarget()
    pendingRetarget.current = id
    retargetTimer.current = window.setTimeout(() => {
      retargetTimer.current = null
      pendingRetarget.current = null
      showParagraph(pageNumber, glyphIndex)
    }, PAPER_PARAGRAPH_RETARGET_MS)
  }
  const commitTextSelection = () => {
    const element = root.current
    if (!element || applyingSelection.current) return false
    const hits = dragSelectionHits(getPages(), readPaperHits(element), dragPointer.current)
    const passage = locateDragPassage(getPages(), hits)
    if (!passage) return false
    applyingSelection.current = true
    pinned.current = true
    hovered.current = null
    window.getSelection()?.removeAllRanges()
    applyingSelection.current = false
    const spans = hits.flatMap(hit => spansFor(element, hit.page, hit.glyphIndexes))
    mark(spans)
    showPassage(passage, hits, spanRects(spans))
    return true
  }
  useEffect(() => {
    const onSelectionChange = () => {
      if (pointerDown.current || applyingSelection.current) return
      commitTextSelection()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  })
  useEffect(() => () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    if (retargetTimer.current !== null) window.clearTimeout(retargetTimer.current)
    for (const span of marked.current) span.classList.remove('paper-paragraph-hot')
  }, [])
  const onMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return
    pointerDown.current = true
    const target = eventElement(event.target)
    if (!target || target.closest('.paper-toolbar')) return
    blankPress.current = !target.closest('[data-paper-item]')
    if (blankPress.current) {
      window.getSelection()?.removeAllRanges()
      clearHover()
    }
  }
  const onMouseMove = (event: ReactMouseEvent<HTMLElement>) => {
    if (pinned.current) return
    if (event.buttons !== 0) {
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) mark([])
      return
    }
    cancelHide()
    const target = eventElement(event.target)
    if (!target || target.closest('.paper-toolbar') || pointerInToolbar(event.clientX, event.clientY)) {
      cancelRetarget()
      return
    }
    const hit = glyphHit(target)
    if (!hit) return
    const paragraph = paragraphAt(getPages(), hit.page, hit.index)
    if (!paragraph || paragraph.id === hovered.current) {
      cancelRetarget()
      return
    }
    if (!hovered.current) {
      showParagraph(hit.page, hit.index)
      return
    }
    scheduleRetarget(hit.page, hit.index, paragraph.id)
  }
  const onMouseLeave = (event: ReactMouseEvent<HTMLElement>) => {
    const next = eventElement(event.relatedTarget)
    if (next?.closest('.paper-toolbar, .workspace-editor-editor-toolbar, .paper-mark-bar, .paper-mark-colors')) {
      cancelRetarget()
      return
    }
    if (next?.closest('.paper-paragraph-hot')) return
    scheduleHide()
  }
  const onMouseUp = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return
    pointerDown.current = false
    const target = eventElement(event.target)
    dragPointer.current = target ? glyphHit(target) ?? undefined : undefined
    if (blankPress.current) {
      blankPress.current = false
      clearHover()
      return
    }
    if (target?.closest('.paper-toolbar')) return
    if (commitTextSelection()) return
    window.requestAnimationFrame(() => { commitTextSelection() })
  }
  return {
    selection,
    onMouseDown,
    onMouseMove,
    onMouseLeave,
    onMouseUp,
    holdToolbar: () => { cancelHide(); cancelRetarget() },
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
  const { marks, replace, toggle, highlightActive, underlineActive } = usePaperMarkController(null, getPages, selection)
  useEffect(() => {
    const element = root.current
    if (!element) return
    const resolved = retargetPaperMarks(indexed, marks)
    if (resolved.changed) {
      replace(resolved.marks)
      return
    }
    applyPaperMarkClasses(element, indexed, marks)
  }, [indexed, marks, replace])
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
    {selection && <PaperToolbar
      selection={selection}
      canAsk={canAsk}
      askPassage={askPassage}
      onAsk={onAsk}
      onHold={holdToolbar}
      onRelease={releaseToolbar}
      highlightActive={highlightActive}
      underlineActive={underlineActive}
      onToggleMark={toggle}
    />}
  </div>
}

const passageTranslations = new Map<string, string>()

export function PaperToolbar({ selection, canAsk, askPassage, onAsk, onHold, onRelease, highlightActive, underlineActive, onToggleMark, onWheel }: {
  selection: SelectionToolbar
  canAsk: boolean
  askPassage?: PaperAsk
  onAsk?: (draft: string) => void
  onHold?: () => void
  onRelease?: () => void
  highlightActive: boolean
  underlineActive: boolean
  onToggleMark: (type: PaperMarkType) => void
  onWheel?: (event: ReactWheelEvent<HTMLDivElement>) => void
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
    onWheel={onWheel}
  >
    <div className="paper-toolbar-actions">
      <button type="button" disabled={!canAsk || !askPassage} title={canAsk ? t('papers.explain') : unavailable} onClick={() => run('explain')}>{t('papers.explain')}</button>
      <button type="button" title={t('papers.translateHint')} onClick={translate}>{t('papers.translate')}</button>
      <button type="button" onClick={copy}>{copied ? t('papers.copied') : t('papers.copy')}</button>
      <button type="button" disabled={!canAsk || !onAsk} title={canAsk ? t('papers.ask') : unavailable} onClick={() => onAsk?.(paperAskDraft(selection.passage))}>{t('papers.ask')}</button>
      <button type="button" aria-pressed={highlightActive} title={highlightActive ? t('papers.removeHighlight') : t('papers.highlightHint')} onClick={() => onToggleMark('highlight')}>{t('papers.highlight')}</button>
      <button type="button" aria-pressed={underlineActive} title={underlineActive ? t('papers.removeUnderline') : t('papers.underlineHint')} onClick={() => onToggleMark('underline')}>{t('papers.underline')}</button>
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

function pointerInToolbar(x: number, y: number): boolean {
  const toolbar = document.querySelector('.paper-toolbar')
  if (!toolbar) return false
  const box = toolbar.getBoundingClientRect()
  if (box.width < 8 || box.height < 8) return false
  const pad = 14
  return x >= box.left - pad && x <= box.right + pad && y >= box.top - pad && y <= box.bottom + pad
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

export function applyPaperMarkClasses(root: HTMLElement, pages: readonly PaperPageIndex[], marks: readonly PaperMark[]): void {
  for (const span of root.querySelectorAll<HTMLElement>('.paper-mark-highlight, .paper-mark-underline')) {
    span.classList.remove('paper-mark-highlight', 'paper-mark-underline')
    span.style.removeProperty('--paper-highlight')
    span.style.removeProperty('--paper-underline')
  }
  for (const mark of marks) {
    const className = mark.type === 'highlight' ? 'paper-mark-highlight' : 'paper-mark-underline'
    const variable = mark.type === 'highlight' ? '--paper-highlight' : '--paper-underline'
    for (const hit of paintHitsForMark(pages, mark)) {
      for (const span of spansFor(root, hit.page, hit.glyphIndexes)) {
        span.classList.add(className)
        span.style.setProperty(variable, mark.color)
      }
    }
  }
  paintMarkBridges(root)
}

/** One band per line, covering the spaces between the marked words. */
export function paintMarkBridges(root: HTMLElement): void {
  root.querySelectorAll('.paper-mark-bridge').forEach(node => node.remove())
  const hosts = [...root.querySelectorAll<HTMLElement>('.textLayer')]
  if (!hosts.length) hosts.push(...root.querySelectorAll<HTMLElement>('.paper-page'))
  for (const host of hosts) {
    const spans = [...host.querySelectorAll<HTMLElement>('[data-paper-item]')]
    paintBridgeRuns(host, spans, 'paper-mark-highlight', '--paper-highlight')
    paintBridgeRuns(host, spans, 'paper-mark-underline', '--paper-underline')
    paintBridgeRuns(host, spans, 'paper-paragraph-hot', '')
  }
}

function paintBridgeRuns(host: HTMLElement, spans: HTMLElement[], className: string, variable: string): void {
  const hostBox = host.getBoundingClientRect()
  const boxes = spans.flatMap(span => {
    const box = spanBox(hostBox, span)
    if (!box) return []
    const color = variable ? span.style.getPropertyValue(variable) : ''
    return [{ span, ...box, color }]
  })
  const selected = boxes.filter(item => item.span.classList.contains(className) && (className !== 'paper-mark-highlight' || !item.span.classList.contains('paper-paragraph-hot')))
  const others = boxes.filter(item => !item.span.classList.contains(className))
  for (const run of continuousMarkRuns(selected, others)) {
    const left = Math.min(...run.map(item => item.left))
    const right = Math.max(...run.map(item => item.right))
    const top = Math.min(...run.map(item => item.top))
    const bottom = Math.max(...run.map(item => item.bottom))
    const bar = document.createElement('div')
    bar.className = `paper-mark-bridge ${className}`
    bar.style.left = `${left}px`
    bar.style.top = `${top}px`
    bar.style.width = `${Math.max(right - left, 1)}px`
    bar.style.height = `${Math.max(bottom - top, 1)}px`
    if (variable && run[0].color) bar.style.setProperty(variable, run[0].color)
    host.append(bar)
  }
}

function spanBox(hostBox: DOMRect, span: HTMLElement): MarkRunBox | null {
  const box = span.getBoundingClientRect()
  const width = box.width || span.offsetWidth
  const height = box.height || span.offsetHeight
  if (width <= 0 || height <= 0) return null
  const left = box.width > 0 ? box.left - hostBox.left : span.offsetLeft
  const top = box.height > 0 ? box.top - hostBox.top : span.offsetTop
  return { left, top, right: left + width, bottom: top + height, color: '' }
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

/** True when the drag covers this word, not merely the rest of its line. */
function spanOverlapsRange(range: Range, span: HTMLElement): boolean {
  if (!rangeIntersects(range, span)) return false
  const probe = document.createRange()
  try {
    probe.selectNodeContents(span)
    const startsBeforeEnd = range.compareBoundaryPoints(Range.END_TO_START, probe) < 0
    const endsAfterStart = range.compareBoundaryPoints(Range.START_TO_END, probe) > 0
    return startsBeforeEnd && endsAfterStart
  } catch {
    return true
  }
}
