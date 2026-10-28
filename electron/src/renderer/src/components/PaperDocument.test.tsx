import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  nextPaperWidth,
  paperAnswerConsumesWheel,
  paperOutputScale,
  paperKeyTargetBlocksPaging,
  paperPageKeyAction,
  paperPageScrollTop,
  paperScrollAnchor,
  paperScrollTopForAnchor,
  paperWheelPixels,
  PaperDocument,
  tintPaperCanvas
} from './PaperDocument'

const pdf = vi.hoisted(() => {
  const renders: Array<{ background?: string; canvas: HTMLCanvasElement }> = []
  const getPage = vi.fn()
  const getDocument = vi.fn()
  class TextLayer {
    textDivs: HTMLElement[] = []
    textContentItemsStr: string[] = []
    constructor(private options: { container: HTMLElement; textContentSource: { items?: Array<{ str?: string }> } }) {}
    async render() {
      const items = this.options.textContentSource.items ?? []
      this.textContentItemsStr = items.map(item => item.str ?? '')
      this.textDivs = items.map(item => {
        const span = this.options.container.ownerDocument.createElement('span')
        span.textContent = item.str ?? ''
        this.options.container.append(span)
        return span
      })
    }
    cancel() {}
  }
  return { renders, getPage, getDocument, TextLayer }
})

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: pdf.getDocument,
  TextLayer: pdf.TextLayer
}))

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  private targets = new Set<Element>()
  constructor(private callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this)
  }
  observe(target: Element) {
    this.targets.add(target)
    const page = target instanceof HTMLElement ? target.dataset.paperPage : ''
    this.emit(target, page === '1')
  }
  unobserve(target: Element) { this.targets.delete(target) }
  disconnect() { this.targets.clear() }
  takeRecords() { return [] }
  root = null
  rootMargin = ''
  thresholds = []
  emit(target: Element, intersecting: boolean) {
    this.callback([
      { isIntersecting: intersecting, target } as IntersectionObserverEntry
    ], this as unknown as IntersectionObserver)
  }
}

describe('paper scroll layout', () => {
  let scrollWidth = 640
  let onResize: (() => void) | null = null

  beforeEach(() => {
    scrollWidth = 640
    onResize = null
    pdf.renders.length = 0
    pdf.getPage.mockReset()
    pdf.getDocument.mockReset()
    FakeIntersectionObserver.instances = []
    pdf.getPage.mockImplementation(async (pageNumber: number) => ({
      getViewport({ scale }: { scale: number }) {
        return { width: 600 * scale, height: 800 * scale, scale }
      },
      render(params: { background?: string; canvas: HTMLCanvasElement }) {
        pdf.renders.push({ background: params.background, canvas: params.canvas })
        return { promise: Promise.resolve(), cancel() {} }
      },
      async getTextContent() {
        const text = ['Alpha paragraph for the visible page.', 'Beta stays offscreen.', 'Gamma stays offscreen.'][pageNumber - 1] ?? 'Page'
        return { items: [{ str: text, transform: [12, 0, 0, 12, 48, 700], width: 180, height: 12 }] }
      }
    }))
    pdf.getDocument.mockImplementation(() => ({
      promise: Promise.resolve({
        numPages: 3,
        getPage: (pageNumber: number) => pdf.getPage(pageNumber),
        loadingTask: { destroy: async () => undefined }
      }),
      destroy: async () => undefined
    }))
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        onResize = () => callback([], this as unknown as ResizeObserver)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('paper-document-scroll') ? scrollWidth : 0
    })
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('paper-document-scroll') ? 4000 : 0
    })
  })

  afterEach(() => {
    cleanup()
    document.documentElement.removeAttribute('data-theme')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('paints the visible page and leaves the rest as boxes', async () => {
    const view = render(<PaperDocument data={new Uint8Array([1, 2, 3])} canAsk={false} />)
    await waitFor(() => {
      expect(view.container.querySelectorAll('.paper-page')).toHaveLength(3)
      expect(view.container.querySelector('[data-paper-page="1"] .textLayer')?.textContent).toContain('Alpha paragraph')
    })
    const first = view.container.querySelector<HTMLCanvasElement>('[data-paper-page="1"] canvas')
    const second = view.container.querySelector<HTMLCanvasElement>('[data-paper-page="2"] canvas')
    expect(pdf.renders.map(item => item.canvas)).toEqual([first])
    expect(second).not.toBeNull()
    expect(view.container.querySelector('[data-paper-page="2"] .textLayer')?.childElementCount).toBe(0)

    const article = view.container.querySelector('[data-paper-page="1"]')
    FakeIntersectionObserver.instances.at(-1)?.emit(article!, false)
    expect(view.container.querySelector('[data-paper-page="1"] .textLayer')?.childElementCount).toBe(0)
    expect(first?.width).toBe(0)
  })

  it('ignores a scrollbar-sized width flicker without opening the PDF again', async () => {
    const view = render(<PaperDocument data={new Uint8Array([1, 2, 3])} canAsk={false} />)
    await waitFor(() => expect(view.container.querySelectorAll('.paper-page')).toHaveLength(3))
    const article = view.container.querySelector('[data-paper-page="1"]')
    const loads = pdf.getDocument.mock.calls.length
    const pages = pdf.getPage.mock.calls.length
    scrollWidth = 641
    onResize?.()
    await new Promise(resolve => window.setTimeout(resolve, 200))
    expect(pdf.getDocument.mock.calls.length).toBe(loads)
    expect(pdf.getPage.mock.calls.length).toBe(pages)
    expect(view.container.querySelector('[data-paper-page="1"]')).toBe(article)
  })

  it('keeps the scroll fraction when the page width really changes', async () => {
    const view = render(<PaperDocument data={new Uint8Array([1, 2, 3])} canAsk={false} />)
    const scroller = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.paper-document-scroll')
      expect(element?.querySelectorAll('.paper-page')).toHaveLength(3)
      return element!
    })
    scroller.scrollTop = 1000
    const loads = pdf.getDocument.mock.calls.length
    const article = scroller.querySelector('[data-paper-page="1"]')
    scrollWidth = 800
    onResize?.()
    await waitFor(() => expect(scroller.querySelector('[data-paper-page="1"]')).not.toBe(article))
    expect(scroller.scrollTop).toBe(1000)
    expect(pdf.getDocument.mock.calls.length).toBe(loads)
  })

  it('bakes the light paper color into the canvas instead of a live blend', async () => {
    document.documentElement.setAttribute('data-theme', 'light')
    render(<PaperDocument data={new Uint8Array([1, 2, 3])} canAsk={false} />)
    await waitFor(() => expect(pdf.renders.length).toBeGreaterThan(0))
    expect(pdf.renders[0]?.background).toBe('#f4ecd8')
  })
})

describe('paper scroll math', () => {
  it('keeps the measured width when only the scrollbar gutter changes', () => {
    expect(nextPaperWidth(0, 640)).toBe(640)
    expect(nextPaperWidth(640, 641)).toBe(640)
    expect(nextPaperWidth(640, 800)).toBe(800)
    expect(nextPaperWidth(640, 0)).toBe(640)
  })

  it('caps the canvas backing store and restores a scroll fraction', () => {
    expect(paperOutputScale(1)).toBe(1)
    expect(paperOutputScale(3)).toBe(2)
    expect(paperOutputScale(Number.NaN)).toBe(1)
    expect(paperScrollAnchor(1000, 4000)).toBe(0.25)
    expect(paperScrollTopForAnchor(0.25, 4000)).toBe(1000)
    expect(paperScrollAnchor(10, 0)).toBe(0)
  })

  it('turns a line-mode wheel into pixels without stealing an open answer scroll', () => {
    expect(paperWheelPixels(2, 1, 400)).toBe(32)
    expect(paperWheelPixels(1, 2, 400)).toBe(400)
    expect(paperWheelPixels(48, 0, 400)).toBe(48)
    expect(paperAnswerConsumesWheel({ scrollTop: 0, scrollHeight: 80, clientHeight: 40 }, 4)).toBe(true)
    expect(paperAnswerConsumesWheel({ scrollTop: 40, scrollHeight: 80, clientHeight: 40 }, 4)).toBe(false)
    expect(paperAnswerConsumesWheel({ scrollTop: 0, scrollHeight: 40, clientHeight: 40 }, 4)).toBe(false)
  })

  it('turns Space, PageDown, PageUp, and Home into paper page jumps', () => {
    const key = (patch: Partial<Parameters<typeof paperPageKeyAction>[0]>) => ({
      key: '', code: '', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...patch
    })
    expect(paperPageKeyAction(key({ key: ' ', code: 'Space' }))).toBe('down')
    expect(paperPageKeyAction(key({ key: ' ', code: 'Space', shiftKey: true }))).toBe('up')
    expect(paperPageKeyAction(key({ key: 'PageDown', code: 'PageDown' }))).toBe('down')
    expect(paperPageKeyAction(key({ key: 'PageUp', code: 'PageUp' }))).toBe('up')
    expect(paperPageKeyAction(key({ key: 'Home', code: 'Home' }))).toBe('home')
    expect(paperPageKeyAction(key({ key: 'PageDown', code: 'PageDown', ctrlKey: true }))).toBeNull()
    expect(paperPageScrollTop('home', 1200, 500, 3000, [0, 900, 1800])).toBe(0)
    expect(paperPageScrollTop('down', 0, 500, 3000, [0, 900, 1800])).toBe(900)
    expect(paperPageScrollTop('down', 900, 500, 3000, [0, 900, 1800])).toBe(1800)
    expect(paperPageScrollTop('up', 1800, 500, 3000, [0, 900, 1800])).toBe(900)
    expect(paperPageScrollTop('down', 0, 400, 2000)).toBe(400)
    const input = document.createElement('input')
    expect(paperKeyTargetBlocksPaging(input)).toBe(true)
    expect(paperKeyTargetBlocksPaging(document.createElement('div'))).toBe(false)
  })

  it('darkens white canvas pixels to the paper color once', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 4
    let compositeDuringFill = ''
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: () => { compositeDuringFill = context.globalCompositeOperation },
      globalCompositeOperation: 'source-over',
      fillStyle: ''
    }
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    tintPaperCanvas(canvas, '#f4ecd8')
    expect(compositeDuringFill).toBe('darken')
    expect(context.fillStyle).toBe('#f4ecd8')
    expect(context.save).toHaveBeenCalledOnce()
    expect(context.restore).toHaveBeenCalledOnce()
  })
})
