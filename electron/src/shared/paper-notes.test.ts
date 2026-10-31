import { describe, expect, it } from 'vitest'
import { isPaperNoteFileName, paperNoteFileName, paperNoteFolderName } from './paper-notes'

describe('paper note files', () => {
  it('names the notes folder beside the PDF', () => {
    expect(paperNoteFolderName('Method.pdf')).toBe('Method.notes')
    expect(paperNoteFolderName('Method.PDF')).toBe('Method.notes')
    expect(paperNoteFolderName('Method.v2.pdf')).toBe('Method.v2.notes')
  })

  it('accepts only plain markdown file names', () => {
    expect(isPaperNoteFileName('Note 2026-10-31 14-30-05.md')).toBe(true)
    expect(isPaperNoteFileName('ideas.MD')).toBe(true)
    expect(isPaperNoteFileName('.hidden.md')).toBe(false)
    expect(isPaperNoteFileName('../escape.md')).toBe(false)
    expect(isPaperNoteFileName('a/b.md')).toBe(false)
    expect(isPaperNoteFileName('a\\b.md')).toBe(false)
    expect(isPaperNoteFileName('notes.txt')).toBe(false)
    expect(isPaperNoteFileName(`${'a'.repeat(120)}.md`)).toBe(true)
    expect(isPaperNoteFileName(`${'a'.repeat(121)}.md`)).toBe(false)
  })

  it('picks a new note name that does not collide with existing names', () => {
    const now = new Date(2026, 9, 31, 14, 30, 5)
    expect(paperNoteFileName([], now)).toBe('Note 2026-10-31 14-30-05.md')
    const taken = ['Note 2026-10-31 14-30-05.md', 'note 2026-10-31 14-30-05 2.md']
    expect(paperNoteFileName(taken, now)).toBe('Note 2026-10-31 14-30-05 3.md')
  })
})
