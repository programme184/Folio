import { useCallback, useEffect, useRef, useState } from 'react'
import { isPaperNoteFileName, paperNoteFileName, paperNoteFolderName, PAPER_NOTE_LIMIT } from '@shared/paper-notes'

const PAPER_NOTE_SAVE_MS = 400

/** The `.md` files in one PDF's notes folder, by file name. */
export interface PaperNoteFiles {
  list(): Promise<string[]>
  read(name: string): Promise<string>
  create(name: string): Promise<void>
  write(name: string, body: string): Promise<void>
  remove(name: string): Promise<void>
}

export interface PaperNoteSource {
  key: string
  files: PaperNoteFiles
}

/** Notes for a PDF in the papers folder. `path` is the PDF's path relative to that folder. */
export function shelfNoteFiles(path: string): PaperNoteFiles | null {
  const api = window.agentsDock?.papers
  if (!api?.listNotes) return null
  return {
    list: () => api.listNotes(path),
    read: name => api.readNote(path, name),
    create: name => api.createNote(path, name),
    write: (name, body) => api.writeNote(path, name, body),
    remove: name => api.removeNote(path, name)
  }
}

/** Notes for a PDF in the chat workspace. `pdfPath` is the PDF's path relative to the workspace. */
export function workspaceNoteFiles(sessionId: string, pdfPath: string): PaperNoteFiles {
  const slash = pdfPath.lastIndexOf('/')
  const folder = [pdfPath.slice(0, Math.max(slash, 0)), paperNoteFolderName(pdfPath.slice(slash + 1))]
    .filter(Boolean)
    .join('/')
  const api = window.agentsDock.workspace
  const pathOf = (name: string) => `${folder}/${name}`
  return {
    async list() {
      // A PDF without notes has no folder yet; the server reports that as an error, which means no notes.
      const page = await api.entries(sessionId, folder, 0, PAPER_NOTE_LIMIT).catch(() => null)
      return (page?.entries ?? [])
        .filter(entry => entry.kind === 'file' && isPaperNoteFileName(entry.name))
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b))
    },
    async read(name) {
      return (await api.read(sessionId, pathOf(name))).content
    },
    async create(name) {
      await api.create(sessionId, folder, 'directory').catch(() => undefined)
      await api.create(sessionId, pathOf(name), 'file')
    },
    async write(name, body) {
      await api.overwrite(sessionId, pathOf(name), body)
    },
    async remove(name) {
      const file = await api.read(sessionId, pathOf(name))
      await api.remove(sessionId, pathOf(name), file.revision, false)
    }
  }
}

/**
 * Lists, opens, creates, edits and deletes the notes of one PDF. Edits are saved after a short pause,
 * and a pending save is flushed when the note is switched or the PDF changes.
 */
export function usePaperNoteFiles(files: PaperNoteFiles | null) {
  const [names, setNames] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [body, setBody] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const selectedRef = useRef<string | null>(null)
  const pending = useRef<{ files: PaperNoteFiles; name: string; body: string } | null>(null)
  const timer = useRef<number | null>(null)

  const flush = useCallback(() => {
    window.clearTimeout(timer.current ?? 0)
    timer.current = null
    const item = pending.current
    pending.current = null
    if (item) void item.files.write(item.name, item.body).catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    selectedRef.current = null
    setNames(null)
    setSelected(null)
    setBody(null)
    setFailed(false)
    if (!files) return
    let cancelled = false
    files.list().then(list => {
      if (!cancelled) setNames(list)
    }, () => {
      if (!cancelled) setNames([])
    })
    return () => {
      cancelled = true
      flush()
    }
  }, [files, flush])

  const select = useCallback((name: string) => {
    flush()
    selectedRef.current = name
    setSelected(name)
    setBody(null)
    setFailed(false)
    files?.read(name).then(text => {
      if (selectedRef.current === name) setBody(text)
    }, () => {
      if (selectedRef.current === name) setFailed(true)
    })
  }, [files, flush])

  const edit = useCallback((text: string) => {
    const name = selectedRef.current
    if (!name || !files) return
    setBody(text)
    pending.current = { files, name, body: text }
    window.clearTimeout(timer.current ?? 0)
    timer.current = window.setTimeout(flush, PAPER_NOTE_SAVE_MS)
  }, [files, flush])

  const create = useCallback(async () => {
    if (!files || !names) return
    const name = paperNoteFileName(names, new Date())
    flush()
    setFailed(false)
    try {
      await files.create(name)
    } catch {
      setFailed(true)
      return
    }
    setNames(list => [...(list ?? []), name].sort((a, b) => a.localeCompare(b)))
    select(name)
  }, [files, names, flush, select])

  const remove = useCallback(async (name: string) => {
    if (!files) return
    if (pending.current?.name === name) pending.current = null
    try {
      await files.remove(name)
    } catch {
      setFailed(true)
      return
    }
    setNames(list => (list ?? []).filter(item => item !== name))
    if (selectedRef.current === name) {
      selectedRef.current = null
      setSelected(null)
      setBody(null)
    }
  }, [files])

  return { names, selected, body, failed, select, edit, create, remove }
}
