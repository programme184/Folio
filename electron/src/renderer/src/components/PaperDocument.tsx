import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, ListTree, Maximize, Minimize, StickyNote, ZoomIn, ZoomOut } from 'lucide-react'
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { t } from '@shared/i18n'
import { glyphsFromTextContent, indexPaperPage, paperWordPieces, retargetPaperMarks, type PaperMark, type PaperPageIndex } from '@shared/paper-passages'
import { useLocale } from '../lib/i18n'
import type { PaperNoteSource } from './paper-notes'
import { usePaperMarkController } from './paper-marks'
import { usePublishPaperMarkBar } from './paper-mark-bar'
import { PaperNotesPanel } from './PaperNotes'
import { applyPaperMarkClasses, PaperToolbar, usePaperSelection, type PaperAsk } from './PaperSelection'

GlobalWorkerOptions.workerSrc = workerUrl

const MAX_PAGES = 80
const PAPER_WIDTH_EPSILON = 2
const PAPER_OUTPUT_SCALE_LIMIT = 2
const LIGHT_PAPER_COLOR = '#f4ecd8'
const PAGE_RENDER_MARGIN = '100% 0px'

export function nextPaperWidth(current: number, measured: number): number {
  if (!Number.isFinite(measured)) return current
  const rounded = Math.round(measured)
  if (rounded < 40) return current
  if (current > 0 && Math.abs(current - rounded) < PAPER_WIDTH_EPSILON) return current
  return rounded
}

export function paperOutputScale(devicePixelRatio: number): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  return Math.min(ratio, PAPER_OUTPUT_SCALE_LIMIT)
}

export function paperScrollAnchor(scrollTop: number, scrollHeight: number): number {
  if (!(scrollHeight > 0)) return 0
  return Math.min(1, Math.max(0, scrollTop / scrollHeight))
}

export function paperScrollTopForAnchor(anchor: number, scrollHeight: number): number {
  if (!(scrollHeight > 0) || !(anchor > 0)) return 0
  return anchor * scrollHeight
}

export function paperWheelPixels(delta: number, deltaMode: number, viewport: number): number {
  if (deltaMode === 1) return delta * 16
  if (deltaMode === 2) return delta * Math.max(1, viewport)
  return delta
}

export function paperAnswerConsumesWheel(
  element: { scrollTop: number; scrollHeight: number; clientHeight: number },
  deltaY: number
): boolean {
  if (deltaY === 0) return false
  const max = element.scrollHeight - element.clientHeight
  if (max <= 1) return false
  if (deltaY > 0) return element.scrollTop < max - 1
  return element.scrollTop > 1
}

export type PaperPageKey = 'down' | 'up' | 'home'

/** Space, PageDown, PageUp, and Home turn the paper when no modifier blocks them. */
export function paperPageKeyAction(event: {
  key: string
  code: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}): PaperPageKey | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null
  if (event.key === 'Home' || event.code === 'Home') return event.shiftKey ? null : 'home'
  if (event.key === 'PageDown' || event.code === 'PageDown') return event.shiftKey ? null : 'down'
  if (event.key === 'PageUp' || event.code === 'PageUp') return event.shiftKey ? null : 'up'
  if (event.key === ' ' || event.code === 'Space') return event.shiftKey ? 'up' : 'down'
  return null
}

export function paperKeyTargetBlocksPaging(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"], .paper-answer'))
}

/** Jump to the next or previous paper page, or the top. Falls back to one viewport. */
export function paperPageScrollTop(
  action: PaperPageKey,
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  pageTops: readonly number[] = []
): number {
  const max = Math.max(0, scrollHeight - clientHeight)
  if (action === 'home') return 0
  const tops = pageTops.filter(top => Number.isFinite(top)).slice().sort((a, b) => a - b)
  if (tops.length) {
    if (action === 'down') {
      const next = tops.find(top => top > scrollTop + 1)
      if (next !== undefined) return Math.min(max, next)
    } else {
      const previous = tops.slice().reverse().find(top => top < scrollTop - 1)
      if (previous !== undefined) return Math.max(0, previous)
      return 0
    }
  }
  const step = Math.max(1, clientHeight)
  if (action === 'down') return Math.min(max, scrollTop + step)
  return Math.max(0, scrollTop - step)
}

export function tintPaperCanvas(canvas: HTMLCanvasElement, color: string): void {
  if (canvas.width < 1 || canvas.height < 1) return
  const context = canvas.getContext('2d')
  if (!context) return
  context.save()
  context.globalCompositeOperation = 'darken'
  context.fillStyle = color
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.restore()
}

const OUTLINE_NODE_LIMIT = 400
const OUTLINE_DEPTH_LIMIT = 8

export interface PaperOutlineEntry {
  id: string
  title: string
  page: number | null
  /** Distance from the top of the page, as a fraction of the page height. */
  fraction: number
  bold: boolean
  italic: boolean
  children: PaperOutlineEntry[]
}

interface PdfOutlineNode {
  title?: unknown
  bold?: boolean
  italic?: boolean
  dest?: unknown
  items?: unknown
}

interface OutlineDocument {
  getOutline(): Promise<readonly PdfOutlineNode[] | null>
  getDestination(id: string): Promise<readonly unknown[] | null>
  getPageIndex(ref: { num: number; gen: number }): Promise<number>
  getPage(pageNumber: number): Promise<{ getViewport(params: { scale: number }): { height: number } }>
}

/** How far down a page a PDF destination sits. 0 is the top of the page. */
export function paperDestinationFraction(pageHeight: number, dest: readonly unknown[]): number {
  if (!(pageHeight > 0)) return 0
  const top = outlineDestTop(dest)
  if (top === null) return 0
  return Math.min(1, Math.max(0, (pageHeight - top) / pageHeight))
}

export function paperOutlineScrollTop(pageTop: number, pageHeight: number, fraction: number): number {
  if (!(pageHeight > 0) || !(fraction > 0)) return pageTop
  return pageTop + Math.min(1, fraction) * pageHeight
}

export async function readPaperOutline(pdf: OutlineDocument): Promise<PaperOutlineEntry[]> {
  const listed = await pdf.getOutline()
  if (!Array.isArray(listed) || listed.length === 0) return []
  return walkOutline(pdf, outlineNodes(listed), '', 0, new Map(), { count: 0 })
}

function outlineDestKind(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'name' in value && typeof value.name === 'string') return value.name
  return ''
}

function outlineDestTop(dest: readonly unknown[]): number | null {
  const kind = outlineDestKind(dest[1])
  const raw = kind === 'XYZ' ? dest[3] : kind === 'FitH' || kind === 'FitBH' ? dest[2] : kind === 'FitR' ? dest[5] : undefined
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

function outlineRef(value: unknown): { num: number; gen: number } | null {
  if (!value || typeof value !== 'object') return null
  const ref = value as { num?: unknown; gen?: unknown }
  if (typeof ref.num !== 'number' || !Number.isInteger(ref.num)) return null
  const gen = typeof ref.gen === 'number' && Number.isInteger(ref.gen) ? ref.gen : 0
  return { num: ref.num, gen }
}

function outlineTitle(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim()
}

function outlineNodes(value: unknown): PdfOutlineNode[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is PdfOutlineNode => Boolean(item) && typeof item === 'object')
}

async function walkOutline(
  pdf: OutlineDocument,
  nodes: PdfOutlineNode[],
  prefix: string,
  depth: number,
  heights: Map<number, number>,
  state: { count: number }
): Promise<PaperOutlineEntry[]> {
  if (depth >= OUTLINE_DEPTH_LIMIT) return []
  const entries: PaperOutlineEntry[] = []
  for (let index = 0; index < nodes.length; index += 1) {
    if (state.count >= OUTLINE_NODE_LIMIT) break
    const node = nodes[index]
    const title = outlineTitle(node?.title)
    if (!title) {
      entries.push(...await walkOutline(pdf, outlineNodes(node?.items), `${prefix}${index}.`, depth + 1, heights, state))
      continue
    }
    state.count += 1
    const children = await walkOutline(pdf, outlineNodes(node?.items), `${prefix}${index}.`, depth + 1, heights, state)
    const located = await locateOutline(pdf, node?.dest, heights)
    entries.push({
      id: `${prefix}${index}`,
      title,
      page: located?.page ?? null,
      fraction: located?.fraction ?? 0,
      bold: node?.bold === true,
      italic: node?.italic === true,
      children
    })
  }
  return entries
}

async function locateOutline(
  pdf: OutlineDocument,
  dest: unknown,
  heights: Map<number, number>
): Promise<{ page: number; fraction: number } | null> {
  let explicit: unknown = dest
  if (typeof dest === 'string') {
    if (!dest) return null
    try {
      explicit = await pdf.getDestination(dest)
    } catch {
      return null
    }
  }
  if (!Array.isArray(explicit) || explicit.length === 0) return null
  const ref = outlineRef(explicit[0])
  if (!ref) return null
  let pageIndex: number
  try {
    pageIndex = await pdf.getPageIndex(ref)
  } catch {
    return null
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return null
  const page = pageIndex + 1
  if (outlineDestTop(explicit) === null) return { page, fraction: 0 }
  const height = await outlinePageHeight(pdf, page, heights)
  return { page, fraction: paperDestinationFraction(height, explicit) }
}

async function outlinePageHeight(pdf: OutlineDocument, page: number, heights: Map<number, number>): Promise<number> {
  const cached = heights.get(page)
  if (cached !== undefined) return cached
  try {
    const proxy = await pdf.getPage(page)
    const height = proxy.getViewport({ scale: 1 }).height
    const safe = Number.isFinite(height) && height > 0 ? height : 0
    heights.set(page, safe)
    return safe
  } catch {
    heights.set(page, 0)
    return 0
  }
}

function PaperOutlineBranch({ entry, activeId, onOpen }: {
  entry: PaperOutlineEntry
  activeId: string | null
  onOpen: (entry: PaperOutlineEntry) => void
}) {
  const [open, setOpen] = useState(entry.children.length > 0)
  const nested = entry.children.length > 0
  const className = `paper-outline-link${entry.bold ? ' is-bold' : ''}${entry.italic ? ' is-italic' : ''}`
  return <li>
    <div className="paper-outline-row">
      {nested
        ? <button
          type="button"
          className="paper-outline-disclosure"
          aria-expanded={open}
          aria-label={t(open ? 'papers.outlineCollapse' : 'papers.outlineExpand', { title: entry.title })}
          onClick={() => setOpen(value => !value)}
        >{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
        : <span className="paper-outline-disclosure-spacer" aria-hidden="true" />}
      {entry.page === null
        ? <span className={`${className} is-static`}><span className="paper-outline-title">{entry.title}</span></span>
        : <button
          type="button"
          className={className}
          aria-current={activeId === entry.id ? 'true' : undefined}
          onClick={() => onOpen(entry)}
        >
          <span className="paper-outline-title">{entry.title}</span>
          <span className="paper-outline-page">{entry.page}</span>
        </button>}
    </div>
    {nested && open && <ul className="paper-outline-children">
      {entry.children.map(child => <PaperOutlineBranch key={child.id} entry={child} activeId={activeId} onOpen={onOpen} />)}
    </ul>}
  </li>
}

export function PaperDocument({ data, documentKey = null, notes = null, canAsk, askPassage, onAsk }: {
  data: Uint8Array
  documentKey?: string | null
  notes?: PaperNoteSource | null
  canAsk: boolean
  askPassage?: PaperAsk
  onAsk?: (draft: string) => void
}) {
  useLocale()
  const scroller = useRef<HTMLDivElement>(null)
  const indexes = useRef<PaperPageIndex[]>([])
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const getPages = useCallback(() => indexes.current, [])
  const { selection, onMouseDown, onMouseMove, onMouseLeave, onMouseUp, holdToolbar, releaseToolbar } = usePaperSelection(scroller, getPages)
  const { marks, replace, toggle, highlightActive, underlineActive, color, setColor } = usePaperMarkController(documentKey, getPages, selection)
  usePublishPaperMarkBar({
    enabled: selection !== null,
    highlightActive,
    underlineActive,
    color,
    setColor,
    toggle,
    hold: holdToolbar,
    release: releaseToolbar
  })
  const marksRef = useRef(marks)
  marksRef.current = marks
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark')
  const [pdfGeneration, setPdfGeneration] = useState(0)
  const [message, setMessage] = useState(t('papers.loading'))
  const [renderId, setRenderId] = useState(0)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outline, setOutline] = useState<PaperOutlineEntry[] | null>(null)
  const [activeOutline, setActiveOutline] = useState<string | null>(null)
  const outlineToggle = useRef<HTMLButtonElement>(null)
  const outlineWasOpen = useRef(false)
  const [outlineSlot, setOutlineSlot] = useState<HTMLElement | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const documentRoot = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const element = documentRoot.current
    const sync = () => setFullscreen(element !== null && document.fullscreenElement === element)
    document.addEventListener('fullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      if (element && document.fullscreenElement === element) void document.exitFullscreen().catch(() => undefined)
    }
  }, [])
  const toggleFullscreen = () => {
    const element = documentRoot.current
    if (!element) return
    const exit = document.fullscreenElement === element
    void (exit ? document.exitFullscreen() : element.requestFullscreen()).catch(() => undefined)
  }
  const scrollFromToolbar = (event: ReactWheelEvent<HTMLDivElement>) => {
    const answer = event.target instanceof Element ? event.target.closest('.paper-answer') : null
    if (answer instanceof HTMLElement && paperAnswerConsumesWheel(answer, event.deltaY)) return
    const element = scroller.current
    if (!element) return
    element.scrollTop += paperWheelPixels(event.deltaY, event.deltaMode, element.clientHeight)
    element.scrollLeft += paperWheelPixels(event.deltaX, event.deltaMode, element.clientWidth)
  }
  const turnPageFromKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (paperKeyTargetBlocksPaging(event.target)) return
    const action = paperPageKeyAction(event)
    if (!action) return
    const element = scroller.current
    if (!element) return
    const pageTops = [...element.querySelectorAll<HTMLElement>('.paper-page')].map(page => page.offsetTop)
    const next = paperPageScrollTop(action, element.scrollTop, element.clientHeight, element.scrollHeight, pageTops)
    if (next === element.scrollTop) return
    event.preventDefault()
    element.scrollTop = next
  }
  const focusScroller = () => {
    scroller.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    const toolbar = scroller.current?.closest('.workspace-editor-editor')?.querySelector('.workspace-editor-editor-toolbar')
    if (!toolbar) return
    const enter = () => holdToolbar()
    const leave = (event: Event) => {
      const next = event instanceof MouseEvent ? event.relatedTarget : null
      if (next instanceof Element && next.closest('.paper-document, .paper-toolbar, .paper-mark-colors')) return
      releaseToolbar()
    }
    toolbar.addEventListener('mouseenter', enter)
    toolbar.addEventListener('mouseleave', leave)
    return () => {
      toolbar.removeEventListener('mouseenter', enter)
      toolbar.removeEventListener('mouseleave', leave)
    }
  }, [holdToolbar, releaseToolbar])
  useEffect(() => {
    const node = document.documentElement
    const read = () => setTheme(node.getAttribute('data-theme') === 'light' ? 'light' : 'dark')
    const observer = new MutationObserver(read)
    observer.observe(node, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    let timer = 0
    const measure = () => setWidth(current => nextPaperWidth(current, element.clientWidth))
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(measure, 150)
    })
    observer.observe(element.closest('.paper-document') ?? element)
    measure()
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [])
  useLayoutEffect(() => {
    const changed = outlineWasOpen.current !== outlineOpen
    outlineWasOpen.current = outlineOpen
    if (!changed) return
    const element = scroller.current
    if (!element) return
    setWidth(current => nextPaperWidth(current, element.clientWidth))
  }, [outlineOpen])
  useLayoutEffect(() => {
    const slot = scroller.current?.closest('.workspace-editor-editor')?.querySelector('.paper-outline-slot')
    setOutlineSlot(slot instanceof HTMLElement ? slot : null)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setMessage(t('papers.loading'))
    const task = getDocument({ data: data.slice(), disableRange: true, disableStream: true })
    const cancelTask = () => { void task.destroy().catch(() => undefined) }
    controller.signal.addEventListener('abort', cancelTask, { once: true })
    void task.promise.then(pdf => {
      if (controller.signal.aborted) {
        void pdf.loadingTask.destroy().catch(() => undefined)
        return
      }
      pdfRef.current = pdf
      setPdfGeneration(value => value + 1)
    }).catch(error => {
      if (controller.signal.aborted || isCancelled(error)) return
      setMessage(t('papers.loadFailed'))
    })
    return () => {
      controller.abort()
      const current = pdfRef.current
      pdfRef.current = null
      void current?.loadingTask.destroy().catch(() => undefined)
    }
  }, [data])
  useEffect(() => {
    const pdf = pdfRef.current
    if (!pdf) {
      setOutline(null)
      setActiveOutline(null)
      return
    }
    let cancelled = false
    setOutline(null)
    setActiveOutline(null)
    void readPaperOutline(pdf).then(entries => {
      if (!cancelled) setOutline(entries)
    }).catch(error => {
      if (cancelled || isCancelled(error)) return
      setOutline([])
    })
    return () => { cancelled = true }
  }, [data, pdfGeneration])
  useEffect(() => {
    const element = scroller.current
    const pdf = pdfRef.current
    if (!element || !pdf || width < 40) return
    let cancelled = false
    let stop = () => {}
    void presentPaper({
      root: element,
      pdf,
      width,
      zoom,
      theme,
      indexes,
      getMarks: () => marksRef.current,
      isActive: () => !cancelled,
      bindCancel: cancel => { stop = cancel }
    }).then(result => {
      if (cancelled || !result) return
      setRenderId(value => value + 1)
      if (!result.selectable) setMessage(t('papers.noText'))
      else if (result.truncated) setMessage(t('papers.truncated', { count: MAX_PAGES }))
      else setMessage('')
    }).catch(error => {
      if (cancelled || isCancelled(error)) return
      setMessage(t('papers.loadFailed'))
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [data, pdfGeneration, width, zoom, theme])
  useEffect(() => {
    const element = scroller.current
    if (!element || !indexes.current.length) return
    const resolved = retargetPaperMarks(indexes.current, marks)
    if (resolved.changed) {
      replace(resolved.marks)
      return
    }
    applyPaperMarkClasses(element, indexes.current, marks)
  }, [marks, renderId, replace])
  const jumpToOutline = (entry: PaperOutlineEntry) => {
    setActiveOutline(entry.id)
    const root = scroller.current
    if (!root || entry.page === null) return
    const page = root.querySelector<HTMLElement>(`[data-paper-page="${entry.page}"]`)
    if (!page) return
    root.scrollTop = paperOutlineScrollTop(page.offsetTop, page.offsetHeight, entry.fraction)
    root.focus({ preventScroll: true })
  }
  const closeOutline = () => {
    setOutlineOpen(false)
    outlineToggle.current?.focus()
  }
  const outlineButton = <button
    ref={outlineToggle}
    type="button"
    className="paper-outline-toggle"
    aria-expanded={outlineOpen}
    aria-controls={outlineOpen ? 'paper-outline' : undefined}
    aria-label={t('papers.outline')}
    title={t('papers.outline')}
    onClick={() => setOutlineOpen(value => !value)}
  ><ListTree size={15} /></button>
  return <div className="paper-document" ref={documentRoot}>
    <div className="paper-document-tools">
      {outlineSlot ? createPortal(outlineButton, outlineSlot) : outlineButton}
      <button
        type="button"
        className="paper-tool-button"
        aria-expanded={notesOpen}
        aria-label={t('papers.notes')}
        title={t('papers.notesHint')}
        onClick={() => setNotesOpen(value => !value)}
      ><StickyNote size={15} /></button>
      <div className="paper-document-zoom">
        <button type="button" aria-label={t('papers.zoomOut')} onClick={() => setZoom(value => Math.max(0.6, Math.round((value - 0.2) * 10) / 10))}><ZoomOut size={15} /></button>
        <button type="button" aria-label={t('papers.zoomIn')} onClick={() => setZoom(value => Math.min(2.5, Math.round((value + 0.2) * 10) / 10))}><ZoomIn size={15} /></button>
        {document.fullscreenEnabled && <button
          type="button"
          aria-pressed={fullscreen}
          aria-label={fullscreen ? t('papers.exitFullscreen') : t('papers.fullscreen')}
          title={fullscreen ? t('papers.exitFullscreen') : t('papers.fullscreen')}
          onClick={toggleFullscreen}
        >{fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}</button>}
      </div>
    </div>
    {message && <p className="paper-document-status" role="status">{message}</p>}
    <div className="paper-document-body">
      {outlineOpen && <nav
        id="paper-outline"
        className="paper-outline"
        aria-label={t('papers.outline')}
        onKeyDown={event => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          closeOutline()
        }}
      >
        {outline === null && <p className="paper-outline-empty" role="status">{t('papers.outlineLoading')}</p>}
        {outline && outline.length === 0 && <p className="paper-outline-empty">{t('papers.outlineEmpty')}</p>}
        {outline && outline.length > 0 && <ul className="paper-outline-list">
          {outline.map(entry => <PaperOutlineBranch key={entry.id} entry={entry} activeId={activeOutline} onOpen={jumpToOutline} />)}
        </ul>}
      </nav>}
      {notesOpen && <PaperNotesPanel key={notes?.key ?? 'none'} files={notes?.files ?? null} />}
      <div
        className="paper-document-scroll"
        ref={scroller}
        tabIndex={0}
        onMouseDown={event => { focusScroller(); onMouseDown(event) }}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onMouseUp={onMouseUp}
        onKeyDown={turnPageFromKey}
      />
    </div>
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
      onWheel={scrollFromToolbar}
    />}
  </div>
}

interface PageSlot {
  pageNumber: number
  page: PDFPageProxy
  article: HTMLElement
  canvas: HTMLCanvasElement
  textHost: HTMLDivElement
  viewport: ReturnType<PDFPageProxy['getViewport']>
  textPromise: ReturnType<PDFPageProxy['getTextContent']> | null
  token: number
  renderTask: RenderTask | null
  layer: TextLayer | null
  wanted: boolean
  queued: boolean
}

async function presentPaper(input: {
  root: HTMLElement
  pdf: PDFDocumentProxy
  width: number
  zoom: number
  theme: 'light' | 'dark'
  indexes: { current: PaperPageIndex[] }
  getMarks: () => PaperMark[]
  isActive: () => boolean
  bindCancel: (cancel: () => void) => void
}): Promise<{ selectable: boolean; truncated: boolean } | null> {
  const { root, pdf, width, zoom, theme, indexes, getMarks, isActive, bindCancel } = input
  indexes.current = []
  const count = Math.min(pdf.numPages, MAX_PAGES)
  const records: PageSlot[] = []
  const replaceExisting = Boolean(root.querySelector('.paper-page'))
  const fragment = replaceExisting ? document.createDocumentFragment() : null
  const host: ParentNode = fragment ?? root
  let observer: IntersectionObserver | null = null
  let queue = Promise.resolve()
  const paintMarks = () => {
    if (!isActive() || !indexes.current.length) return
    applyPaperMarkClasses(root, indexes.current, getMarks())
  }
  const release = (record: PageSlot) => {
    record.wanted = false
    record.queued = false
    record.token += 1
    record.renderTask?.cancel()
    record.renderTask = null
    record.layer?.cancel()
    record.layer = null
    record.textHost.replaceChildren()
    record.canvas.width = 0
    record.canvas.height = 0
  }
  const enqueue = (record: PageSlot) => {
    if (!record.wanted || record.queued || record.layer || record.renderTask) return
    record.queued = true
    queue = queue.then(async () => {
      record.queued = false
      if (!isActive() || !record.wanted || record.layer) return
      await paintPage(record, root, theme, getMarks, indexes, isActive)
      paintMarks()
      await nextFrame()
    }).catch(() => {
      record.queued = false
    })
  }
  const cancelSession = () => {
    observer?.disconnect()
    observer = null
    for (const record of records) {
      record.wanted = false
      record.queued = false
      record.token += 1
      record.renderTask?.cancel()
      record.renderTask = null
    }
  }
  bindCancel(cancelSession)
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(entries => {
      if (!isActive()) return
      for (const entry of entries) {
        const record = records.find(item => item.article === entry.target)
        if (!record) continue
        if (entry.isIntersecting) {
          record.wanted = true
          enqueue(record)
        } else release(record)
      }
    }, { root, rootMargin: PAGE_RENDER_MARGIN })
  }
  try {
    for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
      if (!isActive()) return null
      const page = await pdf.getPage(pageNumber)
      if (!isActive()) return null
      const record = createPageSlot(page, pageNumber, width, zoom)
      records.push(record)
      host.append(record.article)
      if (!fragment) observer?.observe(record.article)
      if (!observer) {
        record.wanted = true
        enqueue(record)
      }
      await nextFrame()
    }
    if (!isActive()) return null
    if (fragment) {
      const anchor = paperScrollAnchor(root.scrollTop, root.scrollHeight)
      root.replaceChildren(fragment)
      root.scrollTop = paperScrollTopForAnchor(anchor, root.scrollHeight)
      for (const record of records) observer?.observe(record.article)
    }
    const built: PaperPageIndex[] = []
    for (const record of records) {
      if (!isActive()) return null
      const text = await textFor(record)
      if (!isActive()) return null
      built.push(indexPaperPage(record.pageNumber, glyphsFromTextContent(text.items)))
      indexes.current = built.slice()
      paintMarks()
      await nextFrame()
    }
    if (!isActive()) return null
    return {
      selectable: built.some(page => page.paragraphs.some(paragraph => !paragraph.furniture)),
      truncated: pdf.numPages > MAX_PAGES
    }
  } catch (error) {
    if (!isActive() || isCancelled(error)) return null
    cancelSession()
    throw error
  }
}

function createPageSlot(page: PDFPageProxy, pageNumber: number, width: number, zoom: number): PageSlot {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.max(0.2, ((width - 28) / base.width) * zoom)
  const viewport = page.getViewport({ scale })
  const article = document.createElement('article')
  article.className = 'paper-page'
  article.dataset.paperPage = String(pageNumber)
  article.style.width = `${viewport.width}px`
  article.style.height = `${viewport.height}px`
  article.style.setProperty('--scale-factor', String(viewport.scale))
  const canvas = document.createElement('canvas')
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`
  const textHost = document.createElement('div')
  textHost.className = 'textLayer'
  article.append(canvas, textHost)
  return {
    pageNumber,
    page,
    article,
    canvas,
    textHost,
    viewport,
    textPromise: null,
    token: 0,
    renderTask: null,
    layer: null,
    wanted: false,
    queued: false
  }
}

async function paintPage(
  record: PageSlot,
  root: HTMLElement,
  theme: 'light' | 'dark',
  getMarks: () => PaperMark[],
  indexes: { current: PaperPageIndex[] },
  isActive: () => boolean
): Promise<void> {
  if (record.layer || record.renderTask) return
  const token = record.token + 1
  record.token = token
  const outputScale = paperOutputScale(window.devicePixelRatio || 1)
  record.canvas.width = Math.floor(record.viewport.width * outputScale)
  record.canvas.height = Math.floor(record.viewport.height * outputScale)
  const renderTask = record.page.render({
    canvas: record.canvas,
    viewport: record.viewport,
    transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
    background: theme === 'light' ? LIGHT_PAPER_COLOR : undefined
  })
  record.renderTask = renderTask
  const text = await textFor(record)
  if (!isActive() || record.token !== token) {
    renderTask.cancel()
    if (record.renderTask === renderTask) record.renderTask = null
    return
  }
  if (!record.wanted) {
    renderTask.cancel()
    if (record.renderTask === renderTask) record.renderTask = null
    record.canvas.width = 0
    record.canvas.height = 0
    return
  }
  const layer = new TextLayer({ textContentSource: text, container: record.textHost, viewport: record.viewport })
  record.layer = layer
  try {
    await Promise.all([
      renderTask.promise.catch(error => { if (isActive() && record.token === token && !isCancelled(error)) throw error }),
      layer.render().catch(error => { if (isActive() && record.token === token && !isCancelled(error)) throw error })
    ])
  } finally {
    if (record.renderTask === renderTask) record.renderTask = null
  }
  if (!isActive() || record.token !== token) {
    layer.cancel()
    if (record.layer === layer) record.layer = null
    return
  }
  if (!record.wanted) {
    layer.cancel()
    record.layer = null
    record.textHost.replaceChildren()
    record.canvas.width = 0
    record.canvas.height = 0
    return
  }
  if (theme === 'light') tintPaperCanvas(record.canvas, LIGHT_PAPER_COLOR)
  tagTextDivs(layer.textDivs, layer.textContentItemsStr, record.pageNumber)
  if (indexes.current.length) applyPaperMarkClasses(root, indexes.current, getMarks())
}

function textFor(record: PageSlot): ReturnType<PDFPageProxy['getTextContent']> {
  record.textPromise ??= record.page.getTextContent()
  return record.textPromise
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => {
    window.requestAnimationFrame(() => resolve())
  })
}

function tagTextDivs(divs: HTMLElement[], strings: string[], pageNumber: number): void {
  let glyphIndex = 0
  for (let index = 0; index < divs.length; index += 1) {
    const value = strings[index] ?? ''
    if (!value) continue
    glyphIndex = tagPaperTextSpan(divs[index], value, pageNumber, glyphIndex)
  }
}

/** Give each word in a line its own span so a drag can stop on a word or a short phrase. */
export function tagPaperTextSpan(span: HTMLElement, text: string, pageNumber: number, glyphIndex: number): number {
  const pieces = paperWordPieces(text)
  span.dataset.paperPage = String(pageNumber)
  if (pieces.length <= 1) {
    span.dataset.paperItem = String(glyphIndex)
    return glyphIndex + 1
  }
  delete span.dataset.paperItem
  const end = [...span.childNodes].find(node => node instanceof HTMLBRElement)
  span.replaceChildren()
  let cursor = 0
  for (const piece of pieces) {
    if (piece.start > cursor) span.append(document.createTextNode(text.slice(cursor, piece.start)))
    const word = document.createElement('span')
    word.dataset.paperItem = String(glyphIndex)
    word.dataset.paperPage = String(pageNumber)
    word.textContent = piece.text
    span.append(word)
    glyphIndex += 1
    cursor = piece.end
  }
  if (cursor < text.length) span.append(document.createTextNode(text.slice(cursor)))
  if (end) span.append(end)
  return glyphIndex
}

function isCancelled(error: unknown): boolean {
  const name = error instanceof Error ? error.name : ''
  return name === 'AbortException' || name === 'RenderingCancelledException' || name === 'AbortError'
}
