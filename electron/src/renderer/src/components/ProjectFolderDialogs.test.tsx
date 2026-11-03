import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentsDockAPI } from '@shared/ipc'
import type { Session } from '@shared/types'
import { resetTransientCloseStackForTests } from '../lib/transient-close'
import { useAppStore } from '../store/app-store'
import { FolderDialog, ProjectFoldersDialog, RenameProjectDialog } from './ProjectFolderDialogs'
import { Sidebar } from './Sidebar'

const session: Session = { id: 'chat-1', title: 'Walk', folder: 'Humanoid', backend: 'cursor' }

describe('project folder dialogs', () => {
  afterEach(() => {
    cleanup()
    resetTransientCloseStackForTests()
  })

  it('requires a project name and at least one local folder before creating', async () => {
    const user = userEvent.setup()
    const setPreference = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'agentsDock', {
      configurable: true,
      value: { preferences: { set: setPreference } } as unknown as AgentsDockAPI
    })
    useAppStore.setState({
      modals: { settings: false, appSettings: false, newChat: false, resume: false, folder: true, digest: false, job: false, search: false, review: false, importChats: false },
      folderOrder: [],
      projectWorkspaces: {},
      sessions: [],
      health: null,
      error: null
    })
    render(<FolderDialog />)

    expect(screen.getByText('This folder lives in Folio. Add the local directories it contains. One workspace can hold folders from different paths.')).toBeVisible()
    const create = screen.getByRole('button', { name: 'Create folder' })
    expect(create).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Humanoid')
    expect(create).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Folder to add' }), '/work/hand')
    await user.click(screen.getByRole('button', { name: 'Add folder' }))
    expect(screen.getByText('/work/hand')).toBeVisible()
    await user.click(create)

    expect(useAppStore.getState().modals.folder).toBe(false)
    expect(useAppStore.getState().folderOrder).toEqual(['Humanoid'])
    expect(useAppStore.getState().projectWorkspaces.Humanoid.directories).toEqual(['/work/hand'])
  })

  it('renames a project and replaces its folders from the sidebar menu', async () => {
    const user = userEvent.setup()
    const update = vi.fn(async (_sessionId: string, patch: Partial<Session>) => ({ ...session, ...patch }))
    Object.defineProperty(window, 'agentsDock', {
      configurable: true,
      value: {
        preferences: { get: vi.fn().mockResolvedValue(0), set: vi.fn().mockResolvedValue(undefined) },
        sessions: { update }
      } as unknown as AgentsDockAPI
    })
    useAppStore.setState({
      profiles: [],
      activeProfileId: null,
      switchingProfileId: null,
      connected: true,
      sessions: [session],
      selectedSessionId: session.id,
      folderOrder: ['General', 'Humanoid'],
      collapsedFolders: new Set<string>(),
      projectWorkspaces: { Humanoid: { directories: ['/work/hand'] } },
      archivedCollapsed: false,
      activeSessionIds: new Set<string>(),
      runtimeCatalog: null,
      health: null,
      error: null,
      creatingChat: false
    })
    render(<><Sidebar /><RenameProjectDialog /><ProjectFoldersDialog /></>)

    fireEvent.contextMenu(screen.getByText('Humanoid'))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename Project' }))
    const name = screen.getByRole('textbox', { name: 'Project name' })
    await user.clear(name)
    await user.type(name, 'Robot')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('chat-1', { folder: 'Robot' }))
    expect(useAppStore.getState().folderOrder).toEqual(['General', 'Robot'])
    expect(screen.getByText('Robot')).toBeVisible()

    fireEvent.contextMenu(screen.getByText('Robot'))
    await user.click(await screen.findByRole('menuitem', { name: 'Change Folders' }))
    expect(screen.getByText('/work/hand')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Remove /work/hand' }))
    await user.type(screen.getByRole('textbox', { name: 'Folder to add' }), '/work/lab')
    await user.click(screen.getByRole('button', { name: 'Add folder' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(useAppStore.getState().projectWorkspaces.Robot.directories).toEqual(['/work/lab']))
  })
})
