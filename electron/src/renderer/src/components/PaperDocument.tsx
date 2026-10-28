import { useCallback, useEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { t } from '@shared/i18n'
import { glyphsFromTextContent, indexPaperPage, paperWordPieces, retargetPaperMarks, type PaperMark, type PaperPageIndex } from '@shared/paper-passages'
import { useLocale } from '../lib/i18n'
import { usePaperMarkController } from './paper-marks'
import { usePublishPaperMarkBar } from './paper-mark-bar'
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

export function PaperDocument({ data, documentKey = null, canAsk, askPassage, onAsk }: {
  data: Uint8Array
  documentKey?: string | null
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
  const scrollFromToolbar = (event: ReactWheelEvent<HTMLDivElement>) => {
    const answer = event.target instanceof Element ? event.target.closest('.paper-answer') : null
    if (answer instanceof HTMLElement && paperAnswerConsumesWheel(answer, event.deltaY)) return
    const element = scroller.current
    if (!element) return
    element.scrollTop += paperWheelPixels(event.deltaY, event.deltaMode, element.clientHeight)
    element.scrollLeft += paperWheelPixels(event.deltaX, event.deltaMode, element.clientWidth)
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
  return <div className="paper-document">
    <div className="paper-document-tools">
      <button type="button" aria-label={t('papers.zoomOut')} onClick={() => setZoom(value => Math.max(0.6, Math.round((value - 0.2) * 10) / 10))}><ZoomOut size={15} /></button>
      <button type="button" aria-label={t('papers.zoomIn')} onClick={() => setZoom(value => Math.min(2.5, Math.round((value + 0.2) * 10) / 10))}><ZoomIn size={15} /></button>
    </div>
    {message && <p className="paper-document-status" role="status">{message}</p>}
    <div className="paper-document-scroll" ref={scroller} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} onMouseUp={onMouseUp} />
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
