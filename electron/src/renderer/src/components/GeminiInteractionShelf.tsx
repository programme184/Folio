import { useEffect, useRef, useState } from 'react'
import type { CodexPendingInteraction, Session } from '@shared/types'
import { t } from '@shared/i18n'
import { useLocale } from '../lib/i18n'
import { useAppStore } from '../store/app-store'
import { ProviderInteractionCard, providerInteractionShelfLabel } from './CodexInteractionShelf'
import './CodexControls.css'

/** Run-owned approval IDs are revalidated by the server. No persistent grants. */
export function GeminiInteractionShelf({ session }: { session?: Session | null }) {
  useLocale()
  const profileId = useAppStore(state => state.activeProfileId)
  const generation = useAppStore(state => state.profileGeneration)
  const connected = useAppStore(state => state.connected)
  const supported = useAppStore(state => state.health?.capabilities?.gemini_backend?.available === true)
  const [interactions, setInteractions] = useState<CodexPendingInteraction[]>([])
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const epoch = useRef(0)
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const id = session?.backend === 'gemini' ? session.id : null
  useEffect(() => {
    const owner = ++epoch.current
    setInteractions([]); setError(false); setBusy(false)
    const bridge = window.agentsDock?.gemini
    if (!id || !connected || !supported || !bridge) return
    let inFlight = false, rerun = false
    async function refresh() {
      if (inFlight) { rerun = true; return }
      inFlight = true
      try {
        do {
          rerun = false
          const next = await bridge!.runtime(id!)
          if (owner !== epoch.current) return
          setInteractions(next.pending_interactions); setError(false)
        } while (rerun && owner === epoch.current)
      } catch { if (owner === epoch.current) setError(true) }
      finally { inFlight = false }
    }
    refreshRef.current = refresh
    const unsubscribe = window.agentsDock.events.on('server:event', payload => {
      if (payload.profileId !== profileId || payload.profileGeneration !== generation || payload.event.session_id !== id) return
      if (['gemini_interaction_requested', 'gemini_interaction_resolved', 'turn_finished'].includes(payload.event.type)) void refresh()
    })
    const unsubscribeRuntime = window.agentsDock.events.on('server:provider-runtime', payload => {
      if (payload.profileId === profileId && payload.profileGeneration === generation
        && payload.event.session_id === id && payload.event.backend === 'gemini') void refresh()
    })
    void refresh()
    return () => { epoch.current++; unsubscribe(); unsubscribeRuntime(); refreshRef.current = async () => {} }
  }, [id, profileId, generation, connected, supported])
  if (!id || !connected || !supported || (!interactions.length && !error)) return null
  return <section className="codex-interaction-shelf" aria-label={providerInteractionShelfLabel('Gemini', interactions)}>
    {error && <div role="alert" className="codex-interaction-error">
      {t('connections.error.failed')}{' '}
      <button className="quiet-button" onClick={() => void refreshRef.current()}>{t('connections.refresh')}</button>
    </div>}
    <div className="codex-interaction-list">{interactions.map(interaction => <ProviderInteractionCard
      key={interaction.id} interaction={interaction} providerName="Gemini" busy={busy}
      approvalActionLabels={{ allow: t('gemini.approval.allow'), deny: t('gemini.approval.deny') }}
      onRespond={async response => {
        const owner = epoch.current
        setBusy(true); setError(false)
        try {
          await window.agentsDock.gemini!.resolveInteraction(id, interaction.id, response)
          if (owner === epoch.current) await refreshRef.current()
        } catch { if (owner === epoch.current) setError(true) }
        finally { if (owner === epoch.current) setBusy(false) }
      }}
    />)}</div>
  </section>
}
