import { useEffect, useState } from 'react'
import { Check, Copy, LoaderCircle } from 'lucide-react'
import type { PublicServerProfile } from '@shared/types'
import { t, useLocale } from '../lib/i18n'

export function ServerTokenRow({ profile, disabled, copying, copied, onCopy }: {
  profile: PublicServerProfile
  disabled: boolean
  copying: boolean
  copied: boolean
  onCopy(): void
}) {
  useLocale()
  const [preview, setPreview] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let current = true
    setPreview(null)
    setFailed(false)
    if (profile.hasAccessToken) {
      void window.agentsDock.servers.tokenPreview(profile.id).then(value => {
        if (current) setPreview(value)
      }).catch(() => { if (current) setFailed(true) })
    }
    return () => { current = false }
  }, [profile.id, profile.hasAccessToken])

  return <div className="server-management-token">
    <span className="server-management-section-label">{t('serverConnection.tokenLabel')}</span>
    <div className="server-management-token-field">
      <code aria-label={t('serverConnection.tokenPreviewFor', { server: profile.name })}>
        {profile.hasAccessToken ? preview ?? '••••••••' : t('serverConnection.noSavedToken')}
      </code>
      <button type="button" className="quiet-button"
        aria-label={t('serverConnection.copyTokenFor', { server: profile.name })}
        title={t(copied ? 'serverConnection.tokenCopied' : profile.hasAccessToken ? 'serverConnection.copyToken' : 'serverConnection.noSavedToken')}
        disabled={!profile.hasAccessToken || disabled} onClick={onCopy}>
        {copying ? <LoaderCircle className="spin" size={15} /> : copied ? <Check size={15} /> : <Copy size={15} />}
        {t('serverConnection.copy')}
      </button>
    </div>
    {failed && <small className="server-management-error">{t('serverConnection.previewFailed')}</small>}
  </div>
}
