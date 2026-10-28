import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '@shared/i18n'
import type { Session, WorkspaceEntriesPage, WorkspaceEntry } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { InspectorFiles as RealInspectorFiles } from './InspectorFiles'
import { WorkspaceEditor, resetWorkspaceEditorMemoryForTests } from './WorkspaceEditor'
import { WorkspaceFilesProvider, workspaceFilesKey } from './WorkspaceFilesContext'

vi.mock('./CodeMirrorEditor', () => ({ CodeMirrorEditor: ({ value, ariaLabel }: { value: string; ariaLabel: string }) => <textarea readOnly value={value} aria-label={ariaLabel} /> }))

function InspectorFiles({ session, scope }: { session: Session; scope: { profileId: string; profileGeneration: number; serverIdentity: string } }) {
  return <WorkspaceFilesProvider>
    <WorkspaceEditor key={workspaceFilesKey(scope, session.id, session.cwd ?? '')} session={session} profileScope={scope}
      workspaceKey={workspaceFilesKey(scope, session.id, session.cwd ?? '')} available capabilityVersion={6} chatContent={<p>Chat</p>} />
    <RealInspectorFiles session={session} scope={scope} />
  </WorkspaceFilesProvider>
}

const scope = { profileId: 'profile-a', profileGeneration: 4, serverIdentity: 'server-a' }
const session: Session = { id: 'chat-a', title: 'Chat A', backend: 'codex', cwd: '/work/project' }
const folder: WorkspaceEntry = { name: 'src', path: 'src', kind: 'directory' }
const file: WorkspaceEntry = { name: 'hello world.ts', path: 'src/hello world.ts', kind: 'file' }
const entries = vi.fn<(...args: unknown[]) => Promise<WorkspaceEntriesPage>>()

function page(items: WorkspaceEntry[], path = '', extra: Partial<WorkspaceEntriesPage> = {}): WorkspaceEntriesPage {
  return { root: '/work/project', path, entries: items, total: items.length, offset: 0, limit: 500, has_more: false, ...extra }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(complete => { resolve = complete })
  return { promise, resolve }
}

beforeEach(() => {
  setLocale('en')
  resetWorkspaceEditorMemoryForTests()
  entries.mockReset().mockResolvedValue(page([folder]))
  Object.defineProperty(window, 'agentsDock', { configurable: true, value: {
    workspace: { entries, read: vi.fn().mockImplementation(async (_id, path) => ({ root: '/work/project', path, name: path.split('/').at(-1), content: 'hello', writable: true, revision: 'r1', size: 5, mtime_ns: 1 })) },
    preferences: { getScoped: vi.fn().mockResolvedValue(null), setScoped: vi.fn().mockResolvedValue(undefined) },
    native: { log: vi.fn().mockResolvedValue(undefined) }
  } })
  useAppStore.setState({ activeProfileId: scope.profileId, profileGeneration: scope.profileGeneration,
    switchingProfileId: null, connected: true, health: { ok: true, capabilities: { workspace_files: { available: true, version: 6, required: false, message: "", action: "" } } },
    selectedSessionId: session.id, sessions: [session] })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Inspector files', () => {
  it('loads folders on expansion, caches them and opens files in the existing editor', async () => {
    entries.mockImplementation(async (_id, path) => path ? page([file], 'src') : page([folder]))
    const opened = vi.fn()
    window.addEventListener('agentsdock:open-workspace-path', opened)
    try {
      render(<InspectorFiles session={session} scope={scope} />)
      expect(await screen.findByRole('button', { name: 'src' })).toHaveAttribute('aria-expanded', 'false')
      expect(entries).toHaveBeenCalledExactlyOnceWith('chat-a', '', 0, 500)
      fireEvent.click(screen.getByRole('button', { name: 'src' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Open src/hello world.ts' }))
      await screen.findByRole('textbox', { name: 'Contents of src/hello world.ts' })
      expect(window.agentsDock.workspace.read).toHaveBeenCalledWith(session.id, file.path)
      fireEvent.click(screen.getByRole('button', { name: 'src' }))
      expect(screen.queryByRole('button', { name: 'Open src/hello world.ts' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'src' }))
      expect(entries).toHaveBeenCalledTimes(2)
      expect(entries).toHaveBeenLastCalledWith('chat-a', 'src', 0, 500)
    } finally { window.removeEventListener('agentsdock:open-workspace-path', opened) }
  })

  it('paginates explicitly and preserves entries if loading the next page fails', async () => {
    entries.mockResolvedValueOnce(page([folder], '', { has_more: true, total: 2 }))
      .mockRejectedValueOnce(new Error('Temporary read error'))
      .mockResolvedValueOnce(page([{ ...file, path: 'hello world.ts' }], '', { offset: 1, total: 2 }))
    render(<InspectorFiles session={session} scope={scope} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary read error')
    expect(screen.getByRole('button', { name: 'src' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Open hello world.ts' })).toBeVisible()
    expect(entries).toHaveBeenLastCalledWith('chat-a', '', 1, 500)
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('refreshes explicitly and discards an older directory response', async () => {
    const old = deferred<WorkspaceEntriesPage>()
    entries.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([]))
    render(<InspectorFiles session={session} scope={scope} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh file explorer' }))
    expect(await screen.findByText('This folder is empty.')).toBeVisible()
    await act(async () => old.resolve(page([folder])))
    expect(screen.queryByRole('button', { name: 'src' })).not.toBeInTheDocument()
    expect(entries).toHaveBeenCalledTimes(2)
  })

  it.each(['chat', 'directory', 'profile'] as const)('discards pending results when the %s changes', async changed => {
    const old = deferred<WorkspaceEntriesPage>()
    entries.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([]))
    const view = render(<InspectorFiles session={session} scope={scope} />)
    const nextSession = { ...session, id: changed === 'chat' ? 'chat-b' : session.id, cwd: changed === 'directory' ? '/another' : session.cwd }
    const nextScope = changed === 'profile' ? { ...scope, profileId: 'profile-b', profileGeneration: 5 } : scope
    await act(async () => {
      useAppStore.setState({ activeProfileId: nextScope.profileId, profileGeneration: nextScope.profileGeneration,
        selectedSessionId: nextSession.id, sessions: [nextSession] })
      view.rerender(<InspectorFiles session={nextSession} scope={nextScope} />)
    })
    expect(await screen.findByText('This folder is empty.')).toBeVisible()
    await act(async () => old.resolve(page([folder])))
    expect(screen.queryByRole('button', { name: 'src' })).not.toBeInTheDocument()
  })

  it('does not issue requests for a missing directory or unavailable server', async () => {
    const view = render(<InspectorFiles session={{ ...session, cwd: '' }} scope={scope} />)
    expect(screen.getByText('No working directory')).toBeVisible()
    await act(async () => {
      useAppStore.setState({ connected: false })
      view.rerender(<InspectorFiles session={session} scope={scope} />)
    })
    expect(screen.getByText(/finishes connecting/)).toBeVisible()
    await act(async () => useAppStore.setState({ connected: true, health: { ok: true } }))
    expect(screen.getByText(/Update AgentsServer/)).toBeVisible()
    expect(entries).not.toHaveBeenCalled()
  })

  it('lists hidden files while keeping symlinks unavailable', async () => {
    entries.mockResolvedValue(page([{ name: '.env', path: '.env', kind: 'file', hidden: true }, { name: 'outside', path: 'outside', kind: 'symlink' }]))
    render(<InspectorFiles session={session} scope={scope} />)
    expect(await screen.findByRole('button', { name: 'Open .env' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Open outside' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open outside' })).toHaveAttribute('title', 'outside · Symlinks cannot be opened')
  })

  it('rejects a changed server root instead of mixing directory contents', async () => {
    entries.mockResolvedValueOnce(page([folder])).mockResolvedValueOnce(page([file], 'src', { root: '/different' }))
    render(<InspectorFiles session={session} scope={scope} />)
    fireEvent.click(await screen.findByRole('button', { name: 'src' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The working directory changed. Refresh the file list.')
    expect(screen.queryByRole('button', { name: 'Open src/hello world.ts' })).not.toBeInTheDocument()
  })

  it('browses directory names that coincide with JavaScript object properties', async () => {
    entries.mockResolvedValueOnce(page([{ name: '__proto__', path: '__proto__', kind: 'directory' }]))
      .mockResolvedValueOnce(page([], '__proto__'))
    render(<InspectorFiles session={session} scope={scope} />)
    fireEvent.click(await screen.findByRole('button', { name: '__proto__' }))
    expect(await screen.findByText('This folder is empty.')).toBeVisible()
    expect(entries).toHaveBeenLastCalledWith('chat-a', '__proto__', 0, 500)
  })

  it('loads after strict-mode effect replay and translates empty state', async () => {
    setLocale('zh-CN')
    entries.mockResolvedValue(page([]))
    render(<StrictMode><InspectorFiles session={session} scope={scope} /></StrictMode>)
    expect(await screen.findByText('此文件夹为空。')).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })
})
