import { describe, expect, it } from 'vitest'
import {
  columnScopedHits,
  glyphsFromTextContent,
  indexPaperPage,
  locatePassages,
  paperCitation,
  paperAskDraft,
  paperQuotePreview,
  paperPassageQuestion,
  paperToolbarPosition,
  type PaperGlyph
} from './paper-passages'

const glyph = (text: string, x: number, y: number, width: number, height = 10): PaperGlyph => ({ text, x, y, width, height })

describe('paper passage index', () => {
  it('joins a line-break hyphen into one paragraph', () => {
    const page = indexPaperPage(1, [
      glyph('Their rich kinematic structure en-', 50, 700, 200),
      glyph('ables robots to reproduce.', 50, 686, 170)
    ])
    expect(page.paragraphs.map(paragraph => paragraph.text)).toEqual([
      'Their rich kinematic structure enables robots to reproduce.'
    ])
  })

  it('keeps a narrow gutter from joining the facing column', () => {
    const line = (text: string, x: number, y: number) => glyph(text, x, y, 210, 10)
    const page = indexPaperPage(1, [
      line('Our key insight is to express this guidance.', 50, 700),
      line('target hardware collects demonstrations.', 274, 700),
      line('The resulting residual actions adjust.', 50, 686),
      line('Retargeting bridges different morphologies.', 274, 686),
      line('We introduce FoLD for dexterous work.', 50, 672),
      line('For offline demonstrations we train.', 274, 672),
      line('A force-informed learning framework.', 50, 658),
      line('Matching motion alone does not ensure.', 274, 658)
    ])
    const insight = page.paragraphs.find(paragraph => paragraph.text.includes('key insight'))
    const target = page.paragraphs.find(paragraph => paragraph.text.includes('target hardware'))
    expect(insight?.column).toBe('left')
    expect(insight?.text).toContain('residual actions')
    expect(insight?.text).not.toContain('target hardware')
    expect(target?.column).toBe('right')
    expect(target?.text).toContain('Retargeting')
    expect(target?.text).not.toContain('key insight')
    expect(insight?.id).not.toBe(target?.id)
  })

  it('splits a real two-column line whose right side is separate words', () => {
    const height = 10
    const rows = [700, 686, 672, 658, 644, 630].flatMap(y => [
      glyph('Our key insight is to express this guidance.', 54, y, 245, height),
      glyph('target', 314, y, 42, height),
      glyph('hardware', 362, y, 62, height),
      glyph('collects', 430, y, 52, height),
      glyph('demonstrations.', 488, y, 90, height)
    ])
    const page = indexPaperPage(4, rows)
    const insight = page.paragraphs.find(paragraph => paragraph.text.includes('key insight'))
    expect(insight?.column).toBe('left')
    expect(insight?.text).not.toContain('hardware')
    expect(page.paragraphs.filter(paragraph => paragraph.column === 'right').every(paragraph => !paragraph.text.includes('key insight'))).toBe(true)
  })

  it('keeps a paragraph in one column when equation numbers sit past the gutter', () => {
    const rows = []
    for (let index = 0; index < 8; index += 1) {
      const y = 700 - index * 12
      const left = index === 4 ? 'as at where the environment state continues.' : `Left sentence ${index} keeps going across the column.`
      rows.push(glyph(left, 54, y, 245, 10))
      rows.push(glyph(index === 0 ? 'E. Section heading' : `Right sentence ${index} keeps going across.`, 313, y, index === 0 ? 142 : 200, 10))
      rows.push(glyph(`(${index + 1})`, 530, y, 22, 8))
    }
    const page = indexPaperPage(6, rows)
    const environment = page.paragraphs.find(paragraph => paragraph.text.includes('environment'))
    const heading = page.paragraphs.find(paragraph => paragraph.text.includes('Section heading'))
    expect(environment?.column).toBe('left')
    expect(environment?.text).toContain('Left sentence 3')
    expect(environment?.text).toContain('Left sentence 5')
    expect(environment?.text).not.toContain('Section heading')
    expect(environment?.text).not.toContain('Right sentence')
    expect(heading?.column).toBe('right')
    expect(heading?.text).not.toContain('Left sentence')
    expect(heading?.text).not.toContain('(1)')
    const environmentHit = environment?.glyphIndexes[2] ?? 0
    const headingHit = heading?.glyphIndexes[0] ?? 0
    const scoped = columnScopedHits([page], [{
      page: 6,
      glyphIndexes: [environmentHit, headingHit]
    }], { page: 6, index: environmentHit })
    const located = locatePassages([page], scoped)
    expect(located?.column).toBe('left')
    expect(located?.text).toContain('environment')
    expect(located?.text).not.toContain('Section heading')
  })

  it('keeps a wide space inside a one-column paragraph', () => {
    const page = indexPaperPage(1, [
      glyph('Alpha beta', 50, 700, 80, 10),
      glyph('gamma delta epsilon zeta.', 146, 700, 160, 10),
      glyph('The sentence continues across the line.', 50, 686, 250, 10),
      glyph('Another full line of the same paragraph.', 50, 672, 250, 10),
      glyph('And one more line stays with them.', 50, 658, 220, 10)
    ])
    expect(page.paragraphs).toHaveLength(1)
    expect(page.paragraphs[0].column).toBe('body')
    expect(page.paragraphs[0].text).toContain('Alpha beta gamma')
  })

  it('keeps a two-column selection inside the selected column', () => {
    const glyphs = [
      glyph('Paper Title', 40, 760, 460),
      glyph('Left column sentence.', 40, 700, 180),
      glyph('Left stays here.', 40, 686, 120),
      glyph('Right column sentence.', 320, 700, 180),
      glyph('Right stays here.', 320, 686, 120),
      glyph('12', 250, 20, 16, 8)
    ]
    const page = indexPaperPage(2, glyphs)
    const right = page.paragraphs.find(paragraph => paragraph.text.includes('Right column'))
    expect(right?.column).toBe('right')
    expect(right?.furniture).toBe(false)
    expect(page.paragraphs.find(paragraph => paragraph.text === '12')?.furniture).toBe(true)
    const located = locatePassages([page], [{ page: 2, glyphIndexes: right?.glyphIndexes ?? [] }])
    expect(located?.text).toBe('Right column sentence. Right stays here.')
    expect(located?.text).not.toContain('Left')
    expect(located?.text).not.toContain('12')
    expect(located?.column).toBe('right')
    expect(located?.pages).toEqual([2])
    expect(located?.before).toContain('Left column')
  })

  it('concatenates only the paragraphs the selection covers', () => {
    const glyphs = [
      glyph('Alpha beta gamma delta.', 50, 700, 200),
      glyph('The sentence continues across.', 50, 686, 200),
      glyph('End one.', 50, 672, 90),
      glyph('Second paragraph starts.', 50, 658, 200),
      glyph('End two.', 50, 644, 80),
      glyph('Third paragraph starts.', 50, 630, 200),
      glyph('End three.', 50, 616, 70)
    ]
    const page = indexPaperPage(1, glyphs)
    expect(page.paragraphs.map(paragraph => paragraph.text)).toEqual([
      'Alpha beta gamma delta. The sentence continues across. End one.',
      'Second paragraph starts. End two.',
      'Third paragraph starts. End three.'
    ])
    const located = locatePassages([page], [{
      page: 1,
      glyphIndexes: [...page.paragraphs[0].glyphIndexes, ...page.paragraphs[1].glyphIndexes]
    }])
    expect(located?.text).toBe([
      'Alpha beta gamma delta. The sentence continues across. End one.',
      'Second paragraph starts. End two.'
    ].join('\n\n'))
    expect(located?.text).not.toContain('Third')
    expect(located?.after).toContain('Third paragraph')
    expect(located?.before).toBeUndefined()
  })

  it('keeps similarly short lines in one paragraph', () => {
    const page = indexPaperPage(1, [
      glyph('one two', 50, 700, 100),
      glyph('three four', 50, 686, 102),
      glyph('five six', 50, 672, 98),
      glyph('seven eight', 50, 658, 101)
    ])
    expect(page.paragraphs).toHaveLength(1)
  })

  it('keeps a formula and its scripts on one reading line', () => {
    const page = indexPaperPage(3, [
      glyph('as', 40, 520, 16, 11),
      glyph('τ', 48, 500, 10, 12),
      glyph('ref', 58, 496, 16, 7),
      glyph('={ (', 76, 500, 22, 12),
      glyph('h', 100, 500, 8, 12),
      glyph('∗', 108, 507, 6, 7),
      glyph('j', 109, 494, 5, 7),
      glyph(',q', 118, 500, 12, 12),
      glyph('∗', 132, 507, 6, 7),
      glyph('j', 133, 494, 5, 7),
      glyph(') }', 142, 500, 14, 12),
      glyph('T−1', 164, 508, 18, 8),
      glyph('j=0', 160, 493, 18, 7),
      glyph('We then (1)', 40, 478, 80, 11)
    ])
    const formula = page.paragraphs.find(paragraph => paragraph.text.includes('τ'))
    expect(formula?.text).toBe('τref={ (h∗j ,q∗j ) } j=0T−1')
    expect(formula?.text).not.toContain('We then')
    expect(formula?.text).not.toContain('as')
    const located = locatePassages([page], [{ page: 3, glyphIndexes: formula?.glyphIndexes.slice(0, 4) ?? [] }])
    expect(located?.text.startsWith('τ')).toBe(true)
    expect(located?.text).not.toContain('We then')
    expect(located?.after).toContain('We then')
  })

  it('reads PDF text items into glyphs', () => {
    expect(glyphsFromTextContent([
      { str: 'Hands', transform: [12, 0, 0, 12, 40, 700], width: 40, height: 12 },
      { str: '', transform: [1, 0, 0, 1, 0, 0], width: 0, height: 0 },
      { marked: true }
    ])).toEqual([{ text: 'Hands', x: 40, y: 700, width: 40, height: 12 }])
  })

  it('places the toolbar above a selection that is near the bottom', () => {
    const frame = { left: 0, top: 0, width: 800, height: 400 }
    expect(paperToolbarPosition([{ left: 100, top: 360, width: 200, height: 30 }], frame).placement).toBe('above')
    expect(paperToolbarPosition([{ left: 100, top: 40, width: 200, height: 20 }], frame)).toMatchObject({
      placement: 'below',
      top: 66
    })
  })

  it('asks only about the located passage and stays within the character limit', () => {
    const page = indexPaperPage(1, [
      glyph('Their rich kinematic structure en-', 50, 700, 200),
      glyph('ables robots to reproduce.', 50, 686, 170),
      glyph('A later paragraph.', 50, 640, 140)
    ])
    const located = locatePassages([page], [{ page: 1, glyphIndexes: page.paragraphs[0].glyphIndexes }])
    const question = paperPassageQuestion({ kind: 'explain', answerLanguage: 'en', passage: located! })
    expect(question).toContain('Use only this passage')
    expect(question).toContain('enables robots')
    expect(question).not.toContain('en-')
    const chinese = paperPassageQuestion({ kind: 'explain', answerLanguage: 'zh-CN', passage: located! })
    expect(chinese).toContain('只根据')
    expect(chinese).toContain('用中文回答')
    const clipped = paperPassageQuestion({
      kind: 'translate',
      answerLanguage: 'en',
      translateTo: 'zh-CN',
      passage: { ...located!, text: 'word '.repeat(500) },
      limit: 180
    })
    expect(Array.from(clipped).length).toBeLessThanOrEqual(180)
    expect(clipped).toContain('Use only this passage')
  })

  it('shows a paper prompt as the selected quote, not the neighboring context', () => {
    const page = indexPaperPage(1, [
      glyph('τ', 48, 500, 10, 12),
      glyph('ref', 58, 496, 16, 7),
      glyph('Later sentence.', 40, 470, 90, 11)
    ])
    const formula = page.paragraphs.find(paragraph => paragraph.text.includes('τ'))
    const located = locatePassages([page], [{ page: 1, glyphIndexes: formula?.glyphIndexes ?? [] }])
    const question = paperPassageQuestion({ kind: 'explain', answerLanguage: 'zh-CN', passage: located! })
    expect(paperCitation(question)).toEqual({ quote: located?.text, action: 'explain' })
    expect(paperCitation(question)?.quote).not.toContain('Later sentence')
    expect(paperCitation('hello')).toBeNull()
    expect(paperAskDraft(located!)).not.toContain('Page ')
    const preview = paperQuotePreview(`${'wrench directions '.repeat(20)}`)
    expect(Array.from(preview).length).toBeLessThanOrEqual(96)
    expect(preview.endsWith('…')).toBe(true)
  })
})
