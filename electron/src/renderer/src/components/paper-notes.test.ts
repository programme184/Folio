import { afterEach, expect, it, vi } from 'vitest'
import type { AgentsDockAPI } from '@shared/ipc'
import { workspaceNoteFiles } from './paper-notes'

const previous = window.agentsDock

const pdf = '/home/ubuntu/Zotero/Context/ICL-robotics/Yan 等 - 2026 - Steertuning Policies from a Few Human Videos.pdf'
const notes = '/home/ubuntu/Zotero/Context/ICL-robotics/Yan 等 - 2026 - Steertuning Policies from a Few Human Videos.notes'

afterEach(() => {
  window.agentsDock = previous
})

function workspaceApi() {
  const api = {
    entries: vi.fn(),
    absoluteEntries: vi.fn(async () => ({
      entries: [{ kind: 'file', name: 'Note.md', path: `${notes}/Note.md` }]
    })),
    read: vi.fn(),
    readAbsolute: vi.fn(async () => ({ content: 'kept', revision: 'rev-1' })),
    create: vi.fn(async () => ({})),
    createAbsolute: vi.fn(async () => ({})),
    overwrite: vi.fn(),
    overwriteAbsolute: vi.fn(async () => ({})),
    remove: vi.fn(),
    removeAbsolute: vi.fn(async () => undefined)
  }
  window.agentsDock = { workspace: api } as unknown as AgentsDockAPI
  return api
}

it('writes notes for an absolute PDF through the absolute workspace API', async () => {
  const api = workspaceApi()
  const files = workspaceNoteFiles('sess', pdf)

  await expect(files.list()).resolves.toEqual(['Note.md'])
  expect(api.absoluteEntries).toHaveBeenCalledWith('sess', notes, 0, 200)
  expect(api.entries).not.toHaveBeenCalled()

  await files.create('Note 2.md')
  expect(api.createAbsolute).toHaveBeenNthCalledWith(1, 'sess', notes, 'directory')
  expect(api.createAbsolute).toHaveBeenNthCalledWith(2, 'sess', `${notes}/Note 2.md`, 'file')
  expect(api.create).not.toHaveBeenCalled()

  await files.write('Note.md', 'steer')
  expect(api.overwriteAbsolute).toHaveBeenCalledWith('sess', `${notes}/Note.md`, 'steer')
  expect(api.overwrite).not.toHaveBeenCalled()

  await expect(files.read('Note.md')).resolves.toBe('kept')
  await files.remove('Note.md')
  expect(api.removeAbsolute).toHaveBeenCalledWith('sess', `${notes}/Note.md`, 'rev-1', false)
})

it('keeps workspace-relative PDFs on the relative workspace API', async () => {
  const api = workspaceApi()
  api.entries.mockResolvedValue({ entries: [] })
  const files = workspaceNoteFiles('sess', 'ICL-robotics/Paper.pdf')

  await files.list()
  expect(api.entries).toHaveBeenCalledWith('sess', 'ICL-robotics/Paper.notes', 0, 200)
  expect(api.absoluteEntries).not.toHaveBeenCalled()

  await files.create('Note.md')
  expect(api.create).toHaveBeenNthCalledWith(2, 'sess', 'ICL-robotics/Paper.notes/Note.md', 'file')
  expect(api.createAbsolute).not.toHaveBeenCalled()
})
