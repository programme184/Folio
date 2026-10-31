/**
 * Markdown notes attached to a PDF. Each PDF `Paper.pdf` keeps its notes in the sibling
 * folder `Paper.notes/`, one `.md` file per note.
 */
export const PAPER_NOTE_LIMIT = 200
export const PAPER_NOTE_BODY_LIMIT = 1024 * 1024

export function paperNoteFolderName(pdfName: string): string {
  return `${pdfName.replace(/\.pdf$/i, '')}.notes`
}

export function isPaperNoteFileName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 123
    && /^[^\\/\u0000-\u001f.][^\\/\u0000-\u001f]*\.md$/i.test(value)
}

/** A new note name that does not collide with existing names, for example `Note 2026-10-31 14-30-05.md`. */
export function paperNoteFileName(existing: readonly string[], now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
    + `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  const taken = new Set(existing.map(name => name.toLowerCase()))
  let name = `Note ${stamp}.md`
  for (let index = 2; taken.has(name.toLowerCase()); index += 1) {
    name = `Note ${stamp} ${index}.md`
  }
  return name
}
