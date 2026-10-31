import { mkdir, readdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { isPaperNoteFileName, paperNoteFolderName, PAPER_NOTE_BODY_LIMIT } from '../shared/paper-notes'
import { isInside, portableParts } from './paper-shelf'

/** Notes as `.md` files in `<pdf name>.notes/` beside each PDF under the papers root. */
export interface PaperNoteFileStore {
  list(pdfPath: string): Promise<string[]>
  read(pdfPath: string, name: string): Promise<string>
  create(pdfPath: string, name: string): Promise<void>
  write(pdfPath: string, name: string, body: string): Promise<void>
  remove(pdfPath: string, name: string): Promise<void>
}

export function createPaperNoteFiles(rootOf: () => Promise<string>): PaperNoteFileStore {
  const notesFolder = async (pdfPath: string): Promise<string> => {
    const parts = portableParts(pdfPath)
    if (!parts) throw new Error('papers_path_escapes_root')
    const root = await realpath(await rootOf())
    const pdfDirectory = resolve(root, ...parts.slice(0, -1))
    const folder = join(pdfDirectory, paperNoteFolderName(parts[parts.length - 1]))
    for (const path of [pdfDirectory, folder]) {
      const real = await realpath(path).catch(() => null)
      if (real && !isInside(root, real)) throw new Error('papers_path_escapes_root')
    }
    if (!isInside(root, folder)) throw new Error('papers_path_escapes_root')
    return folder
  }
  const existingNote = async (pdfPath: string, name: string) => {
    if (!isPaperNoteFileName(name)) throw new Error('invalid_paper_note_name')
    const path = join(await notesFolder(pdfPath), name)
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) throw new Error('paper_note_missing')
    return { path, size: info.size }
  }
  return {
    async list(pdfPath) {
      const entries = await readdir(await notesFolder(pdfPath), { withFileTypes: true }).catch(() => [])
      return entries
        .filter(entry => entry.isFile() && isPaperNoteFileName(entry.name))
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b))
    },
    async read(pdfPath, name) {
      const note = await existingNote(pdfPath, name)
      if (note.size > PAPER_NOTE_BODY_LIMIT) throw new Error('paper_note_too_large')
      return readFile(note.path, 'utf8')
    },
    async create(pdfPath, name) {
      if (!isPaperNoteFileName(name)) throw new Error('invalid_paper_note_name')
      const path = join(await notesFolder(pdfPath), name)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, '', { flag: 'wx' }).catch(error => {
        throw (error as NodeJS.ErrnoException).code === 'EEXIST' ? new Error('paper_note_exists') : error
      })
    },
    async write(pdfPath, name, body) {
      if (typeof body !== 'string' || body.length > PAPER_NOTE_BODY_LIMIT) throw new Error('paper_note_too_large')
      await writeFile((await existingNote(pdfPath, name)).path, body)
    },
    async remove(pdfPath, name) {
      await unlink((await existingNote(pdfPath, name)).path)
    }
  }
}
