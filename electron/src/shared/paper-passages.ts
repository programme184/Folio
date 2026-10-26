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
