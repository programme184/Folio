import { useCallback, useEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { t } from '@shared/i18n'
import { glyphsFromTextContent, indexPaperPage, type PaperPageIndex } from '@shared/paper-passages'
import { useLocale } from '../lib/i18n'
import { PaperToolbar, usePaperSelection, type PaperAsk } from './PaperSelection'

GlobalWorkerOptions.workerSrc = workerUrl

const MAX_PAGES = 80

export function PaperDocument({ data, canAsk, askPassage, onAsk }: {
  data: Uint8Array
  canAsk: boolean
  askPassage?: PaperAsk
  onAsk?: (draft: string) => void
}) {
  useLocale()
  const scroller = useRef<HTMLDivElement>(null)
  const indexes = useRef<PaperPageIndex[]>([])
  const getPages = useCallback(() => indexes.current, [])
  const { selection, onMouseDown, onMouseMove, onMouseLeave, onMouseUp, holdToolbar, releaseToolbar } = usePaperSelection(scroller, getPages)
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [message, setMessage] = useState(t('papers.loading'))
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    let timer = 0
    const measure = () => setWidth(element.clientWidth)
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(measure, 150)
    })
    observer.observe(element)
    measure()
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [])
  useEffect(() => {
    const element = scroller.current
    if (!element || width < 40) return
    const controller = new AbortController()
    let cancelled = false
    indexes.current = []
    setMessage(t('papers.loading'))
    void renderPaper(element, data, width, zoom, controller.signal, indexes).then(result => {
      if (cancelled) return
      if (!result.selectable) setMessage(t('papers.noText'))
      else if (result.truncated) setMessage(t('papers.truncated', { count: MAX_PAGES }))
      else setMessage('')
    }).catch(error => {
      if (cancelled || controller.signal.aborted || isCancelled(error)) return
      setMessage(t('papers.loadFailed'))
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [data, width, zoom])
  return <div className="paper-document">
    <div className="paper-document-tools">
      <button type="button" aria-label={t('papers.zoomOut')} onClick={() => setZoom(value => Math.max(0.6, Math.round((value - 0.2) * 10) / 10))}><ZoomOut size={15} /></button>
      <button type="button" aria-label={t('papers.zoomIn')} onClick={() => setZoom(value => Math.min(2.5, Math.round((value + 0.2) * 10) / 10))}><ZoomIn size={15} /></button>
    </div>
    {message && <p className="paper-document-status" role="status">{message}</p>}
    <div className="paper-document-scroll" ref={scroller} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} onMouseUp={onMouseUp} />
    {selection && <PaperToolbar selection={selection} canAsk={canAsk} askPassage={askPassage} onAsk={onAsk} onHold={holdToolbar} onRelease={releaseToolbar} />}
  </div>
}

async function renderPaper(
  root: HTMLElement,
  data: Uint8Array,
  width: number,
  zoom: number,
  signal: AbortSignal,
  indexes: { current: PaperPageIndex[] }
): Promise<{ selectable: boolean; truncated: boolean }> {
  root.replaceChildren()
  const task = getDocument({ data: data.slice(), disableRange: true, disableStream: true })
  const cancel = () => { void task.destroy().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  const pdf = await task.promise
  const built: PaperPageIndex[] = []
  try {
    const count = Math.min(pdf.numPages, MAX_PAGES)
    for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
      if (signal.aborted) break
      const page = await pdf.getPage(pageNumber)
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
      const outputScale = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const textLayer = document.createElement('div')
      textLayer.className = 'textLayer'
      article.append(canvas, textLayer)
      root.append(article)
      const renderTask = page.render({
        canvas,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
      })
      signal.addEventListener('abort', () => renderTask.cancel(), { once: true })
      const textContent = await page.getTextContent()
      const glyphs = glyphsFromTextContent(textContent.items)
      const layer = new TextLayer({ textContentSource: textContent, container: textLayer, viewport })
      signal.addEventListener('abort', () => layer.cancel(), { once: true })
      await Promise.all([
        renderTask.promise.catch(error => { if (!signal.aborted && !isCancelled(error)) throw error }),
        layer.render().catch(error => { if (!signal.aborted && !isCancelled(error)) throw error })
      ])
      tagTextDivs(layer.textDivs, layer.textContentItemsStr, pageNumber)
      built.push(indexPaperPage(pageNumber, glyphs))
      indexes.current = built
    }
    return { selectable: built.some(page => page.paragraphs.some(paragraph => !paragraph.furniture)), truncated: pdf.numPages > MAX_PAGES }
  } finally {
    signal.removeEventListener('abort', cancel)
    await task.destroy().catch(() => undefined)
  }
}

function tagTextDivs(divs: HTMLElement[], strings: string[], pageNumber: number): void {
  let glyphIndex = 0
  for (let index = 0; index < divs.length; index += 1) {
    const value = strings[index] ?? ''
    if (!value) continue
    divs[index].dataset.paperItem = String(glyphIndex)
    divs[index].dataset.paperPage = String(pageNumber)
    glyphIndex += 1
  }
}

function isCancelled(error: unknown): boolean {
  const name = error instanceof Error ? error.name : ''
  return name === 'AbortException' || name === 'RenderingCancelledException'
}
