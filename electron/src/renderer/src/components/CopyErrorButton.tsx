import { useState } from 'react'
import { CheckCircle2, Copy } from 'lucide-react'
import { t } from '@shared/i18n'
import { useAppStore } from '../store/app-store'
import { trackOperation } from '../lib/analytics'

/** Copy only: diagnostic commands must never execute on the client machine. */
export function CopyErrorButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return <button type="button" className="quiet-button" aria-label={t(copied ? 'runtimeError.copied' : 'runtimeError.copy')}
    title={t(copied ? 'runtimeError.copied' : 'runtimeError.copy')} onClick={async () => {
      try {
        await trackOperation('error_details_copied', () => window.agentsDock.native.writeClipboard(text))
        setCopied(true)
      } catch {
        useAppStore.getState().setError(t('runtimeError.copyFailed'))
      }
    }}>{copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}</button>
}
