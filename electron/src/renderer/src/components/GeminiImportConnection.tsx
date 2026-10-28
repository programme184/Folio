import { useState } from 'react'
import { Link2 } from 'lucide-react'
import { t } from '@shared/i18n'
import type { Session } from '@shared/types'
import { useLocale } from '../lib/i18n'
import { useAppStore } from '../store/app-store'
import { openAIProviderSettings } from '../lib/provider-settings'

/** Explicitly authorizes this history to use the selected API, never automatic. */
export function GeminiImportConnection({ session }: { session: Session }) {
  useLocale()
  const supported = useAppStore(s => s.health?.capabilities?.gemini_backend?.features?.native_import_api === true)
  const api = useAppStore(s => s.runtimeCatalog?.backends.gemini?.custom_provider)
  const connected = useAppStore(s => s.connected)
  const [saving, setSaving] = useState(false)
  if (!supported || window.agentsDock.sharedChat || session.backend !== 'gemini'
    || session.provider_connection === 'custom' || !session.session_id || session.archived) return null
  const available = api?.available === true
  const connect = async () => {
    if (saving) return
    setSaving(true)
    try { await useAppStore.getState().updateSession(session.id, { gemini_connect_api: true }) }
    finally { setSaving(false) }
  }
  return <div className="runtime-health-row compact" role="status">
    <Link2 size={16} aria-hidden="true" />
    <div><small className="runtime-detail">{available ? t('gemini.import.help', { url: api.base_url ?? '' }) : t('gemini.import.configure')}</small></div>
    <button type="button" className="quiet-button" disabled={!connected || saving}
      onClick={() => available ? void connect() : openAIProviderSettings('gemini')}>
      {saving ? t('gemini.import.connecting') : available ? t('gemini.import.connect') : t('connections.configure')}
    </button>
  </div>
}
