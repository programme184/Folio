import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentsDockAPI } from '@shared/ipc'
import type { PublicServerProfile, Session } from '@shared/types'
import type { ChatWorkspace } from '../lib/chat-panes'
import { useAppStore } from '../store/app-store'
import { ChatWorkspaceGrid, type CrossServerWorkspaceState } from './ChatWorkspaceGrid'

vi.mock('./ChatPane', () => ({ ChatPane: ({ pane, focused, onBrowsePane }: { pane: string; focused: boolean; onBrowsePane?: () => void }) =>
  <div data-testid={`chat-pane-${pane}`} data-focused={String(focused)}>
    {onBrowsePane && <button type="button" onClick={onBrowsePane}>Browse {pane}</button>}
  </div> }))

const initialState = useAppStore.getState()
const profile = (id: string): PublicServerProfile => ({
  id, name: id, serverUrl: `http://${id}.test`, serverIdentity: `server-${id}`,
  hasAccessToken: true, serverSetupComplete: true, connectionState: 'online', cachedUnreadCount: 0
})
const workspace = (id: string, columnRatio = 0.5): ChatWorkspace => ({
  id, panes: { primary: null, secondary: null }, focusedPane: 'primary', paneCount: 2,
  columnRatio, rowRatio: 0.5
})

describe('ChatWorkspaceGrid resize ownership', () => {
  let frames: Map<number, FrameRequestCallback>
  let setScoped: ReturnType<typeof vi.fn>

  beforeEach(() => {
    frames = new Map()
    let nextFrame = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.set(++nextFrame, callback)
      return nextFrame
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
    setScoped = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'agentsDock', { configurable: true, value: {
      preferences: { setScoped, set: vi.fn().mockResolvedValue(undefined) }
    } as unknown as AgentsDockAPI })
    useAppStore.setState({
      ...initialState, activeProfileId: 'a', profileGeneration: 1, profiles: [profile('a')],
      switchingProfileId: null, sessions: [], selectedSessionId: null,
      chatPanes: { primary: null, secondary: null }, focusedChatPane: 'primary', chatPaneCount: 2,
      activeChatWorkspaceId: 'workspace-main', chatWorkspaceBarVisible: true, chatWorkspaces: [workspace('workspace-main')]
    })
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
    document.body.classList.remove('chat-split-resizing')
    vi.restoreAllMocks()
  })

  const flushFrames = () => act(() => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach(callback => callback(0))
  })

  const startDrag = () => {
    const view = render(<ChatWorkspaceGrid sidebarVisible terminalOpen={false}
      onSidebarToggle={() => undefined} onTerminalToggle={() => undefined} sideChat={() => null} />)
    const grid = view.container.querySelector('.workspace-chat-grid')!
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => ({})
    })
    flushFrames()
    const divider = screen.getByRole('separator', { name: 'Resize columns' })
    fireEvent(divider, new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    fireEvent(window, new MouseEvent('pointermove', { clientX: 640, clientY: 200 }))
    flushFrames()
    expect(divider).toHaveAttribute('aria-valuenow', '64')
    return view
  }

  it('creates in the initiating empty pane even when its search has no matches', () => {
    const requestNewChat = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ requestNewChat })
    const view = render(<ChatWorkspaceGrid sidebarVisible terminalOpen={false}
      onSidebarToggle={() => undefined} onTerminalToggle={() => undefined} sideChat={() => null} />)
    const pane = within(view.container.querySelector('[data-chat-pane="secondary"]') as HTMLElement)
    fireEvent.change(pane.getByRole('searchbox'), { target: { value: 'no matching chat' } })
    fireEvent.click(pane.getByRole('button', { name: 'New chat' }))
    expect(requestNewChat).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace-main', pane: 'secondary' })
  })

  it('creates an ordinary chat before opting into workspaces', () => {
    const requestNewChat = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ requestNewChat, chatWorkspaces: [], chatWorkspaceBarVisible: false,
      activeChatWorkspaceId: '', chatPaneCount: 1 })
    render(<ChatWorkspaceGrid sidebarVisible terminalOpen={false}
      onSidebarToggle={() => undefined} onTerminalToggle={() => undefined} sideChat={() => null} />)
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(requestNewChat).toHaveBeenCalledExactlyOnceWith(undefined)
    expect(useAppStore.getState().chatWorkspaces).toEqual([])
  })

  it('offers both three-pane arrangements and keeps independent widths', () => {
    const view = render(<ChatWorkspaceGrid sidebarVisible terminalOpen={false}
      onSidebarToggle={() => undefined} onTerminalToggle={() => undefined} sideChat={() => null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Three columns' }))
    const grid = view.container.querySelector('.workspace-chat-grid')!
    expect(grid).toHaveAttribute('data-three-pane-layout', 'columns')
    expect(grid).not.toHaveClass('short')
    expect(screen.getAllByRole('separator')).toHaveLength(2)
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize first column' }), { key: 'ArrowLeft' })
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize last column' }), { key: 'ArrowRight' })
    expect(useAppStore.getState().chatWorkspaces[0].threeColumnRatios?.[0]).toBeCloseTo(1 / 3 - 0.05)
    expect(useAppStore.getState().chatWorkspaces[0].threeColumnRatios?.[1]).toBeCloseTo(2 / 3 + 0.05)
    fireEvent.click(screen.getByRole('button', { name: '3 panes' }))
    expect(grid).toHaveAttribute('data-three-pane-layout', 'split')
    expect(grid).toHaveClass('short')
    expect(screen.getByRole('separator', { name: 'Resize columns' })).toHaveAttribute('aria-valuenow', '50')
    fireEvent.click(screen.getByRole('button', { name: 'Three columns' }))
    expect(screen.getByRole('separator', { name: 'Resize first column' })).toHaveAttribute('aria-valuenow', '28')
    expect(screen.getByRole('separator', { name: 'Resize last column' })).toHaveAttribute('aria-valuenow', '72')
  })

  it('offers every saved server before choosing a chat for an empty pane', async () => {
    const switchServer = vi.fn(async (profileId: string) => {
      useAppStore.setState({ activeProfileId: profileId })
      return true
    })
    const onCrossServerWorkspaceChange = vi.fn()
    useAppStore.setState({ profiles: [profile('a'), profile('b'), profile('c')], switchServer })
    const view = render(<ChatWorkspaceGrid sidebarVisible terminalOpen={false}
      onCrossServerWorkspaceChange={onCrossServerWorkspaceChange}
      onSidebarToggle={() => undefined} onTerminalToggle={() => undefined} sideChat={() => null} />)

    const emptyPane = view.container.querySelector('[data-chat-pane="primary"]') as HTMLElement
    const selector = within(emptyPane).getByRole('button', { name: /a, Online.*Choose AgentsServer/ })
    expect(selector).toHaveClass('compact')
    fireEvent.pointerDown(selector, { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: /c/ }))

    expect(switchServer).not.toHaveBeenCalled()
    expect(onCrossServerWorkspaceChange).toHaveBeenCalledWith(expect.objectContaining({
      activeProfileId: 'a', focusedPane: 'primary',
      panes: expect.objectContaining({ primary: expect.objectContaining({ profileId: 'c' }) })
    }))
  })

  it('captures the left pane before switching the empty right pane to another server', async () => {
    const left = { id: 'left-chat', title: 'Left chat', backend: 'codex', cwd: '/left', archived: false } as Session
    const switchServer = vi.fn(async () => true)
    const onCrossServerWorkspaceChange = vi.fn()
    useAppStore.setState({
      profiles: [profile('a'), profile('b')], sessions: [left], switchServer,
      chatPanes: { primary: left.id, secondary: null }, chatPaneCount: 2, focusedChatPane: 'secondary',
      chatWorkspaces: [{ ...workspace('workspace-main'), panes: { primary: left.id, secondary: null }, focusedPane: 'secondary' }]
    })
    const view = render(<ChatWorkspaceGrid sidebarVisible terminalOpen={false}
      onCrossServerWorkspaceChange={onCrossServerWorkspaceChange}
      onSidebarToggle={() => undefined} onTerminalToggle={() => undefined} sideChat={() => null} />)

    const right = view.container.querySelector('[data-pane="secondary"]') as HTMLElement
    fireEvent.pointerDown(within(right).getByRole('button', { name: /a, Online.*Choose AgentsServer/ }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: /b/ }))

    expect(onCrossServerWorkspaceChange).toHaveBeenCalledWith(expect.objectContaining({
      activeProfileId: 'a', paneCount: 2, focusedPane: 'secondary',
      panes: {
        primary: expect.objectContaining({ profileId: 'a', session: left }),
        secondary: expect.objectContaining({ profileId: 'b', session: null })
      }
    }))
    expect(switchServer).not.toHaveBeenCalled()

    const concurrent = onCrossServerWorkspaceChange.mock.calls[0][0]
    view.rerender(<ChatWorkspaceGrid sidebarVisible terminalOpen={false}
      crossServerWorkspace={concurrent} onCrossServerWorkspaceChange={onCrossServerWorkspaceChange}
      onSidebarToggle={() => undefined} onTerminalToggle={() => undefined} sideChat={() => null} />)
    const embedded = view.container.querySelector('[data-pane="secondary"] webview')
    expect(embedded).toHaveAttribute('src', expect.stringContaining('embeddedPane=1'))
    expect(embedded).toHaveAttribute('src', expect.stringContaining('profileId=b'))
    const concurrentPane = within(view.container.querySelector('[data-pane="secondary"]') as HTMLElement)
    expect(concurrentPane.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument()
    expect(concurrentPane.getByRole('button', { name: 'Close b pane' })).toBeVisible()
    fireEvent.click(concurrentPane.getByRole('button', { name: 'Close b pane' }))
    const closeUpdate = onCrossServerWorkspaceChange.mock.calls.at(-1)?.[0]
    expect(closeUpdate).toBeTypeOf('function')
    expect(closeUpdate(concurrent)).toEqual(expect.objectContaining({ paneCount: 1, focusedPane: 'primary' }))
    expect(useAppStore.getState().chatPaneCount).toBe(1)
  })

  it('opens a project-grouped browser from every populated pane and can move that pane to another server', async () => {
    const folio = { id: 'folio-chat', title: 'Folio chat', backend: 'codex', cwd: '/folio', folder: 'Folio', archived: false } as Session
    const folioOther = { id: 'folio-other', title: 'Other Folio chat', backend: 'codex', cwd: '/folio/other', folder: 'Folio', archived: false } as Session
    const research = { id: 'research-chat', title: 'Research chat', backend: 'claude', cwd: '/research', folder: 'Research', archived: false } as Session
    const onCrossServerWorkspaceChange = vi.fn()
    const requestNewChat = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({
      profiles: [profile('a'), profile('b')], sessions: [folio, folioOther, research],
      folderOrder: ['Folio', 'Research', 'Empty project'], requestNewChat, creatingChat: false, switchingProfileId: null,
      chatPanes: { primary: folio.id, secondary: research.id }, chatPaneCount: 2,
      chatWorkspaces: [{ ...workspace('workspace-main'), panes: { primary: folio.id, secondary: research.id } }]
    })
    const view = render(<ChatWorkspaceGrid sidebarVisible terminalOpen={false}
      onCrossServerWorkspaceChange={onCrossServerWorkspaceChange}
      onSidebarToggle={() => undefined} onTerminalToggle={() => undefined} sideChat={() => null} />)

    fireEvent.click(within(view.container.querySelector('[data-pane="secondary"]') as HTMLElement).getByRole('button', { name: 'Browse secondary' }))
    const secondary = within(view.container.querySelector('[data-pane="secondary"]') as HTMLElement)
    expect(secondary.getByRole('heading', { name: /Folio/ })).toBeVisible()
    expect(secondary.getByRole('heading', { name: /Empty project/ })).toBeVisible()
    expect(secondary.queryByRole('button', { name: /^Folio chat/ })).not.toBeInTheDocument()
    expect(secondary.getByRole('button', { name: /Other Folio chat/ })).toBeVisible()
    expect(secondary.getByRole('button', { name: /Research chat/ })).toBeVisible()
    fireEvent.pointerDown(secondary.getByRole('button', { name: /a, Online.*Choose AgentsServer/ }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: /b/ }))
    expect(onCrossServerWorkspaceChange).toHaveBeenCalledWith(expect.objectContaining({
      activeProfileId: 'a', focusedPane: 'secondary',
      panes: expect.objectContaining({
        primary: expect.objectContaining({ profileId: 'a', session: folio }),
        secondary: expect.objectContaining({ profileId: 'b', session: null })
      })
    }))
    fireEvent.click(secondary.getByRole('button', { name: 'Collapse Folio' }))
    expect(secondary.queryByRole('button', { name: /Other Folio chat/ })).not.toBeInTheDocument()
    fireEvent.click(secondary.getByRole('button', { name: 'Expand Folio' }))
    expect(secondary.getByRole('button', { name: /Other Folio chat/ })).toBeVisible()
    fireEvent.click(secondary.getByRole('button', { name: 'Create chat in Folio' }))
    expect(requestNewChat).toHaveBeenCalledWith({ workspaceId: 'workspace-main', pane: 'secondary', folder: 'Folio' })
    fireEvent.click(secondary.getByRole('button', { name: 'Create project' }))
    expect(useAppStore.getState().modals.folder).toBe(true)
  })

  it('opens a newly created project chat in the pane that launched creation', async () => {
    const current = { id: 'current', title: 'Current', backend: 'codex', cwd: '/folio', folder: 'Folio', archived: false } as Session
    const created = { ...current, id: 'created', title: 'New chat' }
    const requestNewChat = vi.fn(async (target?: string | { folder?: string }) => {
      expect(typeof target === 'string' ? target : target?.folder).toBe('Folio')
      useAppStore.setState({ sessions: [current, created], selectedSessionId: created.id,
        chatPanes: { primary: created.id, secondary: null } })
    })
    useAppStore.setState({ sessions: [current], folderOrder: ['Folio'], requestNewChat,
      selectedSessionId: current.id, chatPanes: { primary: current.id, secondary: null }, chatPaneCount: 1,
      chatWorkspaces: [{ ...workspace('workspace-main'), paneCount: 1, panes: { primary: current.id, secondary: null } }] })
    const view = render(<ChatWorkspaceGrid sidebarVisible terminalOpen={false}
      onSidebarToggle={() => undefined} onTerminalToggle={() => undefined} sideChat={() => null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Browse primary' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create chat in Folio' }))

    await waitFor(() => expect(screen.getByTestId('chat-pane-primary')).toBeVisible())
    expect(requestNewChat).toHaveBeenCalledOnce()
    expect(view.container.querySelector('.empty-chat-pane')).not.toBeInTheDocument()
  })

  it('uses live pane focus for file-tree ownership while a cross-server pane is mounted', () => {
    const left = { id: 'left-chat', title: 'Left chat', backend: 'codex', cwd: '/left', archived: false } as Session
    const right = { id: 'right-chat', title: 'Right chat', backend: 'codex', cwd: '/right', archived: false } as Session
    useAppStore.setState({
      profiles: [profile('a'), profile('b')], sessions: [left, right],
      chatPanes: { primary: left.id, secondary: right.id, tertiary: null },
      chatPaneCount: 3, focusedChatPane: 'secondary'
    })
    const crossServerWorkspace: CrossServerWorkspaceState = {
      activeProfileId: 'a', paneCount: 3, focusedPane: 'tertiary',
      panes: {
        primary: { profileId: 'a', profileGeneration: 1, serverIdentity: 'server-a', profileName: 'a', session: left },
        secondary: { profileId: 'a', profileGeneration: 1, serverIdentity: 'server-a', profileName: 'a', session: right },
        tertiary: { profileId: 'b', profileGeneration: 1, serverIdentity: 'server-b', profileName: 'b', session: null }
      }
    }

    render(<ChatWorkspaceGrid sidebarVisible terminalOpen={false} crossServerWorkspace={crossServerWorkspace}
      onSidebarToggle={() => undefined} onTerminalToggle={() => undefined} sideChat={() => null} />)

    expect(screen.getByTestId('chat-pane-primary')).toHaveAttribute('data-focused', 'false')
    expect(screen.getByTestId('chat-pane-secondary')).toHaveAttribute('data-focused', 'true')
  })

  it('does not show workspace tabs or layout controls before opting in', () => {
    useAppStore.setState({ chatWorkspaces: [], chatWorkspaceBarVisible: false, activeChatWorkspaceId: '', chatPaneCount: 1 })
    const view = render(<ChatWorkspaceGrid sidebarVisible terminalOpen={false}
      onSidebarToggle={() => undefined} onTerminalToggle={() => undefined} sideChat={() => null} />)
    expect(view.container.querySelector('.workspace-tabs-bar')).not.toBeInTheDocument()
    expect(view.container.querySelector('.workspace-layout-picker')).not.toBeInTheDocument()
    expect(view.container.querySelector('.chat-grid-workspace')).toHaveClass('plain-chat-mode')
  })

  it('reveals an empty bar and creates workspaces only with its plus button', async () => {
    useAppStore.setState({ chatWorkspaces: [], chatWorkspaceBarVisible: false, activeChatWorkspaceId: '', chatPaneCount: 1 })
    const view = render(<ChatWorkspaceGrid sidebarVisible terminalOpen={false}
      onSidebarToggle={() => undefined} onTerminalToggle={() => undefined} sideChat={() => null} />)
    act(() => useAppStore.getState().toggleChatWorkspaceBar())
    expect(view.container.querySelector('.workspace-tabs-bar')).toBeInTheDocument()
    expect(view.container.querySelector('.workspace-layout-picker')).not.toBeInTheDocument()
    expect(view.container.querySelector('.chat-grid-workspace')).not.toHaveClass('plain-chat-mode')
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    act(() => useAppStore.getState().toggleChatWorkspaceBar())
    expect(view.container.querySelector('.workspace-tabs-bar')).not.toBeInTheDocument()
    expect(useAppStore.getState().chatWorkspaces).toHaveLength(0)
    act(() => useAppStore.getState().toggleChatWorkspaceBar())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'New workspace' })) })
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(view.container.querySelector('.workspace-layout-picker')).toBeInTheDocument()
    act(() => useAppStore.getState().toggleChatWorkspaceBar())
    expect(view.container.querySelector('.workspace-tabs-bar')).not.toBeInTheDocument()
    expect(useAppStore.getState().chatWorkspaces).toHaveLength(1)
    act(() => useAppStore.getState().toggleChatWorkspaceBar())
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'New workspace' })) })
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('exits empty workspace slots with the toolbar and restores them when reopened', () => {
    useAppStore.setState({ sessions: [{ id: 'a', title: 'Chat A', backend: 'codex' }],
      chatPanes: { primary: 'a', secondary: null }, selectedSessionId: 'a',
      chatWorkspaces: [{ ...workspace('workspace-main'), panes: { primary: 'a', secondary: null } }] })
    const view = render(<ChatWorkspaceGrid sidebarVisible terminalOpen={false}
      onSidebarToggle={() => undefined} onTerminalToggle={() => undefined} sideChat={() => null} />)
    const grid = view.container.querySelector('.workspace-chat-grid')!
    act(() => useAppStore.getState().toggleChatWorkspaceBar())
    expect(view.container.querySelector('.workspace-tabs-bar')).not.toBeInTheDocument()
    expect(grid).toHaveAttribute('data-pane-count', '1')
    expect(screen.queryByText('Choose a chat for this pane')).not.toBeInTheDocument()
    expect(useAppStore.getState().chatWorkspaces).toHaveLength(1)
    act(() => useAppStore.getState().toggleChatWorkspaceBar())
    expect(view.container.querySelector('.workspace-chat-grid')).toBe(grid)
    expect(grid).toHaveAttribute('data-pane-count', '2')
    expect(screen.getByText('Choose a chat for this pane')).toBeVisible()
    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })

  it('does not let either column divider collapse a neighboring pane', () => {
    render(<ChatWorkspaceGrid sidebarVisible terminalOpen={false}
      onSidebarToggle={() => undefined} onTerminalToggle={() => undefined} sideChat={() => null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Three columns' }))
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize first column' }), { key: 'End' })
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize last column' }), { key: 'Home' })
    const [first, second] = useAppStore.getState().chatWorkspaces[0].threeColumnRatios!
    expect(second - first).toBeCloseTo(0.2)
    expect(first).toBeGreaterThanOrEqual(0.2)
    expect(second).toBeLessThanOrEqual(0.8)
  })

  it('persists a completed drag to its current profile and workspace', () => {
    startDrag()
    fireEvent(window, new MouseEvent('pointerup'))
    expect(useAppStore.getState().chatWorkspaces[0].columnRatio).toBe(0.64)
    expect(setScoped).toHaveBeenCalledWith(
      { profileId: 'a', profileGeneration: 1, serverIdentity: 'server-a' },
      'chatWorkspaces', expect.objectContaining({ activeWorkspaceId: 'workspace-main' })
    )
  })

  it('does not persist a departing profile drag into an identically named workspace', () => {
    const view = startDrag()
    act(() => {
      useAppStore.setState({ activeProfileId: 'b', profileGeneration: 2, profiles: [profile('b')],
        chatWorkspaces: [workspace('workspace-main', 0.35)] })
      view.unmount()
    })
    expect(useAppStore.getState().chatWorkspaces[0].columnRatio).toBe(0.35)
    expect(setScoped).not.toHaveBeenCalled()
    expect(document.body).not.toHaveClass('chat-split-resizing')
    fireEvent(window, new MouseEvent('pointerup'))
    expect(setScoped).not.toHaveBeenCalled()
  })

  it('resets a departing drag when the next profile has identical saved ratios', () => {
    startDrag()
    act(() => useAppStore.setState({ activeProfileId: 'b', profileGeneration: 2, profiles: [profile('b')],
      chatWorkspaces: [workspace('workspace-main')] }))
    expect(screen.getByRole('separator', { name: 'Resize columns' })).toHaveAttribute('aria-valuenow', '50')
    expect(document.body).not.toHaveClass('chat-split-resizing')
    expect(setScoped).not.toHaveBeenCalled()
  })

  it('discards a drag when layout changes before pointer release', () => {
    startDrag()
    fireEvent.click(screen.getByRole('button', { name: 'Three columns' }))
    fireEvent.click(screen.getByRole('button', { name: '2 panes' }))
    expect(screen.getByRole('separator', { name: 'Resize columns' })).toHaveAttribute('aria-valuenow', '50')
    expect(useAppStore.getState().chatWorkspaces[0].columnRatio).toBe(0.5)
    expect(document.body).not.toHaveClass('chat-split-resizing')
  })

  it('ends a departing tab drag without resizing the newly selected tab', async () => {
    useAppStore.setState({ chatWorkspaces: [workspace('workspace-main'), workspace('other', 0.35)] })
    startDrag()
    await act(async () => useAppStore.getState().selectChatWorkspace('other'))
    expect(screen.getByRole('separator', { name: 'Resize columns' })).toHaveAttribute('aria-valuenow', '35')
    expect(useAppStore.getState().chatWorkspaces.find(tab => tab.id === 'other')?.columnRatio).toBe(0.35)
    expect(document.body).not.toHaveClass('chat-split-resizing')
    setScoped.mockClear()
    fireEvent(window, new MouseEvent('pointerup'))
    expect(setScoped).not.toHaveBeenCalled()
  })
})
