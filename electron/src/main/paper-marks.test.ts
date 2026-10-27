import { describe, expect, it } from 'vitest'
import { PAPER_HIGHLIGHT_COLOR, PAPER_UNDERLINE_COLOR, type PaperMark } from '../shared/paper-passages'
import { createPaperMarkStore } from './paper-marks'

function mark(id: string, type: PaperMark['type'] = 'highlight'): PaperMark {
  return {
    id,
    type,
    color: type === 'highlight' ? PAPER_HIGHLIGHT_COLOR : PAPER_UNDERLINE_COLOR,
    hits: [{ page: 2, glyphIndexes: [1, 4] }],
    text: 'A stored passage.',
    rects: [{ page: 2, x: 10, y: 20, width: 30, height: 8 }]
  }
}

describe('paper mark store', () => {
  it('round-trips highlight and underline marks for one document without dropping another', () => {
    let file: string | null = null
    const store = createPaperMarkStore({
      read: () => file,
      write: contents => { file = contents }
    })
    expect(store.load('shelf:notes/a.pdf')).toEqual([])
    const saved = store.save('shelf:notes/a.pdf', [mark('highlight-1'), mark('underline-1', 'underline')])
    expect(saved.map(item => item.type)).toEqual(['highlight', 'underline'])
    store.save('workspace:profile:chat:docs/b.pdf', [mark('other-1')])
    expect(store.load('shelf:notes/a.pdf').map(item => item.id)).toEqual(['highlight-1', 'underline-1'])
    expect(store.load('workspace:profile:chat:docs/b.pdf')).toHaveLength(1)
    expect(file).toContain('"version":1')
    expect(file).not.toContain('/home/')
    store.save('shelf:notes/a.pdf', [])
    expect(store.load('shelf:notes/a.pdf')).toEqual([])
    expect(store.load('workspace:profile:chat:docs/b.pdf')).toHaveLength(1)
  })

  it('rejects a bad key or a bad mark without replacing a readable file', () => {
    let file: string | null = null
    const store = createPaperMarkStore({
      read: () => file,
      write: contents => { file = contents }
    })
    store.save('shelf:a.pdf', [mark('mark-1')])
    const snapshot = file
    expect(() => store.save('not-a-key', [mark('mark-2')])).toThrow('invalid_paper_mark_key')
    expect(() => store.save('shelf:a.pdf', [{ ...mark('mark-1'), text: '' }])).toThrow('invalid_paper_marks')
    expect(file).toBe(snapshot)
    expect(store.load('../escape')).toEqual([])
    file = '{ "documents": { "shelf:a.pdf": [{ "id": "broken" }] } }'
    expect(store.load('shelf:a.pdf')).toEqual([])
    expect(() => store.save('shelf:b.pdf', [mark('mark-3')])).toThrow('paper_marks_unreadable')
    expect(file).toContain('broken')
  })
})
