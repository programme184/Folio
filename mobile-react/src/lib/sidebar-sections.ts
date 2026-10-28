import type { Session } from '../types'
import { isUnread } from './format'
import { notificationLevelRank, sessionAttentionLevel, type NotificationLevel } from './notification-levels'
import { compareSessions, orderedSessionSections, type SessionSection } from './session-order'
import { isWelcomeSession } from './welcome-session'

export type SidebarStatus = 'unread' | 'running'
export interface SidebarSection extends SessionSection {
  status?: SidebarStatus
  attentionLevel?: NotificationLevel
}

export function sidebarSessionStatus(session: Session, activeSessionIds: ReadonlySet<string>): SidebarStatus | null {
  if (session.archived || isWelcomeSession(session.id)) return null
  const attention = sessionAttentionLevel(session)
  if (attention === 'important' || attention === 'emergency') return 'unread'
  if (activeSessionIds.has(session.id)) return 'running'
  return isUnread(session) ? 'unread' : null
}

export function sidebarSessionSections(
  sessions: Session[],
  activeSessionIds: ReadonlySet<string>,
  folderOrder: string[],
  includeEmptyFolders: boolean,
): SidebarSection[] {
  const groups: Record<SidebarStatus, Session[]> = { unread: [], running: [] }
  const ordinary: Session[] = []
  for (const session of sessions) {
    const status = sidebarSessionStatus(session, activeSessionIds)
    if (status) groups[status].push(session)
    else ordinary.push(session)
  }
  const statusSections: SidebarSection[] = (['unread', 'running'] as const)
    .filter(status => groups[status].length > 0)
    .map(status => ({
      id: status,
      status,
      title: status === 'unread' ? 'Unread' : 'Running',
      sessions: groups[status].sort(compareSessions),
      attentionLevel: status === 'unread' ? groups.unread.reduce<NotificationLevel>((highest, session) => {
        const level = sessionAttentionLevel(session) ?? 'normal'
        return notificationLevelRank(level) > notificationLevelRank(highest) ? level : highest
      }, 'normal') : undefined,
    }))
  return [...statusSections, ...orderedSessionSections(ordinary, folderOrder, true, includeEmptyFolders)]
}
