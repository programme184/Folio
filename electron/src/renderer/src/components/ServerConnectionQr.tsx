import { useEffect, useState } from 'react'
import { Download, LoaderCircle, X } from 'lucide-react'
import type { PublicServerProfile } from '@shared/types'
import type { ServerConnectionQr as ConnectionQr } from '@shared/server-connection-link'
import { t } from '../lib/i18n'

export function ServerConnectionQr({ profile, onClose }: { profile: PublicServerProfile; onClose(): void }) {
  const [qr, setQr] = useState<ConnectionQr | null>(null)
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let current = true
    void window.agentsDock.servers.connectionQr(profile.id).then(value => {
      if (current) setQr(value)
    }).catch(() => { if (current) setError(true) })
    return () => { current = false }
  }, [profile.id])
  const save = async () => {
    if (!qr) return
    setSaving(true)
    setSaved(false)
    setError(false)
    try { setSaved(await window.agentsDock.servers.saveConnectionQr(profile.id, qr.revision)) }
    catch { setError(true); setQr(null) }
    finally { setSaving(false) }
  }
  return <section className="server-connection-qr" aria-label={t('serverConnection.qrFor', { server: profile.name })}>
    <div className="server-management-editor-heading">
      <div><strong>{t('serverConnection.qrFor', { server: profile.name })}</strong><small>{profile.serverUrl}</small></div>
      <button type="button" className="icon-button" aria-label={t('serverConnection.closeQr')} onClick={onClose}><X size={14} /></button>
    </div>
    {error ? <p role="alert" className="server-management-error">{t('serverConnection.qrFailed')}</p>
      : !qr ? <p role="status"><LoaderCircle size={14} className="spin" /> {t('serverConnection.qrLoading')}</p> : null}
    {qr && <>
      <img src={qr.dataUrl} alt={t('serverConnection.qrFor', { server: profile.name })} width={256} height={256} />
      {qr.localOnly && <p className="server-management-warning" role="note">{t('serverConnection.localOnly')}</p>}
      <p>{t('serverConnection.qrPrivate')}</p>
      <button type="button" className="quiet-button" disabled={saving} onClick={() => void save()}>
        {saving ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />} {t('serverConnection.saveQr')}
      </button>
      {saved && <p role="status">{t('serverConnection.qrSaved')}</p>}
    </>}
  </section>
}
