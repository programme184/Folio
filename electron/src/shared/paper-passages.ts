import { SIDE_QUESTION_MAX_CHARS } from './side-questions'

/** A PDF text run in PDF user space. Larger `y` is higher on the page. */
export interface PaperGlyph {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export type PaperColumn = 'body' | 'left' | 'right' | 'full'

export interface PaperParagraph {
  id: string
  page: number
  column: PaperColumn
  furniture: boolean
  text: string
  glyphIndexes: number[]
}

export interface PaperPageIndex {
  page: number
  paragraphs: PaperParagraph[]
  glyphs: PaperGlyph[]
}

export interface PaperCitation {
  quote: string
  action: 'explain' | 'translate'
}

export interface PaperHit {
  page: number
  glyphIndexes: number[]
}

export type PaperMarkType = 'highlight' | 'underline'

/** Zotero's default annotation yellow, kept distinct from the ephemeral hover green. */
export const PAPER_HIGHLIGHT_COLOR = '#ffd400'
/** Earlier underline marks used this gold before the shared color list. */
export const PAPER_UNDERLINE_COLOR = '#e6a817'

/** Same eight colors as Zotero's annotation menu, yellow first. */
export const PAPER_MARK_COLORS = [
  { id: 'yellow', value: '#ffd400' },
  { id: 'red', value: '#ff6666' },
  { id: 'green', value: '#5fb236' },
  { id: 'blue', value: '#2ea8e5' },
  { id: 'purple', value: '#a28ae5' },
  { id: 'magenta', value: '#e56eee' },
  { id: 'orange', value: '#f19837' },
  { id: 'gray', value: '#aaaaaa' }
] as const

export function isPaperMarkColor(value: string): boolean {
  return value === PAPER_UNDERLINE_COLOR || PAPER_MARK_COLORS.some(item => item.value === value)
}

export interface PaperMarkRect {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export interface PaperMark {
  id: string
  type: PaperMarkType
  color: string
  hits: PaperHit[]
  text: string
  rects: PaperMarkRect[]
}

export interface LocatedPassage {
  text: string
  pages: number[]
  column: PaperColumn | 'mixed'
  before?: string
  after?: string
}

export interface ToolbarRect {
  left: number
  top: number
  width: number
  height: number
}

interface IndexedGlyph extends PaperGlyph {
  index: number
}

interface PaperLine {
  glyphs: number[]
  text: string
  x: number
  y: number
  right: number
  width: number
  height: number
}

interface TaggedLine {
  line: PaperLine
  column: PaperColumn
}

const HYPHEN_TAIL = /[-­\u00ad]$/
const MARK_ID = /^[A-Za-z0-9-]{1,80}$/
const MAX_MARKS = 400
const MAX_MARK_TEXT = 20_000
const MAX_MARK_GLYPHS = 2_000
const MAX_MARK_RECTS = 2_000

function compactHits(hits: readonly PaperHit[]): PaperHit[] {
  const byPage = new Map<number, number[]>()
  for (const hit of hits) {
    if (!Number.isInteger(hit.page) || hit.page < 1) continue
    const list = byPage.get(hit.page) ?? []
    for (const index of hit.glyphIndexes) {
      if (!Number.isInteger(index) || index < 0 || list.includes(index)) continue
      list.push(index)
    }
    if (list.length) byPage.set(hit.page, list.sort((left, right) => left - right))
  }
  return [...byPage].sort((left, right) => left[0] - right[0]).map(([page, glyphIndexes]) => ({ page, glyphIndexes }))
}

function hitKeys(hits: readonly PaperHit[]): Set<string> {
  const keys = new Set<string>()
  for (const hit of compactHits(hits)) {
    for (const index of hit.glyphIndexes) keys.add(`${hit.page}:${index}`)
  }
  return keys
}

function markOverlaps(mark: PaperMark, keys: ReadonlySet<string>): boolean {
  for (const hit of mark.hits) {
    for (const index of hit.glyphIndexes) if (keys.has(`${hit.page}:${index}`)) return true
  }
  return false
}

function quotesMatch(pages: readonly PaperPageIndex[], mark: PaperMark): boolean {
  return normalizeQuote(textForHits(pages, mark.hits)) === normalizeQuote(mark.text)
}

function sameHits(left: readonly PaperHit[], right: readonly PaperHit[]): boolean {
  const first = compactHits(left)
  const second = compactHits(right)
  if (first.length !== second.length) return false
  return first.every((hit, index) => (
    hit.page === second[index].page
    && hit.glyphIndexes.length === second[index].glyphIndexes.length
    && hit.glyphIndexes.every((glyph, glyphIndex) => glyph === second[index].glyphIndexes[glyphIndex])
  ))
}

function normalizeQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function hyphenFold(text: string): string {
  return normalizeQuote(text).replace(/[-­\u00ad]/g, '')
}

function readingOrder(page: PaperPageIndex): IndexedGlyph[] {
  const glyphs: IndexedGlyph[] = []
  page.glyphs.forEach((glyph, index) => {
    if (glyph.text.trim()) glyphs.push({ ...glyph, index })
  })
  glyphs.sort((left, right) => right.y - left.y || left.x - right.x)
  return glyphs
}

function findQuoteOnPage(page: PaperPageIndex, quote: string): number[] | null {
  const wanted = normalizeQuote(quote)
  const foldedWanted = hyphenFold(quote)
  if (!wanted) return null
  const ordered = readingOrder(page)
  for (let start = 0; start < ordered.length; start += 1) {
    const head = hyphenFold(ordered[start].text)
    if (
      head.length >= 4
      && foldedWanted.length >= 4
      && !foldedWanted.startsWith(head.slice(0, 4))
      && !head.startsWith(foldedWanted.slice(0, 4))
    ) continue
    for (let end = start; end < ordered.length; end += 1) {
      const text = normalizeQuote(textFromGlyphs(ordered.slice(start, end + 1)))
      if (text === wanted) return ordered.slice(start, end + 1).map(glyph => glyph.index).sort((left, right) => left - right)
      if (text.length > wanted.length + 24) break
    }
  }
  return null
}

function findQuoteHits(pages: readonly PaperPageIndex[], quote: string): PaperHit[] | null {
  const wanted = normalizeQuote(quote)
  if (!wanted) return null
  for (const page of pages) {
    const indexes = findQuoteOnPage(page, quote)
    if (!indexes?.length) continue
    const hits = [{ page: page.page, glyphIndexes: indexes }]
    if (normalizeQuote(textForHits(pages, hits)) === wanted) return hits
  }
  const parts = quote.split(/\n\n/).map(part => part.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const hits: PaperHit[] = []
  const used = new Set<number>()
  for (const part of parts) {
    let matched: PaperHit | null = null
    for (const page of pages) {
      if (used.has(page.page)) continue
      const indexes = findQuoteOnPage(page, part)
      if (!indexes?.length) continue
      const candidate = [{ page: page.page, glyphIndexes: indexes }]
      if (normalizeQuote(textForHits(pages, candidate)) !== normalizeQuote(part)) continue
      matched = candidate[0]
      break
    }
    if (!matched) return null
    used.add(matched.page)
    hits.push(matched)
  }
  return normalizeQuote(textForHits(pages, hits)) === wanted ? hits : null
}

function roundPdf(value: number): number {
  return Math.round(value * 1000) / 1000
}

function markPart(value: string): boolean {
  return value.length > 0 && value.length <= 300 && !/[\u0000-\u001f]/.test(value)
}

function joinMarkKey(kind: 'shelf' | 'workspace', rest: string): string | null {
  if (!rest || /[\u0000-\u001f]/.test(rest)) return null
  const key = `${kind}:${rest}`
  return isPaperMarkKey(key) ? key : null
}

function parsePaperMark(value: unknown): PaperMark | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !MARK_ID.test(record.id)) return null
  if (record.type !== 'highlight' && record.type !== 'underline') return null
  if (typeof record.color !== 'string' || !isPaperMarkColor(record.color)) return null
  const color = record.color
  if (typeof record.text !== 'string' || !record.text.trim() || record.text.length > MAX_MARK_TEXT) return null
  const hits = parseMarkHits(record.hits)
  const rects = parseMarkRects(record.rects)
  if (!hits || !rects) return null
  return { id: record.id, type: record.type, color, hits, text: record.text, rects }
}

function parseMarkHits(value: unknown): PaperHit[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 80) return null
  const raw: PaperHit[] = []
  let count = 0
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const record = item as { page?: unknown; glyphIndexes?: unknown }
    if (typeof record.page !== 'number' || !Number.isInteger(record.page) || record.page < 1 || record.page > 10000) return null
    if (!Array.isArray(record.glyphIndexes) || record.glyphIndexes.length === 0) return null
    const glyphIndexes: number[] = []
    for (const index of record.glyphIndexes) {
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 100000) return null
      glyphIndexes.push(index)
      count += 1
      if (count > MAX_MARK_GLYPHS) return null
    }
    raw.push({ page: record.page, glyphIndexes })
  }
  const hits = compactHits(raw)
  return hits.length ? hits : null
}

function parseMarkRects(value: unknown): PaperMarkRect[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MARK_RECTS) return null
  const rects: PaperMarkRect[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const record = item as Record<string, unknown>
    if (typeof record.page !== 'number' || !Number.isInteger(record.page) || record.page < 1 || record.page > 10000) return null
    if (![record.x, record.y, record.width, record.height].every(coord => typeof coord === 'number' && Number.isFinite(coord))) return null
    if ((record.width as number) < 0 || (record.height as number) < 0) return null
    rects.push({
      page: record.page,
      x: record.x as number,
      y: record.y as number,
      width: record.width as number,
      height: record.height as number
    })
  }
  return rects
}

export function glyphsFromTextContent(items: readonly unknown[]): PaperGlyph[] {
  const glyphs: PaperGlyph[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const record = item as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown }
    if (typeof record.str !== 'string' || record.str.length === 0) continue
    const transform = Array.isArray(record.transform) ? record.transform : []
    const x = typeof transform[4] === 'number' ? transform[4] : 0
    const y = typeof transform[5] === 'number' ? transform[5] : 0
    const rise = Math.hypot(
      typeof transform[2] === 'number' ? transform[2] : 0,
      typeof transform[3] === 'number' ? transform[3] : 0
    )
    const height = typeof record.height === 'number' && record.height > 0 ? record.height : rise || 1
    const width = typeof record.width === 'number' && record.width > 0 ? record.width : 0
    glyphs.push({ text: record.str, x, y, width, height })
  }
  return glyphs
}

export function indexPaperPage(page: number, glyphs: readonly PaperGlyph[]): PaperPageIndex {
  const lines = linesFromGlyphs(glyphs)
  const tagged = assignColumns(lines).sort((a, b) => b.line.y - a.line.y || a.line.x - b.line.x)
  const paragraphs: PaperParagraph[] = []
  let band: TaggedLine[] = []
  const flush = () => {
    if (!band.length) return
    const full = band.every(item => item.column === 'full')
    const body = band.every(item => item.column === 'body' || item.column === 'full')
    if (full || body) {
      const column = band.every(item => item.column === 'full') ? 'full' : 'body'
      paragraphs.push(...paragraphsFromLines(page, column, band.map(item => item.line), paragraphs.length))
    } else {
      const leftLines = band.filter(item => item.column === 'left').map(item => item.line)
      const rightLines = band.filter(item => item.column === 'right').map(item => item.line)
      paragraphs.push(...paragraphsFromLines(page, 'left', leftLines, paragraphs.length))
      paragraphs.push(...paragraphsFromLines(page, 'right', rightLines, paragraphs.length))
    }
    band = []
  }
  for (const item of tagged) {
    const itemFull = item.column === 'full'
    const bandFull = band.length > 0 && band.every(entry => entry.column === 'full')
    if (band.length && bandFull !== itemFull) flush()
    band.push(item)
  }
  flush()
  return { page, paragraphs, glyphs: glyphs.slice() }
}

/** Keep a drag inside one column without expanding it to the whole paragraph. */
export function dragSelectionHits(
  pages: readonly PaperPageIndex[],
  hits: readonly PaperHit[],
  pointer?: { page: number, index: number }
): PaperHit[] {
  const tagged: Array<{ page: number, index: number, column: PaperColumn }> = []
  for (const hit of hits) {
    const page = pages.find(item => item.page === hit.page)
    if (!page) continue
    for (const index of hit.glyphIndexes) {
      const paragraph = page.paragraphs.find(item => !item.furniture && item.glyphIndexes.includes(index))
      if (!paragraph) continue
      tagged.push({ page: hit.page, index, column: paragraph.column })
    }
  }
  if (!tagged.length) return []
  const pointerColumn = pointer
    ? tagged.find(item => item.page === pointer.page && item.index === pointer.index)?.column
    : undefined
  const column = pointerColumn ?? majorityColumn(tagged.map(item => ({ column: item.column, glyphIndexes: [item.index] } as PaperParagraph)))
  const byPage = new Map<number, number[]>()
  for (const item of tagged) {
    if (item.column !== column) continue
    const list = byPage.get(item.page) ?? []
    list.push(item.index)
    byPage.set(item.page, list)
  }
  return [...byPage].map(([page, glyphIndexes]) => ({ page, glyphIndexes }))
}

/** The text of a manual drag, in reading order, replacing the hovered paragraph. */
export function locateDragPassage(pages: readonly PaperPageIndex[], hits: readonly PaperHit[]): LocatedPassage | null {
  const scoped = hits.filter(hit => hit.glyphIndexes.length)
  if (!scoped.length) return null
  const columns = new Set<PaperColumn>()
  const parts: string[] = []
  const pageNumbers: number[] = []
  let anchor: PaperParagraph | null = null
  for (const hit of [...scoped].sort((a, b) => a.page - b.page)) {
    const page = pages.find(item => item.page === hit.page)
    if (!page) continue
    const wanted = new Set(hit.glyphIndexes)
    const glyphs: IndexedGlyph[] = []
    page.glyphs.forEach((glyph, index) => {
      if (!wanted.has(index) || !glyph.text.trim()) return
      glyphs.push({ ...glyph, index })
      const paragraph = page.paragraphs.find(item => !item.furniture && item.glyphIndexes.includes(index))
      if (paragraph) columns.add(paragraph.column)
      if (!anchor && paragraph) anchor = paragraph
    })
    const text = textFromGlyphs(glyphs)
    if (!text) continue
    parts.push(text)
    pageNumbers.push(hit.page)
  }
  const text = parts.join('\n\n').trim()
  if (!text || !anchor) return null
  const readable = [...pages].sort((a, b) => a.page - b.page).flatMap(page => page.paragraphs).filter(paragraph => !paragraph.furniture)
  const place = readable.findIndex(paragraph => paragraph.id === anchor?.id)
  return {
    text,
    pages: pageNumbers,
    column: columns.size === 1 ? [...columns][0] : 'mixed',
    before: place > 0 ? readable[place - 1].text : undefined,
    after: place >= 0 && place < readable.length - 1 ? readable[place + 1].text : undefined
  }
}

/** Keep a drag inside one column and expand every touched line to its paragraph. */
export function columnScopedHits(
  pages: readonly PaperPageIndex[],
  hits: readonly PaperHit[],
  pointer?: { page: number, index: number }
): PaperHit[] {
  const touched: PaperParagraph[] = []
  for (const page of pages) {
    const hit = hits.find(item => item.page === page.page)
    if (!hit) continue
    const wanted = new Set(hit.glyphIndexes)
    for (const paragraph of page.paragraphs) {
      if (paragraph.furniture) continue
      if (paragraph.glyphIndexes.some(index => wanted.has(index))) touched.push(paragraph)
    }
  }
  if (!touched.length) return []
  const pointerParagraph = pointer
    ? pages.find(page => page.page === pointer.page)?.paragraphs.find(paragraph => (
      !paragraph.furniture && paragraph.glyphIndexes.includes(pointer.index)
    ))
    : undefined
  const columns = new Set(touched.map(paragraph => paragraph.column))
  const column = pointerParagraph && columns.has(pointerParagraph.column)
    ? pointerParagraph.column
    : majorityColumn(touched)
  const byPage = new Map<number, number[]>()
  for (const paragraph of touched) {
    if (paragraph.column !== column) continue
    const list = byPage.get(paragraph.page) ?? []
    list.push(...paragraph.glyphIndexes)
    byPage.set(paragraph.page, list)
  }
  return [...byPage].map(([page, glyphIndexes]) => ({ page, glyphIndexes }))
}

function majorityColumn(paragraphs: readonly PaperParagraph[]): PaperColumn {
  const counts = new Map<PaperColumn, number>()
  for (const paragraph of paragraphs) counts.set(paragraph.column, (counts.get(paragraph.column) ?? 0) + paragraph.glyphIndexes.length)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'body'
}

export function locatePassages(pages: readonly PaperPageIndex[], hits: readonly PaperHit[]): LocatedPassage | null {
  const selected: PaperParagraph[] = []
  const byPage = new Map(hits.map(hit => [hit.page, new Set(hit.glyphIndexes)]))
  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    const indexes = byPage.get(page.page)
    if (!indexes) continue
    for (const paragraph of page.paragraphs) {
      if (paragraph.glyphIndexes.some(index => indexes.has(index))) {
        selected.push(paragraph)
      }
    }
  }
  if (!selected.length) return null
  const body = selected.filter(paragraph => !paragraph.furniture)
  const chosen = body.length ? body : selected
  const text = chosen.map(paragraph => paragraph.text).join('\n\n').trim()
  if (!text) return null
  const readable = [...pages]
    .sort((a, b) => a.page - b.page)
    .flatMap(page => page.paragraphs)
    .filter(paragraph => !paragraph.furniture)
  let before: string | undefined
  let after: string | undefined
  if (body.length) {
    const first = readable.findIndex(paragraph => paragraph.id === body[0].id)
    const last = readable.findIndex(paragraph => paragraph.id === body[body.length - 1].id)
    if (first > 0) before = readable[first - 1].text
    if (last >= 0 && last < readable.length - 1) after = readable[last + 1].text
  }
  const columns = new Set(chosen.map(paragraph => paragraph.column))
  return {
    text,
    pages: [...new Set(chosen.map(paragraph => paragraph.page))],
    column: columns.size === 1 ? chosen[0].column : 'mixed',
    before,
    after
  }
}

export function textForHits(pages: readonly PaperPageIndex[], hits: readonly PaperHit[]): string {
  const parts: string[] = []
  for (const hit of compactHits(hits)) {
    const page = pages.find(item => item.page === hit.page)
    if (!page) continue
    const wanted = new Set(hit.glyphIndexes)
    const glyphs: IndexedGlyph[] = []
    page.glyphs.forEach((glyph, index) => {
      if (!wanted.has(index) || !glyph.text.trim()) return
      glyphs.push({ ...glyph, index })
    })
    const text = textFromGlyphs(glyphs)
    if (text) parts.push(text)
  }
  return parts.join('\n\n').trim()
}

export function rectsFromHits(pages: readonly PaperPageIndex[], hits: readonly PaperHit[]): PaperMarkRect[] {
  const rects: PaperMarkRect[] = []
  for (const hit of compactHits(hits)) {
    const page = pages.find(item => item.page === hit.page)
    if (!page) continue
    for (const index of hit.glyphIndexes) {
      const glyph = page.glyphs[index]
      if (!glyph?.text.trim()) continue
      rects.push({
        page: hit.page,
        x: roundPdf(glyph.x),
        y: roundPdf(glyph.y),
        width: roundPdf(Math.max(0, glyph.width)),
        height: roundPdf(Math.max(0, glyph.height))
      })
    }
  }
  return rects
}

/** True when every selected glyph is already inside a mark of this type. */
export function paperMarkActive(marks: readonly PaperMark[], type: PaperMarkType, hits: readonly PaperHit[]): boolean {
  const wanted = hitKeys(hits)
  if (!wanted.size) return false
  const covered = new Set<string>()
  for (const mark of marks) {
    if (mark.type !== type) continue
    for (const key of hitKeys(mark.hits)) covered.add(key)
  }
  for (const key of wanted) if (!covered.has(key)) return false
  return true
}

/** Add a mark for the selection, or remove overlapping marks of the same type when it is already covered. */
export function togglePaperMark(
  marks: readonly PaperMark[],
  input: { type: PaperMarkType; hits: readonly PaperHit[]; pages: readonly PaperPageIndex[]; id: string; color?: string }
): PaperMark[] {
  const hits = compactHits(input.hits)
  const text = textForHits(input.pages, hits)
  if (!hits.length || !text || !MARK_ID.test(input.id)) return marks.slice()
  if (paperMarkActive(marks, input.type, hits)) {
    const wanted = hitKeys(hits)
    return marks.filter(mark => mark.type !== input.type || !markOverlaps(mark, wanted))
  }
  return [...marks, {
    id: input.id,
    type: input.type,
    color: markColor(input.type, input.color),
    hits,
    text,
    rects: rectsFromHits(input.pages, hits)
  }]
}

/** Recolor marks that overlap the selection. Returns null when nothing changes. */
export function recolorPaperMarks(marks: readonly PaperMark[], hits: readonly PaperHit[], color: string): PaperMark[] | null {
  if (!PAPER_MARK_COLORS.some(item => item.value === color)) return null
  const wanted = hitKeys(hits)
  if (!wanted.size) return null
  let changed = false
  const next = marks.map(mark => {
    if (!markOverlaps(mark, wanted) || mark.color === color) return mark
    changed = true
    return { ...mark, color }
  })
  return changed ? next : null
}

function markColor(type: PaperMarkType, color: string | undefined): string {
  if (color && isPaperMarkColor(color)) return color
  return type === 'highlight' ? PAPER_HIGHLIGHT_COLOR : PAPER_UNDERLINE_COLOR
}

/** Glyphs to paint. A stored index list that no longer reads as the quote is left unpainted. */
export function paintHitsForMark(pages: readonly PaperPageIndex[], mark: PaperMark): PaperHit[] {
  if (!mark.hits.every(hit => pages.some(page => page.page === hit.page))) return []
  return quotesMatch(pages, mark) ? mark.hits : []
}

/**
 * When a PDF extract shifts glyph indexes, retarget a mark once by searching for its quote.
 * A miss stays stored so a later open can try again, and is not painted on the wrong line.
 */
export function retargetPaperMarks(
  pages: readonly PaperPageIndex[],
  marks: readonly PaperMark[]
): { marks: PaperMark[]; changed: boolean } {
  const indexed = new Set(pages.map(page => page.page))
  let changed = false
  const next = marks.map(mark => {
    if (mark.hits.some(hit => !indexed.has(hit.page))) return mark
    if (quotesMatch(pages, mark)) return mark
    const found = findQuoteHits(pages, mark.text)
    if (!found || sameHits(found, mark.hits)) return mark
    changed = true
    return { ...mark, hits: found, rects: rectsFromHits(pages, found) }
  })
  return { marks: changed ? next : marks.slice(), changed }
}

export function paperShelfMarkKey(relativePath: string): string | null {
  return joinMarkKey('shelf', relativePath)
}

export function paperWorkspaceMarkKey(profileId: string, sessionId: string, source: string): string | null {
  if (!markPart(profileId) || !markPart(sessionId) || !markPart(source)) return null
  return joinMarkKey('workspace', `${profileId}:${sessionId}:${source}`)
}

export function isPaperMarkKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 6
    && value.length <= 1024
    && !/[\u0000-\u001f]/.test(value)
    && (/^shelf:.+/.test(value) || /^workspace:.+/.test(value))
}

export function parsePaperMarks(value: unknown): PaperMark[] | null {
  if (!Array.isArray(value) || value.length > MAX_MARKS) return null
  const marks: PaperMark[] = []
  const ids = new Set<string>()
  for (const item of value) {
    const mark = parsePaperMark(item)
    if (!mark || ids.has(mark.id)) return null
    ids.add(mark.id)
    marks.push(mark)
  }
  return marks
}

export function paperToolbarPosition(
  rects: readonly ToolbarRect[],
  frame: ToolbarRect,
  toolbarHeight = 44
): { left: number; top: number; placement: 'above' | 'below' } {
  const first = rects[0]
  const last = rects[rects.length - 1] ?? first
  if (!first || !last) return { left: frame.left + 16, top: frame.top + 16, placement: 'below' }
  const center = last.left + last.width / 2
  const belowTop = last.top + last.height
  const spaceBelow = frame.top + frame.height - belowTop
  const placement = spaceBelow < toolbarHeight + 8 ? 'above' : 'below'
  const top = placement === 'below' ? belowTop + 6 : first.top - 6
  const left = Math.min(Math.max(center, frame.left + 24), frame.left + Math.max(24, frame.width - 24))
  return { left, top, placement }
}

const PREVIEW_LINE_CHARS = 48

/** Two lines of a selection, the way a citation chip shows it. */
export function paperQuotePreview(text: string, lines = 2): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const limit = Math.max(1, lines) * PREVIEW_LINE_CHARS
  const chars = Array.from(flat)
  if (chars.length <= limit) return flat
  return `${chars.slice(0, limit - 1).join('').trimEnd()}…`
}

export function paperAskDraft(passage: LocatedPassage, limit = SIDE_QUESTION_MAX_CHARS): string {
  return clip(paperQuotePreview(passage.text), limit)
}

export function paperPassageQuestion(input: {
  kind: 'explain' | 'translate'
  answerLanguage: 'zh-CN' | 'en'
  translateTo?: 'zh-CN' | 'en'
  passage: LocatedPassage
  limit?: number
}): string {
  const limit = input.limit ?? SIDE_QUESTION_MAX_CHARS
  const instruction = input.kind === 'translate'
    ? `Translate the passage below into ${input.translateTo === 'zh-CN' ? 'Simplified Chinese' : 'English'}. Use only this passage and its short context. Do not add commentary.`
    : input.answerLanguage === 'zh-CN'
      ? '只根据下面的论文选段和紧邻上下文解释。不要使用其他对话或文件。用中文回答。如果选段里有公式，先用 LaTeX 写出完整公式，再逐项解释。不要讨论 PDF 换行或文字提取。'
      : 'Explain the passage below from a paper. Use only this passage and its short context. Do not use other conversations or files. Answer in English. If the passage contains a formula, write the formula in LaTeX first, then explain each symbol. Do not discuss PDF line breaks or text extraction.'
  const header = `Page ${input.passage.pages.join(', ')}. ${columnPhrase(input.passage.column)}.`
  const fixed = `${instruction}\n\n${header}\nPassage:\n`
  let question = `${fixed}${clip(input.passage.text.trim(), Math.max(0, limit - codePoints(fixed)))}`
  question = appendContext(question, 'Preceding context', input.passage.before, limit)
  question = appendContext(question, 'Following context', input.passage.after, limit)
  return clip(stripLoneSurrogates(question), limit)
}

/** The quote a paper prompt should show, without the model instructions or neighboring context. */
export function paperCitation(text: string): PaperCitation | null {
  const trimmed = text.trim()
  if (!/^(?:只根据下面的论文选段|Explain the passage below from a paper|Translate the passage below into )/.test(trimmed)) return null
  const match = trimmed.match(/\nPassage:\n([\s\S]*?)(?:\n\n(?:Preceding context|Following context):|$)/)
  const quote = match?.[1]?.trim()
  if (!quote) return null
  return { quote, action: trimmed.startsWith('Translate the passage below into ') ? 'translate' : 'explain' }
}

function linesFromGlyphs(glyphs: readonly PaperGlyph[]): PaperLine[] {
  const visible: IndexedGlyph[] = []
  glyphs.forEach((glyph, index) => {
    if (glyph.text.trim()) visible.push({ ...glyph, index })
  })
  visible.sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: IndexedGlyph[][] = []
  for (const glyph of visible) {
    const row = rows[rows.length - 1]
    if (!row || !sameVisualLine(row, glyph)) rows.push([glyph])
    else row.push(glyph)
  }
  const gutters = columnGutters(rows)
  return rows.flatMap(row => splitRow(row, gutters))
}

function sameVisualLine(row: IndexedGlyph[], glyph: IndexedGlyph): boolean {
  const body = row.reduce((best, item) => item.height > best.height ? item : best, row[0])
  const height = Math.max(body.height, glyph.height, 1)
  // Equal-height glyphs must not move the baseline downward, or each line's
  // superscript pulls the next line into the same row.
  return Math.abs(body.y - glyph.y) <= height * 0.9
}

function splitRow(row: IndexedGlyph[], gutters: readonly Gutter[]): PaperLine[] {
  const sorted = [...row].sort((a, b) => a.x - b.x || b.y - a.y)
  const height = median(sorted.map(glyph => glyph.height)) || 1
  const threshold = Math.max(height * 2.5, 16)
  const groups: IndexedGlyph[][] = []
  for (const glyph of sorted) {
    const current = groups[groups.length - 1]
    const previous = current?.[current.length - 1]
    const gap = previous ? glyph.x - (previous.x + previous.width) : 0
    if (!current || (previous && (gap > threshold || gapCrossesGutter(previous, glyph, gutters)))) groups.push([glyph])
    else current.push(glyph)
  }
  return groups.map(lineFromGlyphs)
}

interface Gutter {
  start: number
  end: number
}

/** Vertical gaps that stay empty across a two-column page, including a gutter of about one em. */
function columnGutters(rows: readonly IndexedGlyph[][]): Gutter[] {
  const glyphs = rows.flat()
  if (glyphs.length < 8 || rows.length < 4) return []
  const left = Math.min(...glyphs.map(glyph => glyph.x))
  const right = Math.max(...glyphs.map(glyph => glyph.x + glyph.width))
  const width = right - left
  const height = median(glyphs.map(glyph => glyph.height)) || 1
  if (width < height * 25) return []
  const regionLeft = left + width * 0.28
  const regionRight = left + width * 0.72
  const bins = 48
  const binWidth = (regionRight - regionLeft) / bins
  const covered = new Array<number>(bins).fill(0)
  let usedRows = 0
  for (const row of rows) {
    const rowLeft = Math.min(...row.map(glyph => glyph.x))
    const rowRight = Math.max(...row.map(glyph => glyph.x + glyph.width))
    if (rowRight - rowLeft < width * 0.62) continue
    usedRows += 1
    const seen = new Set<number>()
    for (const glyph of row) {
      const start = Math.max(regionLeft, glyph.x)
      const end = Math.min(regionRight, glyph.x + glyph.width)
      if (end <= start) continue
      const first = Math.max(0, Math.floor((start - regionLeft) / binWidth))
      const last = Math.min(bins, Math.ceil((end - regionLeft) / binWidth))
      for (let index = first; index < last; index += 1) seen.add(index)
    }
    for (const index of seen) covered[index] += 1
  }
  if (usedRows < 4) return []
  const limit = usedRows * 0.2
  const minimum = Math.max(height * 0.45, 6)
  const gutters: Gutter[] = []
  let runStart = -1
  for (let index = 0; index <= bins; index += 1) {
    const empty = index < bins && covered[index] <= limit
    if (empty && runStart < 0) runStart = index
    if (!empty && runStart >= 0) {
      const start = regionLeft + runStart * binWidth
      const end = regionLeft + index * binWidth
      if (end - start >= minimum) gutters.push({ start, end })
      runStart = -1
    }
  }
  return gutters
}

function gapCrossesGutter(previous: IndexedGlyph, glyph: IndexedGlyph, gutters: readonly Gutter[]): boolean {
  const gapStart = previous.x + previous.width
  const gapEnd = glyph.x
  if (gapEnd <= gapStart) return false
  return gutters.some(gutter => Math.min(gapEnd, gutter.end) - Math.max(gapStart, gutter.start) > 0)
}

function textFromGlyphs(glyphs: readonly IndexedGlyph[]): string {
  const sorted = [...glyphs].sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: IndexedGlyph[][] = []
  for (const glyph of sorted) {
    const row = rows[rows.length - 1]
    if (!row || !sameVisualLine(row, glyph)) rows.push([glyph])
    else row.push(glyph)
  }
  return joinLines(rows.map(row => lineFromGlyphs(row).text))
}

function lineFromGlyphs(glyphs: IndexedGlyph[]): PaperLine {
  const sorted = [...glyphs].sort((a, b) => a.x - b.x || b.y - a.y)
  let text = ''
  let previous: IndexedGlyph | null = null
  for (const glyph of sorted) {
    if (!previous) text = glyph.text
    else {
      const gap = glyph.x - (previous.x + previous.width)
      const hyphen = HYPHEN_TAIL.test(text) && /^[a-z]/.test(glyph.text)
      const boundary = /\s$/.test(text) || /^\s/.test(glyph.text)
      if (hyphen) text = text.replace(HYPHEN_TAIL, '') + glyph.text
      else if (gap > Math.max(previous.height, glyph.height) * 0.17 && !boundary) text += ` ${glyph.text}`
      else text += glyph.text
    }
    previous = glyph
  }
  const x = Math.min(...sorted.map(glyph => glyph.x))
  const right = Math.max(...sorted.map(glyph => glyph.x + glyph.width))
  const y = Math.max(...sorted.map(glyph => glyph.y))
  const lineHeight = median(sorted.map(glyph => glyph.height)) || 1
  return {
    glyphs: sorted.map(glyph => glyph.index),
    text: text.replace(/[ \t]{2,}/g, ' ').trim(),
    x,
    y,
    right,
    width: Math.max(0, right - x),
    height: lineHeight
  }
}

function assignColumns(lines: PaperLine[]): TaggedLine[] {
  if (!lines.length) return []
  const gutter = textColumnGutter(lines) ?? clusteredGutter(lines)
  if (!gutter) return lines.map(line => ({ line, column: 'body' }))
  return lines.map(line => {
    if (line.x <= gutter.start + 2 && line.right >= gutter.end - 2) return { line, column: 'full' }
    if (line.x >= gutter.end - 1) return { line, column: 'right' }
    if (line.right <= gutter.start + 1) return { line, column: 'left' }
    const center = line.x + line.width / 2
    return { line, column: center >= (gutter.start + gutter.end) / 2 ? 'right' : 'left' }
  })
}

/** The empty vertical band between two text columns, ignoring equation numbers parked at the outer margin. */
function textColumnGutter(lines: readonly PaperLine[]): Gutter | null {
  if (lines.length < 8) return null
  const left = Math.min(...lines.map(line => line.x))
  const right = Math.max(...lines.map(line => line.right))
  const width = right - left
  const height = median(lines.map(line => line.height)) || 1
  if (width < height * 25) return null
  const regionLeft = left + width * 0.2
  const regionRight = left + width * 0.8
  const bins = 64
  const binWidth = (regionRight - regionLeft) / bins
  const covered = new Array<number>(bins).fill(0)
  let used = 0
  for (const line of lines) {
    if (line.width < Math.max(width * 0.18, height * 8)) continue
    used += 1
    const start = Math.max(regionLeft, line.x)
    const end = Math.min(regionRight, line.right)
    if (end <= start) continue
    const first = Math.max(0, Math.floor((start - regionLeft) / binWidth))
    const last = Math.min(bins, Math.ceil((end - regionLeft) / binWidth))
    for (let index = first; index < last; index += 1) covered[index] += 1
  }
  if (used < 8) return null
  const limit = Math.max(2, used * 0.1)
  const minimum = Math.max(height * 0.35, 4)
  let best: Gutter | null = null
  let bestWidth = 0
  let runStart = -1
  for (let index = 0; index <= bins; index += 1) {
    const empty = index < bins && covered[index] <= limit
    if (empty && runStart < 0) runStart = index
    if (!empty && runStart >= 0) {
      const start = regionLeft + runStart * binWidth
      const end = regionLeft + index * binWidth
      const before = covered.slice(0, runStart)
      const after = covered.slice(index)
      const leftPeak = before.length ? Math.max(...before) : 0
      const rightPeak = after.length ? Math.max(...after) : 0
      const leftSupport = runStart > 0 ? covered[runStart - 1] : 0
      const rightSupport = index < bins ? covered[index] : 0
      const supported = leftPeak >= used * 0.2 && rightPeak >= used * 0.2
        && leftSupport >= leftPeak * 0.3 && rightSupport >= rightPeak * 0.3
      if (end - start >= minimum && end - start > bestWidth && supported) {
        best = { start, end }
        bestWidth = end - start
      }
      runStart = -1
    }
  }
  return best
}

function clusteredGutter(lines: readonly PaperLine[]): Gutter | null {
  const height = median(lines.map(line => line.height)) || 1
  const starts = lines.map(line => line.x).sort((a, b) => a - b)
  const clusters: number[][] = []
  for (const start of starts) {
    const cluster = clusters[clusters.length - 1]
    if (!cluster || start - cluster[cluster.length - 1] > height * 2) clusters.push([start])
    else cluster.push(start)
  }
  if (clusters.length < 2) return null
  let splitAt = 1
  let splitGap = -1
  for (let index = 1; index < clusters.length; index += 1) {
    const gap = clusters[index][0] - clusters[index - 1][clusters[index - 1].length - 1]
    if (gap > splitGap) {
      splitGap = gap
      splitAt = index
    }
  }
  if (splitGap < Math.max(height * 4, 20)) return null
  return {
    start: clusters[splitAt - 1][clusters[splitAt - 1].length - 1],
    end: clusters[splitAt][0]
  }
}

function paragraphsFromLines(page: number, column: PaperColumn, lines: PaperLine[], start: number): PaperParagraph[] {
  const ordered = [...lines].sort((a, b) => b.y - a.y || a.x - b.x).filter(line => line.text)
  if (!ordered.length) return []
  const height = median(ordered.map(line => line.height)) || 1
  const columnLeft = Math.min(...ordered.map(line => line.x))
  const columnRight = Math.max(...ordered.map(line => line.right))
  const gaps: number[] = []
  for (let index = 1; index < ordered.length; index += 1) gaps.push(ordered[index - 1].y - ordered[index].y)
  const normalGaps = gaps.filter(gap => gap > 0 && gap < height * 3)
  const medianGap = median(normalGaps.length ? normalGaps : gaps.filter(gap => gap > 0)) || height * 1.2
  const reach = ordered.filter(line => line.right >= columnRight - Math.max(line.height, 4)).length
  const justified = reach >= Math.max(1, Math.ceil(ordered.length * 0.45))
  const groups: PaperLine[][] = []
  for (const line of ordered) {
    const previous = groups[groups.length - 1]?.at(-1)
    if (!previous || paragraphBreak(previous, line, { columnLeft, columnRight, height, medianGap, justified })) {
      groups.push([line])
    } else groups[groups.length - 1].push(line)
  }
  return groups.map((group, index) => {
    const text = joinLines(group.map(line => line.text))
    return {
      id: `${page}:${start + index}`,
      page,
      column,
      furniture: /^\d{1,4}$/.test(text),
      text,
      glyphIndexes: group.flatMap(line => line.glyphs)
    }
  })
}

function paragraphBreak(
  previous: PaperLine,
  line: PaperLine,
  metrics: { columnLeft: number; columnRight: number; height: number; medianGap: number; justified: boolean }
): boolean {
  if (isPageNumber(previous.text) || isPageNumber(line.text)) return true
  const gap = previous.y - line.y
  const fontChange = Math.abs(line.height - previous.height) / Math.max(previous.height, 1) > 0.2
  const largeGap = gap > metrics.medianGap * 1.45 && gap > metrics.height * 1.45
  const continues = HYPHEN_TAIL.test(previous.text)
  const previousShort = previous.right < metrics.columnRight - Math.max(previous.height, 4)
  const indented = line.x > metrics.columnLeft + line.height * 0.9
  const shortBreak = metrics.justified && previousShort && !continues
  const indentBreak = indented && previousShort && !continues
  return fontChange || largeGap || shortBreak || indentBreak
}

function joinLines(lines: string[]): string {
  let text = ''
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (!text) {
      text = line
      continue
    }
    if (HYPHEN_TAIL.test(text) && /^[a-z]/.test(line)) text = text.replace(HYPHEN_TAIL, '') + line
    else text = `${text} ${line}`
  }
  return text.replace(/[ \t]{2,}/g, ' ').trim()
}

function isPageNumber(text: string): boolean {
  return /^\d{1,4}$/.test(text.trim())
}

function columnPhrase(column: LocatedPassage['column']): string {
  if (column === 'left') return 'left column'
  if (column === 'right') return 'right column'
  if (column === 'full') return 'full width'
  if (column === 'body') return 'body column'
  return 'selected columns'
}

function appendContext(question: string, label: string, context: string | undefined, limit: number): string {
  const value = context?.trim()
  if (!value) return question
  const addition = `\n\n${label}:\n${value}`
  if (codePoints(question) + codePoints(addition) > limit) return question
  return question + addition
}

function clip(text: string, limit: number): string {
  const chars = Array.from(text)
  if (chars.length <= limit) return text
  if (limit <= 1) return chars.slice(0, limit).join('')
  return `${chars.slice(0, limit - 1).join('')}…`
}

function codePoints(text: string): number {
  return Array.from(text).length
}

function stripLoneSurrogates(text: string): string {
  return Array.from(text).filter(character => {
    const code = character.codePointAt(0) ?? 0
    return code < 0xd800 || code > 0xdfff
  }).join('')
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
