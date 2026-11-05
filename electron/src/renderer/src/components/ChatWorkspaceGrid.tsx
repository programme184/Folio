import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type PointerEvent, type ReactNode, type SetStateAction } from 'react'
import { ChevronDown, ChevronRight, Columns2, Columns3, Folder, FolderPlus, Grid2X2, PanelLeft, Plus, Square, X } from 'lucide-react'
import type { Session, SessionSnapshot } from '@shared/types'
import { t, useLocale } from '../lib/i18n'
import { CHAT_PANE_IDS, type ChatPane as ChatPaneId, type ChatPaneCount, type ChatPaneServerAssignment } from '../lib/chat-panes'
import { notifyTimelineViewportLayout } from '../lib/workspace-layout'
import { useAppStore } from '../store/app-store'
import { ChatPane } from './ChatPane'
import { ServerSelector } from './ServerSelector'
import { ChatWorkspaceTabs } from './ChatWorkspaceTabs'
import './ChatWorkspaceGrid.css'

type ResizeAxis = 'column' | 'row' | 'first' | 'second'

const boundRatio = (value: number) => Math.max(25, Math.min(75, value))

export interface CrossServerPaneState {
  profileId: string
  profileGeneration: number
  serverIdentity: string | null
  profileName: string
  session: Session | null
  sessionId?: string | null
  sessionTitle?: string | null
  snapshot?: SessionSnapshot
}

export interface CrossServerWorkspaceState {
  activeProfileId: string
  paneCount: ChatPaneCount
  focusedPane: ChatPaneId
  panes: Partial<Record<ChatPaneId, CrossServerPaneState>>
  pendingProfileId?: string
  pendingPane?: ChatPaneId
}

export function ChatWorkspaceGrid({ crossServerWorkspace: controlledCrossServerWorkspace, onCrossServerWorkspaceChange, sidebarVisible, terminalOpen, onSidebarToggle, onTerminalToggle, sideChat, papersOpen = false, onPapersToggle, onAskPaper }: {
  crossServerWorkspace?: CrossServerWorkspaceState | null
  onCrossServerWorkspaceChange?: Dispatch<SetStateAction<CrossServerWorkspaceState | null>>
  sidebarVisible: boolean
  terminalOpen: boolean
  onSidebarToggle: () => void
  onTerminalToggle: () => void
  sideChat: (session: Session) => ReactNode
  papersOpen?: boolean
  onPapersToggle?: () => void
  onAskPaper?: (draft: string, submit?: boolean) => void | Promise<void>
}) {
  useLocale()
  const workspaces = useAppStore(state => state.chatWorkspaces)
  const barVisible = useAppStore(state => state.chatWorkspaceBarVisible)
  const activeId = useAppStore(state => state.activeChatWorkspaceId)
  const profileId = useAppStore(state => state.activeProfileId)
  const profileGeneration = useAppStore(state => state.profileGeneration)
  const serverIdentity = useAppStore(state => state.profiles.find(profile => profile.id === state.activeProfileId)?.serverIdentity ?? null)
  const panes = useAppStore(state => state.chatPanes)
  const count = useAppStore(state => state.chatPaneCount)
  const focused = useAppStore(state => state.focusedChatPane)
  const sessions = useAppStore(state => state.sessions)
  const profiles = useAppStore(state => state.profiles)
  const snapshots = useAppStore(state => state.snapshots)
  const active = workspaces.find(workspace => workspace.id === activeId)
  const persistedCrossServerWorkspace = useMemo<CrossServerWorkspaceState | null>(() => {
    if (!profileId || !active || !active.serverPanes) return null
    const remotePanes = Object.entries(active.serverPanes).filter((entry): entry is [ChatPaneId, ChatPaneServerAssignment] => {
      const assignment = entry[1]
      const profile = profiles.find(candidate => candidate.id === assignment.profileId)
      return Boolean(profile && profile.id !== profileId
        && (profile.serverIdentity ?? null) === (assignment.serverIdentity ?? null))
    })
    if (!remotePanes.length) return null
    const assignments: Partial<Record<ChatPaneId, CrossServerPaneState>> = {}
    for (const pane of CHAT_PANE_IDS.slice(0, active.paneCount)) {
      const remote = active.serverPanes[pane]
      const remoteProfile = remote && profiles.find(candidate => candidate.id === remote.profileId
        && candidate.id !== profileId && (candidate.serverIdentity ?? null) === (remote.serverIdentity ?? null))
      if (remote && remoteProfile) {
        assignments[pane] = {
          profileId: remoteProfile.id,
          profileGeneration,
          serverIdentity: remoteProfile.serverIdentity ?? null,
          profileName: remoteProfile.name,
          session: null,
          sessionId: remote.sessionId ?? null,
          sessionTitle: remote.sessionTitle ?? null
        }
        continue
      }
      const sessionId = panes[pane]
      const session = sessions.find(candidate => candidate.id === sessionId) ?? null
      assignments[pane] = {
        profileId,
        profileGeneration,
        serverIdentity,
        profileName: profiles.find(candidate => candidate.id === profileId)?.name ?? '',
        session,
        ...(session && snapshots[session.id] ? { snapshot: snapshots[session.id] } : {})
      }
    }
    return { activeProfileId: profileId, paneCount: active.paneCount, focusedPane: focused, panes: assignments }
  }, [active, focused, panes, profileGeneration, profileId, profiles, serverIdentity, sessions, snapshots])
  const crossServerWorkspace = controlledCrossServerWorkspace === undefined
    ? persistedCrossServerWorkspace
    : controlledCrossServerWorkspace
  const updateCrossServerWorkspace = useCallback<Dispatch<SetStateAction<CrossServerWorkspaceState | null>>>(value => {
    if (onCrossServerWorkspaceChange) {
      onCrossServerWorkspaceChange(value)
      return
    }
    const next = typeof value === 'function' ? value(persistedCrossServerWorkspace) : value
    const serverPanes: Partial<Record<ChatPaneId, ChatPaneServerAssignment>> = {}
    for (const pane of CHAT_PANE_IDS) {
      const assignment = next?.panes[pane]
      if (!assignment || assignment.profileId === profileId) continue
      serverPanes[pane] = {
        profileId: assignment.profileId,
        serverIdentity: assignment.serverIdentity,
        sessionId: assignment.session?.id ?? assignment.sessionId ?? null,
        sessionTitle: assignment.session?.title ?? assignment.sessionTitle ?? null
      }
    }
    useAppStore.getState().setChatWorkspaceServerPanes(serverPanes)
  }, [onCrossServerWorkspaceChange, persistedCrossServerWorkspace, profileId])
  const effectiveCount = crossServerWorkspace?.paneCount ?? count
  const threeColumns = effectiveCount === 3 && active?.threePaneLayout === 'columns'
  const [ratios, setRatios] = useState({
    column: (active?.columnRatio ?? 0.5) * 100, row: (active?.rowRatio ?? 0.5) * 100,
    first: (active?.threeColumnRatios?.[0] ?? 1 / 3) * 100, second: (active?.threeColumnRatios?.[1] ?? 2 / 3) * 100
  })
  const [browsingPanes, setBrowsingPanes] = useState<ReadonlySet<ChatPaneId>>(() => new Set())
  const browsingSessionIdsRef = useRef<Partial<Record<ChatPaneId, string | null>>>({})
  const ratioRef = useRef(ratios)
  const gridRef = useRef<HTMLDivElement>(null)
  const finishResizeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const next = {
      column: (active?.columnRatio ?? 0.5) * 100, row: (active?.rowRatio ?? 0.5) * 100,
      first: (active?.threeColumnRatios?.[0] ?? 1 / 3) * 100, second: (active?.threeColumnRatios?.[1] ?? 2 / 3) * 100
    }
    ratioRef.current = next
    setRatios(next)
  }, [activeId, profileId, profileGeneration, serverIdentity, count, threeColumns, active?.columnRatio, active?.rowRatio, active?.threeColumnRatios])
  useEffect(() => () => finishResizeRef.current?.(), [activeId, profileId, profileGeneration, serverIdentity, count, threeColumns])
  useEffect(() => {
    notifyTimelineViewportLayout('begin')
    const frame = requestAnimationFrame(() => notifyTimelineViewportLayout('end'))
    return () => cancelAnimationFrame(frame)
  }, [effectiveCount, threeColumns, activeId, barVisible])
  useEffect(() => setBrowsingPanes(new Set()), [activeId, profileId, profileGeneration, serverIdentity])
  useEffect(() => setBrowsingPanes(current => {
    const changed = [...current].filter(pane => panes[pane] !== browsingSessionIdsRef.current[pane])
    if (!changed.length) return current
    const next = new Set(current)
    for (const pane of changed) {
      next.delete(pane)
      delete browsingSessionIdsRef.current[pane]
    }
    return next
  }), [panes])
  const bounds = (axis: ResizeAxis) => axis === 'first' ? [20, ratioRef.current.second - 20]
    : axis === 'second' ? [ratioRef.current.first + 20, 80] : [25, 75]
  const clampRatio = (axis: ResizeAxis, value: number) => {
    if (axis === 'column' || axis === 'row') return boundRatio(value)
    const [min, max] = bounds(axis)
    return Math.max(min, Math.min(max, value))
  }
  const ownsResize = useCallback(() => {
    const state = useAppStore.getState()
    return state.activeChatWorkspaceId === activeId && state.activeProfileId === profileId
      && state.profileGeneration === profileGeneration && state.chatPaneCount === count
      && (state.chatWorkspaces.find(workspace => workspace.id === activeId)?.threePaneLayout === 'columns' && count === 3) === threeColumns
      && (state.profiles.find(profile => profile.id === state.activeProfileId)?.serverIdentity ?? null) === serverIdentity
  }, [activeId, profileId, profileGeneration, serverIdentity, count, threeColumns])
  const commitRatio = (axis: ResizeAxis, value: number) => {
    // A departing drag must not resize or persist into another workspace or profile.
    if (!ownsResize()) return
    const next = { ...ratioRef.current, [axis]: clampRatio(axis, value) }
    ratioRef.current = next
    setRatios(next)
    const state = useAppStore.getState()
    state.setChatWorkspaceRatios(axis === 'first' || axis === 'second'
      ? { threeColumnRatios: [next.first / 100, next.second / 100] }
      : axis === 'column' ? { columnRatio: next.column / 100 } : { rowRatio: next.row / 100 })
  }

  const beginResize = (event: PointerEvent, axis: ResizeAxis) => {
    if (event.button !== 0 || !gridRef.current) return
    event.preventDefault()
    ;(event.currentTarget as HTMLElement).focus({ preventScroll: true })
    finishResizeRef.current?.()
    notifyTimelineViewportLayout('begin')
    let frame: number | null = null
    let latest: globalThis.PointerEvent | null = null
    let finished = false
    const paint = () => {
      frame = null
      const rect = gridRef.current?.getBoundingClientRect()
      if (!latest || !rect || !ownsResize()) return
      const value = axis === 'row' ? (latest.clientY - rect.top) / rect.height : (latest.clientX - rect.left) / rect.width
      const next = { ...ratioRef.current, [axis]: clampRatio(axis, value * 100) }
      ratioRef.current = next
      setRatios(next)
      notifyTimelineViewportLayout('update')
    }
    const move = (pointer: globalThis.PointerEvent) => {
      latest = pointer
      if (frame === null) frame = requestAnimationFrame(paint)
    }
    const finish = () => {
      if (finished) return
      finished = true
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
      if (frame !== null) { cancelAnimationFrame(frame); paint() }
      commitRatio(axis, ratioRef.current[axis])
      document.body.classList.remove('chat-split-resizing')
      notifyTimelineViewportLayout('end')
      finishResizeRef.current = null
    }
    finishResizeRef.current = finish
    document.body.classList.add('chat-split-resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', finish)
  }

  const separator = (axis: ResizeAxis) => <div
    className={`workspace-grid-divider ${axis === 'row' ? 'row' : 'column'}${axis === 'first' || axis === 'second' ? ` ${axis}` : ''}`}
    role="separator"
    aria-label={t(axis === 'first' ? 'chatWorkspace.resizeFirstColumn' : axis === 'second' ? 'chatWorkspace.resizeLastColumn' : axis === 'column' ? 'chatWorkspace.resizeColumns' : 'chatWorkspace.resizeRows')}
    aria-orientation={axis === 'row' ? 'horizontal' : 'vertical'}
    aria-valuemin={Math.round(bounds(axis)[0])} aria-valuemax={Math.round(bounds(axis)[1])} aria-valuenow={Math.round(ratios[axis])}
    tabIndex={0}
    onPointerDown={event => beginResize(event, axis)}
    onDoubleClick={() => commitRatio(axis, axis === 'first' ? 100 / 3 : axis === 'second' ? 200 / 3 : 50)}
    onKeyDown={event => {
      const minus = axis === 'row' ? 'ArrowUp' : 'ArrowLeft'
      const plus = axis === 'row' ? 'ArrowDown' : 'ArrowRight'
      if (![minus, plus, 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      notifyTimelineViewportLayout('begin')
      commitRatio(axis, event.key === 'Home' ? bounds(axis)[0] : event.key === 'End' ? bounds(axis)[1] : ratios[axis] + (event.key === plus ? 5 : -5))
      requestAnimationFrame(() => notifyTimelineViewportLayout('end'))
    }}
  />

  const activeProfile = profiles.find(candidate => candidate.id === profileId) ?? null
  const captureActivePane = (pane: ChatPaneId): CrossServerPaneState | null => {
    if (!profileId || !activeProfile) return null
    const sessionId = panes[pane]
    const session = sessions.find(candidate => candidate.id === sessionId) ?? null
    return {
      profileId,
      profileGeneration,
      serverIdentity,
      profileName: activeProfile.name,
      session,
      ...(session && snapshots[session.id] ? { snapshot: snapshots[session.id] } : {})
    }
  }
  const capturedVisiblePanes = (): Partial<Record<ChatPaneId, CrossServerPaneState>> => {
    const captured: Partial<Record<ChatPaneId, CrossServerPaneState>> = {}
    for (const pane of CHAT_PANE_IDS.slice(0, effectiveCount)) {
      const existing = crossServerWorkspace?.panes[pane]
      const next = existing?.profileId === profileId
        ? existing.session ? captureActivePane(pane) ?? existing : existing
        : existing ?? captureActivePane(pane)
      if (next) captured[pane] = next
    }
    return captured
  }
  const chooseServerForPane = async (pane: ChatPaneId, targetProfileId: string) => {
    if (!profileId) return
    const target = profiles.find(candidate => candidate.id === targetProfileId)
    if (!target) return
    const next: CrossServerWorkspaceState = {
      activeProfileId: profileId,
      paneCount: effectiveCount,
      focusedPane: pane,
      panes: {
        ...capturedVisiblePanes(),
        [pane]: {
          profileId: target.id,
          profileGeneration,
          serverIdentity: target.serverIdentity ?? null,
          profileName: target.name,
          session: null
        }
      },
    }
    updateCrossServerWorkspace(next)
  }
  const selectSessionForPane = async (pane: ChatPaneId, sessionId: string) => {
    const session = sessions.find(candidate => candidate.id === sessionId)
    if (!session) return
    if (crossServerWorkspace) {
      updateCrossServerWorkspace(current => current ? {
        ...current,
        focusedPane: pane,
        panes: {
          ...current.panes,
          [pane]: {
            profileId: profileId!, profileGeneration, serverIdentity,
            profileName: activeProfile?.name ?? '', session,
            ...(snapshots[session.id] ? { snapshot: snapshots[session.id] } : {})
          }
        }
      } : current)
    }
    await useAppStore.getState().selectSessionInPane(sessionId, pane)
    setBrowsingPanes(current => {
      if (!current.has(pane)) return current
      const next = new Set(current)
      next.delete(pane)
      return next
    })
    const snapshot = useAppStore.getState().snapshots[sessionId]
    if (snapshot) updateCrossServerWorkspace(current => {
      const assignment = current?.panes[pane]
      return current && assignment?.profileId === profileId && assignment.session?.id === sessionId
        ? { ...current, panes: { ...current.panes, [pane]: { ...assignment, snapshot } } }
        : current
    })
  }
  const closeCrossServerPane = (pane: ChatPaneId) => {
    updateCrossServerWorkspace(current => {
      if (!current || current.paneCount <= 1) return current
      const visible = CHAT_PANE_IDS.slice(0, current.paneCount)
      const closingIndex = visible.indexOf(pane)
      if (closingIndex < 0) return current
      const assignments = visible.map(candidate => current.panes[candidate])
      assignments.splice(closingIndex, 1)
      const nextPanes: Partial<Record<ChatPaneId, CrossServerPaneState>> = {}
      assignments.forEach((assignment, index) => {
        if (assignment) nextPanes[CHAT_PANE_IDS[index]] = assignment
      })
      const focusedIndex = visible.indexOf(current.focusedPane)
      const nextFocusedIndex = focusedIndex === closingIndex
        ? Math.min(closingIndex, assignments.length - 1)
        : focusedIndex > closingIndex ? focusedIndex - 1 : focusedIndex
      const next = {
        ...current,
        paneCount: (current.paneCount - 1) as ChatPaneCount,
        focusedPane: CHAT_PANE_IDS[Math.max(0, nextFocusedIndex)],
        panes: nextPanes
      }
      // Local assignments are captured only to keep them beside a concurrent
      // server webview. Once the last remote pane closes, release that capture
      // so ordinary sidebar/workspace selection renders the live local panes.
      return Object.values(nextPanes).some(assignment => assignment?.profileId !== profileId)
        ? next
        : null
    })
    useAppStore.getState().closeChatPane(pane)
  }
  return <div className={`chat-grid-workspace${barVisible ? '' : ' plain-chat-mode'}`}>
    {barVisible && <header className="workspace-tabs-bar">
      {!sidebarVisible && <button type="button" className="icon-button" onClick={onSidebarToggle} aria-label={t('chatWorkspace.showSidebar')}><PanelLeft size={16} /></button>}
      <ChatWorkspaceTabs key={JSON.stringify([profileId, profileGeneration, serverIdentity])} />
      {workspaces.length > 0 && <div className="workspace-layout-picker" role="group" aria-label={t('chatWorkspace.layout')}>
        {([1, 2, 3, 'columns', 4] as const).map(value => <button key={value} type="button" className="icon-button"
          aria-label={value === 'columns' ? t('chatWorkspace.threeColumns') : t('chatWorkspace.paneCount', { count: value })} title={value === 'columns' ? t('chatWorkspace.threeColumns') : t('chatWorkspace.paneCount', { count: value })}
          aria-pressed={value === 'columns' ? threeColumns : effectiveCount === value && !threeColumns}
          onClick={() => {
            if (value === 'columns' || value === 3) useAppStore.getState().setChatThreePaneLayout(value === 'columns' ? 'columns' : 'split')
            else useAppStore.getState().setChatPaneCount(value)
          }}>
          {value === 1 ? <Square size={15} /> : value === 2 ? <Columns2 size={15} /> : value === 'columns' ? <Columns3 size={15} /> : value === 4 ? <Grid2X2 size={15} /> : <span className="three-pane-icon" aria-hidden="true"><span /><span /><span /></span>}
        </button>)}
      </div>}
    </header>}
    <div ref={gridRef} className={`workspace-chat-grid chat-split-view${effectiveCount >= 3 && !threeColumns ? ' short' : ''}`} data-pane-count={effectiveCount} data-three-pane-layout={threeColumns ? 'columns' : 'split'}
      style={{ '--workspace-column': `${ratios.column}%`, '--workspace-row': `${ratios.row}%`,
        '--workspace-first-column': `${ratios.first}%`, '--workspace-second-column': `${ratios.second}%` } as CSSProperties}>
      {CHAT_PANE_IDS.slice(0, effectiveCount).map(pane => {
        const assignment = crossServerWorkspace?.panes[pane]
        const inactive = assignment && assignment.profileId !== profileId
        const sessionId = assignment ? assignment.session?.id ?? null : panes[pane]
        const session = sessions.find(candidate => candidate.id === sessionId)
        const browsing = browsingPanes.has(pane)
        return <div key={`${pane}:${assignment?.profileId ?? profileId}:${sessionId ?? 'empty'}`} className="workspace-pane-slot" data-pane={pane}>
          {inactive ? <ConcurrentServerPane pane={pane} assignment={assignment}
            closeable={effectiveCount > 1}
            onClose={() => closeCrossServerPane(pane)}
            onSelection={(sessionId, sessionTitle) => updateCrossServerWorkspace(current => {
              const existing = current?.panes[pane]
              return current && existing?.profileId === assignment.profileId
                ? { ...current, panes: { ...current.panes, [pane]: { ...existing, sessionId, sessionTitle } } }
                : current
            })}
            onChooseServer={targetProfileId => chooseServerForPane(pane, targetProfileId)} />
            : session && !browsing ? <ChatPane pane={pane} session={session} focused={focused === pane} split={effectiveCount > 1}
            sidebarVisible={sidebarVisible} terminalOpen={focused === pane && terminalOpen}
            onSidebarToggle={onSidebarToggle} onTerminalToggle={onTerminalToggle} sideChat={sideChat(session)}
            onBrowsePane={() => {
              browsingSessionIdsRef.current[pane] = session.id
              setBrowsingPanes(current => new Set(current).add(pane))
            }}
            papersOpen={papersOpen} onPapersToggle={onPapersToggle} onAskPaper={onAskPaper} />
            : <PaneProjectBrowser pane={pane} focused={focused === pane}
              selectedProfileId={assignment?.profileId ?? profileId}
              excludedSessionIds={new Set(CHAT_PANE_IDS.flatMap(candidatePane => {
                if (candidatePane === pane) return []
                const candidate = crossServerWorkspace?.panes[candidatePane]
                const candidateId = candidate ? candidate.session?.id : panes[candidatePane]
                return candidateId ? [candidateId] : []
              }))}
              onChooseServer={targetProfileId => chooseServerForPane(pane, targetProfileId)}
              onSelectSession={sessionId => selectSessionForPane(pane, sessionId)} />}
        </div>
      })}
      {threeColumns ? <>{separator('first')}{separator('second')}</> : <>
        {effectiveCount >= 2 && separator('column')}
        {effectiveCount >= 3 && separator('row')}
      </>}
    </div>
  </div>
}

export function PaneProjectBrowser({ pane, focused, selectedProfileId, excludedSessionIds, onChooseServer, onSelectSession }: {
  pane: ChatPaneId
  focused: boolean
  selectedProfileId: string | null
  excludedSessionIds: ReadonlySet<string>
  onChooseServer?: (profileId: string) => void | Promise<void>
  onSelectSession: (sessionId: string) => void | Promise<void>
}) {
  const sessions = useAppStore(state => state.sessions)
  const folderOrder = useAppStore(state => state.folderOrder)
  const workspaceId = useAppStore(state => state.activeChatWorkspaceId)
  const creatingChat = useAppStore(state => state.creatingChat)
  const switchingProfileId = useAppStore(state => state.switchingProfileId)
  const [query, setQuery] = useState('')
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(() => new Set())
  const candidates = sessions.filter(session => !session.archived && !excludedSessionIds.has(session.id)
    && `${session.title} ${session.cwd}`.toLowerCase().includes(query.toLowerCase()))
  const groups = useMemo(() => {
    const grouped = new Map<string, Session[]>()
    for (const folder of folderOrder) grouped.set(folder, [])
    for (const session of candidates) {
      const folder = session.folder?.trim() || t('chatWorkspace.generalProject')
      grouped.set(folder, [...(grouped.get(folder) ?? []), session])
    }
    return [...grouped.entries()]
  }, [candidates, folderOrder])
  const toggleProject = (folder: string) => setCollapsedProjects(current => {
    const next = new Set(current)
    if (next.has(folder)) next.delete(folder)
    else next.add(folder)
    return next
  })
  const createChat = async (folder?: string) => {
    const before = new Set(useAppStore.getState().sessions.map(session => session.id))
    await useAppStore.getState().requestNewChat(workspaceId ? { workspaceId, pane, folder } : folder)
    const created = useAppStore.getState().sessions.find(session => !before.has(session.id))
    if (created) await onSelectSession(created.id)
  }
  return <section className={`empty-chat-pane${focused ? ' focused' : ''}`} data-chat-pane={pane} tabIndex={-1}
    onPointerDownCapture={() => useAppStore.getState().focusChatPane(pane)} onFocusCapture={() => useAppStore.getState().focusChatPane(pane)}>
    <div className="empty-pane-heading">
      <strong>{t('chatWorkspace.chooseChat')}</strong>
      <div className="empty-pane-create-actions" role="group" aria-label={t('chatWorkspace.createActions')}>
        <button type="button" className="icon-button" title={t('chatWorkspace.createProject')} aria-label={t('chatWorkspace.createProject')}
          disabled={Boolean(switchingProfileId)} onClick={() => useAppStore.getState().setModal('folder', true)}><FolderPlus size={15} /></button>
        <button type="button" className="icon-button" title={t('chatWorkspace.createChat')} aria-label={t('chatWorkspace.createChat')}
          disabled={Boolean(switchingProfileId) || creatingChat} onClick={() => void createChat()}><Plus size={16} /></button>
      </div>
      {onChooseServer && <div className="empty-pane-server-picker"><ServerSelector compact selectedProfileId={selectedProfileId} onChooseProfile={onChooseServer} /></div>}
    </div>
    <button type="button" className="primary-button empty-pane-new-chat" disabled={creatingChat || Boolean(switchingProfileId)}
      onClick={() => void createChat()}>
      <Plus size={16} aria-hidden="true" />{t('chatWorkspace.newChat')}
    </button>
    <input type="search" aria-label={t('chatWorkspace.search')} placeholder={t('chatWorkspace.search')}
      value={query} onChange={event => setQuery(event.target.value)} />
    <div className="empty-pane-chat-list">
      {groups.map(([folder, chats]) => <section className="empty-pane-project" key={folder}>
        <h3>
          <button type="button" className="empty-pane-project-toggle" aria-expanded={!collapsedProjects.has(folder)}
            aria-label={t(collapsedProjects.has(folder) ? 'chatWorkspace.expandProject' : 'chatWorkspace.collapseProject', { project: folder })}
            onClick={() => toggleProject(folder)}>{collapsedProjects.has(folder) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<Folder size={13} aria-hidden="true" /><span>{folder}</span><small>{chats.length}</small></button>
          <button type="button" className="icon-button empty-pane-project-add" title={t('chatWorkspace.createChatInProject', { project: folder })}
            aria-label={t('chatWorkspace.createChatInProject', { project: folder })} disabled={Boolean(switchingProfileId) || creatingChat}
            onClick={() => void createChat(folder)}><Plus size={14} /></button>
        </h3>
        {!collapsedProjects.has(folder) && chats.map(session => <button type="button" key={session.id} onClick={() => void onSelectSession(session.id)}>
          <span>{session.title}</span><small>{session.backend}</small>
        </button>)}
      </section>)}
      {!candidates.length && <span>{t(!query && sessions.some(session => !session.archived && excludedSessionIds.has(session.id))
        ? 'chatWorkspace.allChatsOpen' : 'chatWorkspace.noChats')}</span>}
    </div>
  </section>
}

function ConcurrentServerPane({ pane, assignment, closeable, onChooseServer, onClose, onSelection }: {
  pane: ChatPaneId
  assignment: CrossServerPaneState
  closeable: boolean
  onChooseServer: (profileId: string) => void | Promise<void>
  onClose: () => void
  onSelection: (sessionId: string | null, sessionTitle: string | null) => void
}) {
  const webviewRef = useRef<HTMLElement | null>(null)
  // Capture the initial restored target. When the live guest reports a newly
  // selected chat we persist it for the next mount without navigating the
  // current webview away from its in-memory draft and scroll position.
  const [source] = useState(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('embeddedPane', '1')
    url.searchParams.set('profileId', assignment.profileId)
    const sessionId = assignment.session?.id ?? assignment.sessionId
    if (sessionId) url.searchParams.set('sessionId', sessionId)
    else url.searchParams.delete('sessionId')
    return url.toString()
  })
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return
    const receive = (event: Event) => {
      const message = event as Event & { channel?: string; args?: unknown[] }
      if (message.channel !== 'agentsdock:embedded-pane-selection') return
      const payload = message.args?.[0]
      if (!payload || typeof payload !== 'object') return
      const selected = payload as { profileId?: unknown; serverIdentity?: unknown; sessionId?: unknown; sessionTitle?: unknown }
      if (selected.profileId !== assignment.profileId
        || (selected.serverIdentity ?? null) !== (assignment.serverIdentity ?? null)) return
      onSelection(typeof selected.sessionId === 'string' ? selected.sessionId : null,
        typeof selected.sessionTitle === 'string' ? selected.sessionTitle : null)
    }
    webview.addEventListener('ipc-message', receive)
    return () => webview.removeEventListener('ipc-message', receive)
  }, [assignment.profileId, assignment.serverIdentity, onSelection])
  return <section className="concurrent-server-pane" data-chat-pane={pane} data-profile-id={assignment.profileId}>
    <header className="concurrent-server-pane-header">
      <div className="empty-pane-server-picker"><ServerSelector compact selectedProfileId={assignment.profileId} onChooseProfile={onChooseServer} /></div>
      {closeable && <button type="button" className="icon-button concurrent-server-pane-close"
        title={t('ui.ChatHeader.ChatHeader.close_this_chat_pane_4926598')}
        aria-label={t('ui.ChatHeader.ChatHeader.close_pane_fe2672f', { title: assignment.session?.title ?? assignment.sessionTitle ?? assignment.profileName })}
        onClick={onClose}><X size={15} /></button>}
    </header>
    <webview ref={webviewRef} key={source} className="concurrent-server-webview" src={source} />
  </section>
}
