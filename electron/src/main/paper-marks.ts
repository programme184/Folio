import {
  isPaperMarkKey,
  parsePaperMarks,
  type PaperMark
} from '../shared/paper-passages'

export interface PaperMarksFile {
  version: 1
  documents: Record<string, PaperMark[]>
}

export interface PaperMarkStore {
  load(key: string): PaperMark[]
  save(key: string, marks: unknown): PaperMark[]
}

export interface PaperMarkStoreDependencies {
  read(): string | null
  write(contents: string): void
}

export function createPaperMarkStore(dependencies: PaperMarkStoreDependencies): PaperMarkStore {
  const readFile = (): PaperMarksFile => {
    const raw = dependencies.read()
    if (!raw) return { version: 1, documents: {} }
    return parsePaperMarksFile(raw)
  }
  return {
    load(key) {
      if (!isPaperMarkKey(key)) return []
      try {
        return cloneMarks(readFile().documents[key] ?? [])
      } catch {
        return []
      }
    },
    save(key, marks) {
      if (!isPaperMarkKey(key)) throw new Error('invalid_paper_mark_key')
      const parsed = parsePaperMarks(marks)
      if (!parsed) throw new Error('invalid_paper_marks')
      let file: PaperMarksFile
      try {
        file = readFile()
      } catch {
        throw new Error('paper_marks_unreadable')
      }
      if (parsed.length === 0) delete file.documents[key]
      else file.documents[key] = parsed
      dependencies.write(`${JSON.stringify({ version: 1, documents: file.documents })}\n`)
      return cloneMarks(parsed)
    }
  }
}

function parsePaperMarksFile(raw: string): PaperMarksFile {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('paper_marks_unreadable')
  const documents = (parsed as { documents?: unknown }).documents
  if (!documents || typeof documents !== 'object' || Array.isArray(documents)) throw new Error('paper_marks_unreadable')
  const result: Record<string, PaperMark[]> = {}
  for (const [key, value] of Object.entries(documents)) {
    if (!isPaperMarkKey(key)) continue
    const marks = parsePaperMarks(value)
    if (!marks) throw new Error('paper_marks_unreadable')
    if (marks.length) result[key] = marks
  }
  return { version: 1, documents: result }
}

function cloneMarks(marks: readonly PaperMark[]): PaperMark[] {
  return marks.map(mark => ({
    ...mark,
    hits: mark.hits.map(hit => ({ page: hit.page, glyphIndexes: [...hit.glyphIndexes] })),
    rects: mark.rects.map(rect => ({ ...rect }))
  }))
}
