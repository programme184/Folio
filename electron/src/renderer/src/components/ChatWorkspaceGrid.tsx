import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type PointerEvent, type ReactNode, type SetStateAction } from 'react'
import { Columns2, Columns3, Grid2X2, PanelLeft, Square } from 'lucide-react'
import type { Session, SessionSnapshot } from '@shared/types'
import { t, useLocale } from '../lib/i18n'
import { CHAT_PANE_IDS, type ChatPane as ChatPaneId, type ChatPaneCount } from '../lib/chat-panes'
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

export function ChatWorkspaceGrid({ crossServerWorkspace = null, onCrossServerWorkspaceChange = () => undefined, sidebarVisible, terminalOpen, onSidebarToggle, onTerminalToggle, sideChat, papersOpen = false, onPapersToggle, onAskPaper }: {
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
  const effectiveCount = crossServerWorkspace?.paneCount ?? count
  const effectiveFocused = crossServerWorkspace?.focusedPane ?? focused
  const active = workspaces.find(workspace => workspace.id === activeId)
  const threeColumns = effectiveCount === 3 && active?.threePaneLayout === 'columns'
  const [ratios, setRatios] = useState({
    column: (active?.columnRatio ?? 0.5) * 100, row: (active?.rowRatio ?? 0.5) * 100,
    first: (active?.threeColumnRatios?.[0] ?? 1 / 3) * 100, second: (active?.threeColumnRatios?.[1] ?? 2 / 3) * 100
  })
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
  }, [effectiveCount, threeColumns, activeId])
  useEffect(() => {
    if (crossServerWorkspace && !crossServerWorkspace.pendingProfileId
      && crossServerWorkspace.activeProfileId !== profileId) onCrossServerWorkspaceChange(null)
  }, [crossServerWorkspace, onCrossServerWorkspaceChange, profileId])

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
    onCrossServerWorkspaceChange(next)
  }
  const selectSessionForPane = async (pane: ChatPaneId, sessionId: string) => {
    const session = sessions.find(candidate => candidate.id === sessionId)
    if (!session) return
    if (crossServerWorkspace) {
      onCrossServerWorkspaceChange(current => current ? {
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
    const snapshot = useAppStore.getState().snapshots[sessionId]
    if (snapshot) onCrossServerWorkspaceChange(current => {
      const assignment = current?.panes[pane]
      return current && assignment?.profileId === profileId && assignment.session?.id === sessionId
        ? { ...current, panes: { ...current.panes, [pane]: { ...assignment, snapshot } } }
        : current
    })
  }
  return <div className="chat-grid-workspace">
    <header className="workspace-tabs-bar">
      {!sidebarVisible && <button type="button" className="icon-button" onClick={onSidebarToggle} aria-label={t('chatWorkspace.showSidebar')}><PanelLeft size={16} /></button>}
      <ChatWorkspaceTabs key={JSON.stringify([profileId, profileGeneration, serverIdentity])} />
      <div className="workspace-layout-picker" role="group" aria-label={t('chatWorkspace.layout')}>
        {([1, 2, 3, 'columns', 4] as const).map(value => <button key={value} type="button" className="icon-button"
          aria-label={value === 'columns' ? t('chatWorkspace.threeColumns') : t('chatWorkspace.paneCount', { count: value })} title={value === 'columns' ? t('chatWorkspace.threeColumns') : t('chatWorkspace.paneCount', { count: value })}
          aria-pressed={value === 'columns' ? threeColumns : effectiveCount === value && !threeColumns}
          onClick={() => {
            onCrossServerWorkspaceChange(null)
            if (value === 'columns' || value === 3) useAppStore.getState().setChatThreePaneLayout(value === 'columns' ? 'columns' : 'split')
            else useAppStore.getState().setChatPaneCount(value)
          }}>
          {value === 1 ? <Square size={15} /> : value === 2 ? <Columns2 size={15} /> : value === 'columns' ? <Columns3 size={15} /> : value === 4 ? <Grid2X2 size={15} /> : <span className="three-pane-icon" aria-hidden="true"><span /><span /><span /></span>}
        </button>)}
      </div>
    </header>
    <div ref={gridRef} className={`workspace-chat-grid chat-split-view${effectiveCount >= 3 && !threeColumns ? ' short' : ''}`} data-pane-count={effectiveCount} data-three-pane-layout={threeColumns ? 'columns' : 'split'}
      style={{ '--workspace-column': `${ratios.column}%`, '--workspace-row': `${ratios.row}%`,
        '--workspace-first-column': `${ratios.first}%`, '--workspace-second-column': `${ratios.second}%` } as CSSProperties}>
      {CHAT_PANE_IDS.slice(0, effectiveCount).map(pane => {
        const assignment = crossServerWorkspace?.panes[pane]
        const inactive = assignment && assignment.profileId !== profileId
        const sessionId = assignment ? assignment.session?.id ?? null : panes[pane]
        const session = sessions.find(candidate => candidate.id === sessionId)
        return <div key={`${pane}:${assignment?.profileId ?? profileId}:${sessionId ?? 'empty'}`} className="workspace-pane-slot" data-pane={pane}>
          {inactive ? <ConcurrentServerPane pane={pane} assignment={assignment}
            onChooseServer={targetProfileId => chooseServerForPane(pane, targetProfileId)} />
            : session ? <ChatPane pane={pane} session={session} focused={effectiveFocused === pane} split={effectiveCount > 1}
            sidebarVisible={sidebarVisible} terminalOpen={effectiveFocused === pane && terminalOpen}
            onSidebarToggle={onSidebarToggle} onTerminalToggle={onTerminalToggle} sideChat={sideChat(session)}
            papersOpen={papersOpen} onPapersToggle={onPapersToggle} onAskPaper={onAskPaper} />
            : <EmptyChatPane pane={pane} focused={effectiveFocused === pane}
              selectedProfileId={assignment?.profileId ?? profileId}
              excludedSessionIds={new Set(Object.values(crossServerWorkspace?.panes ?? {}).flatMap(candidate => candidate?.session?.id ? [candidate.session.id] : []))}
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

function EmptyChatPane({ pane, focused, selectedProfileId, excludedSessionIds, onChooseServer, onSelectSession }: {
  pane: ChatPaneId
  focused: boolean
  selectedProfileId: string | null
  excludedSessionIds: ReadonlySet<string>
  onChooseServer: (profileId: string) => void | Promise<void>
  onSelectSession: (sessionId: string) => void | Promise<void>
}) {
  const sessions = useAppStore(state => state.sessions)
  const [query, setQuery] = useState('')
  const candidates = sessions.filter(session => !session.archived && !excludedSessionIds.has(session.id)
    && `${session.title} ${session.cwd}`.toLowerCase().includes(query.toLowerCase()))
  return <section className={`empty-chat-pane${focused ? ' focused' : ''}`} data-chat-pane={pane} tabIndex={-1}
    onPointerDownCapture={() => useAppStore.getState().focusChatPane(pane)} onFocusCapture={() => useAppStore.getState().focusChatPane(pane)}>
    <div className="empty-pane-heading">
      <strong>{t('chatWorkspace.chooseChat')}</strong>
      <div className="empty-pane-server-picker"><ServerSelector compact selectedProfileId={selectedProfileId} onChooseProfile={onChooseServer} /></div>
    </div>
    <input type="search" aria-label={t('chatWorkspace.search')} placeholder={t('chatWorkspace.search')}
      value={query} onChange={event => setQuery(event.target.value)} />
    <div className="empty-pane-chat-list">
      {candidates.map(session => <button type="button" key={session.id} onClick={() => void onSelectSession(session.id)}>
        <span>{session.title}</span><small>{session.backend}</small>
      </button>)}
      {!candidates.length && <span>{t('chatWorkspace.noChats')}</span>}
    </div>
  </section>
}

function ConcurrentServerPane({ pane, assignment, onChooseServer }: {
  pane: ChatPaneId
  assignment: CrossServerPaneState
  onChooseServer: (profileId: string) => void | Promise<void>
}) {
  const source = useMemo(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('embeddedPane', '1')
    url.searchParams.set('profileId', assignment.profileId)
    if (assignment.session?.id) url.searchParams.set('sessionId', assignment.session.id)
    else url.searchParams.delete('sessionId')
    return url.toString()
  }, [assignment.profileId, assignment.session?.id])
  return <section className="concurrent-server-pane" data-chat-pane={pane} data-profile-id={assignment.profileId}>
    <header className="concurrent-server-pane-header">
      <div className="empty-pane-server-picker"><ServerSelector compact selectedProfileId={assignment.profileId} onChooseProfile={onChooseServer} /></div>
    </header>
    <webview key={source} className="concurrent-server-webview" src={source} />
  </section>
}
