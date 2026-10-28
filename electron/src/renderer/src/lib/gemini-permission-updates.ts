import { t } from '@shared/i18n'
import type { GeminiPermissionMode } from '@shared/types'
import { useAppStore } from '../store/app-store'

const pending = new Map<string, Promise<void>>()

export function queueGeminiPermissionUpdate(id: string, mode: GeminiPermissionMode): Promise<void> {
  const scope = useAppStore.getState()
  const operation = (pending.get(id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const current = useAppStore.getState()
    if (current.activeProfileId !== scope.activeProfileId || current.profileGeneration !== scope.profileGeneration) {
      throw new Error(t('gemini.permissions.notSaved'))
    }
    await current.updateSession(id, { gemini_permission_mode: mode }, { allowDuringWorkspaceFlush: true })
    const updated = useAppStore.getState()
    if (updated.activeProfileId !== scope.activeProfileId || updated.profileGeneration !== scope.profileGeneration
      || updated.sessions.find(session => session.id === id)?.gemini_permission_mode !== mode) {
      throw new Error(updated.error || t('gemini.permissions.notSaved'))
    }
  })
  const tracked = operation.finally(() => { if (pending.get(id) === tracked) pending.delete(id) })
  pending.set(id, tracked)
  void tracked.catch(() => undefined)
  return operation
}

export function awaitGeminiPermissionUpdates(id: string): Promise<void> {
  return pending.get(id) ?? Promise.resolve()
}

export async function awaitAllGeminiPermissionUpdates(): Promise<void> {
  while (pending.size) await Promise.all([...pending.values()])
}
