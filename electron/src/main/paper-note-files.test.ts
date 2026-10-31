import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPaperNoteFiles } from './paper-note-files'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'paper-notes-'))
  await mkdir(join(root, 'sub'))
  await writeFile(join(root, 'sub', 'Method.pdf'), 'pdf')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('paper note files', () => {
  it('creates, edits, lists and deletes markdown files in the notes folder beside the PDF', async () => {
    const store = createPaperNoteFiles(async () => root)
    expect(await store.list('sub/Method.pdf')).toEqual([])
    await store.create('sub/Method.pdf', 'First.md')
    await store.write('sub/Method.pdf', 'First.md', '# Result\n\n- stable')
    await store.create('sub/Method.pdf', 'Second.md')
    expect(await store.list('sub/Method.pdf')).toEqual(['First.md', 'Second.md'])
    expect(await store.read('sub/Method.pdf', 'First.md')).toBe('# Result\n\n- stable')
    expect(await readFile(join(root, 'sub', 'Method.notes', 'First.md'), 'utf8')).toBe('# Result\n\n- stable')
    await store.remove('sub/Method.pdf', 'Second.md')
    expect(await store.list('sub/Method.pdf')).toEqual(['First.md'])
  })

  it('refuses to overwrite an existing note on create and to write a missing one', async () => {
    const store = createPaperNoteFiles(async () => root)
    await store.create('sub/Method.pdf', 'First.md')
    await expect(store.create('sub/Method.pdf', 'First.md')).rejects.toThrow('paper_note_exists')
    await expect(store.write('sub/Method.pdf', 'Missing.md', 'x')).rejects.toThrow('paper_note_missing')
  })

  it('rejects paths and names that leave the notes folder', async () => {
    const store = createPaperNoteFiles(async () => root)
    await expect(store.list('../Method.pdf')).rejects.toThrow('papers_path_escapes_root')
    await expect(store.list('/etc/Method.pdf')).rejects.toThrow('papers_path_escapes_root')
    await expect(store.list('sub/Method.txt')).rejects.toThrow('papers_path_escapes_root')
    await expect(store.create('sub/Method.pdf', '../escape.md')).rejects.toThrow('invalid_paper_note_name')
    await expect(store.read('sub/Method.pdf', 'notes.txt')).rejects.toThrow('invalid_paper_note_name')
  })
})
