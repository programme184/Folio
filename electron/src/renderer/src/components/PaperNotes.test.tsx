import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PaperNotesPanel } from './PaperNotes'
import type { PaperNoteFiles } from './paper-notes'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function fakeFiles(initial: Record<string, string> = {}): PaperNoteFiles & { written: Array<[string, string]> } {
  const store = { ...initial }
  const written: Array<[string, string]> = []
  return {
    written,
    list: vi.fn(async () => Object.keys(store).sort()),
    read: vi.fn(async name => store[name] ?? ''),
    create: vi.fn(async name => { store[name] = '' }),
    write: vi.fn(async (name, body) => {
      written.push([name, body])
      store[name] = body
    }),
    remove: vi.fn(async name => { delete store[name] })
  }
}

it('creates a markdown note and saves its edits after a short pause', async () => {
  vi.useFakeTimers()
  const files = fakeFiles()
  render(<PaperNotesPanel files={files} />)
  await act(async () => { await Promise.resolve() })

  fireEvent.click(screen.getByRole('button', { name: /新建笔记|New note/ }))
  await act(async () => { await Promise.resolve() })
  expect(files.create).toHaveBeenCalledTimes(1)
  const created = vi.mocked(files.create).mock.calls[0]?.[0] ?? ''
  expect(created).toMatch(/^Note .*\.md$/)

  const body = screen.getByRole('textbox', { name: /Markdown|笔记内容|Note in Markdown/ })
  fireEvent.change(body, { target: { value: '## Result\n\n- stable' } })
  expect(files.write).not.toHaveBeenCalled()
  await act(async () => { vi.advanceTimersByTime(400) })
  expect(files.written).toEqual([[created, '## Result\n\n- stable']])
})

it('disables creation and says so when the PDF has no notes folder support', async () => {
  render(<PaperNotesPanel files={null} />)
  expect((screen.getByRole('button', { name: /新建笔记|New note/ }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toMatch(/可用于|are available/)
})
