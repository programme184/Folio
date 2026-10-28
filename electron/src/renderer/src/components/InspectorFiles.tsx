import { t } from '@shared/i18n'
import type { SideQuestionScope } from '@shared/side-questions'
import type { Session } from '@shared/types'
import { useLocale } from '../lib/i18n'
import { useAppStore } from '../store/app-store'
import { WorkspaceFilesHost, workspaceFilesKey } from './WorkspaceFilesContext'
import './InspectorFiles.css'

export function InspectorFiles({ session, scope }: { session: Session | null; scope: SideQuestionScope }) {
  useLocale()
  const connected = useAppStore(state => state.connected && !state.switchingProfileId)
  const available = useAppStore(state => state.health?.capabilities?.workspace_files?.available === true)
  const capabilityMessage = useAppStore(state => {
    const capability = state.health?.capabilities?.workspace_files
    return [capability?.message, capability?.action].filter(Boolean).join(' ')
  })
  const message = !session?.cwd?.trim() ? t('editor.noWorkingDirectory')
    : !connected ? t('editor.workspaceFilesWillBeAvailableAfterAgentsserverFinishesConnecting')
      : !available ? capabilityMessage || t('editor.updateAgentsserverToEnableWorkspaceFileBrowsingAndEditing') : null
  if (message || !session) return <p className="inspector-files-message">{message}</p>
  return <WorkspaceFilesHost owner={workspaceFilesKey(scope, session.id, session.cwd ?? '')} />
}
