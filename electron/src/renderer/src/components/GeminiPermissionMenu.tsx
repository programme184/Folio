import { useEffect, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ChevronDown, Shield, X } from 'lucide-react'
import { t } from '@shared/i18n'
import type { GeminiPermissionMode, Session } from '@shared/types'
import { useLocale } from '../lib/i18n'
import { queueGeminiPermissionUpdate } from '../lib/gemini-permission-updates'
import { useAppStore } from '../store/app-store'

const known: GeminiPermissionMode[] = ['default', 'autoEdit', 'yolo', 'plan']
const labels = { default: 'gemini.permissions.default', autoEdit: 'gemini.permissions.autoEdit', yolo: 'gemini.permissions.yolo', plan: 'gemini.permissions.plan' } as const
const hints = { default: 'gemini.permissions.defaultHint', autoEdit: 'gemini.permissions.autoEditHint', yolo: 'gemini.permissions.yoloHint', plan: 'gemini.permissions.planHint' } as const
const clean = (value: unknown): GeminiPermissionMode[] => Array.isArray(value) ? known.filter(mode => value.includes(mode)) : []

export function GeminiPermissionMenu({ session, running, open: controlledOpen, onOpenChange }: {
  session: Session; running: boolean; open?: boolean; onOpenChange?: (open: boolean) => void
}) {
  useLocale()
  const capability = useAppStore(state => state.health?.capabilities?.gemini_backend)
  const profile = useAppStore(state => state.activeProfileId)
  const generation = useAppStore(state => state.profileGeneration)
  const [internalOpen, setInternalOpen] = useState(false)
  const [modes, setModes] = useState<GeminiPermissionMode[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmYolo, setConfirmYolo] = useState(false)
  const epoch = useRef(0)
  const selectRef = useRef<HTMLSelectElement>(null)
  const restoreFocus = useRef(false)
  const open = controlledOpen ?? internalOpen
  const supported = capability?.available === true && capability.features?.permission_mode_control === true
    && !window.agentsDock?.sharedChat
  const mode = session.gemini_permission_mode ?? 'default'
  const options = modes.length ? modes : clean(session.gemini_permission_modes ?? capability?.permission_modes)
  const setOpen = (next: boolean) => { setInternalOpen(next); onOpenChange?.(next); if (!next) setConfirmYolo(false) }

  useEffect(() => {
    epoch.current++; setSaving(false); setError(''); setModes([]); setConfirmYolo(false); setOpen(false)
    return () => { epoch.current++ }
  }, [session.id, profile, generation])
  useEffect(() => {
    if (!open || !supported || !window.agentsDock?.gemini) return
    let disposed = false
    void window.agentsDock.gemini.runtime(session.id).then(value => {
      if (!disposed) setModes(clean(value.permission_modes))
    }).catch(() => { /* Keep the last advertised options; sending still validates the native policy. */ })
    return () => { disposed = true }
  }, [open, supported, running, session.id, profile, generation])
  useEffect(() => {
    if (restoreFocus.current && !confirmYolo && !saving) {
      restoreFocus.current = false
      selectRef.current?.focus()
    }
  }, [confirmYolo, saving])

  const apply = async (next: GeminiPermissionMode) => {
    if (saving || !supported || !options.includes(next) || next === mode) return
    const owner = epoch.current
    restoreFocus.current = confirmYolo
    setSaving(true); setError(''); setConfirmYolo(false)
    try { await queueGeminiPermissionUpdate(session.id, next) }
    catch (cause) { if (owner === epoch.current) setError(cause instanceof Error ? cause.message : t('gemini.permissions.notSaved')) }
    finally { if (owner === epoch.current) setSaving(false) }
  }
  return <Popover.Root open={supported && open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <button type="button" className="codex-permission-chip" disabled={!supported}
        aria-label={t('gemini.permissions.button', { mode: t(labels[mode]) })}
        title={supported ? t('gemini.permissions.title') : t('gemini.permissions.updateServer')}>
        <Shield size={14} aria-hidden="true" /><span className="codex-permission-primary">{t(labels[mode])}</span><ChevronDown size={12} aria-hidden="true" />
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="codex-permission-popover" side="top" align="start" sideOffset={8}
        aria-labelledby="gemini-permission-title" aria-describedby="gemini-permission-description">
        <header>
          <span className="codex-permission-popover-icon"><Shield size={16} aria-hidden="true" /></span>
          <div><h3 id="gemini-permission-title">{t('gemini.permissions.title')}</h3>
            <p id="gemini-permission-description">{t('gemini.permissions.nextTurn')}</p></div>
          <div className="codex-permission-popover-actions">
            <span role="status" aria-live="polite">{saving ? t('gemini.permissions.saving') : ''}</span>
            <Popover.Close asChild><button type="button" className="codex-permission-popover-close" aria-label={t('gemini.permissions.close')}><X size={14} aria-hidden="true" /></button></Popover.Close>
          </div>
        </header>
        <div className="codex-permission-fields claude-permission-fields"><label>
          <span>{t('gemini.permissions.mode')}</span>
          <select ref={selectRef} value={mode} disabled={saving} onChange={event => {
            const next = event.target.value as GeminiPermissionMode
            if (next === 'yolo' && mode !== 'yolo') setConfirmYolo(true)
            else { setConfirmYolo(false); void apply(next) }
          }}>
            {!options.includes(mode) && <option value={mode} disabled>{t(labels[mode])}</option>}
            {options.map(value => <option key={value} value={value}>{t(labels[value])}</option>)}
          </select>
        </label></div>
        <p className="codex-permission-hint">{t(hints[mode])}</p>
        {!options.includes('plan') && <p className="codex-permission-hint">{t('gemini.permissions.planAvailability')}</p>}
        {running && <p className="codex-permission-hint">{t('gemini.permissions.running')}</p>}
        {confirmYolo && <div role="group" aria-label={t('gemini.permissions.yoloConfirm')}>
          <p className="codex-permission-error">{t('gemini.permissions.yoloHint')}</p>
          <button type="button" className="quiet-button" onClick={() => { restoreFocus.current = true; setConfirmYolo(false) }}>{t('gemini.permissions.cancel')}</button>{' '}
          <button type="button" className="quiet-button" onClick={() => void apply('yolo')}>{t('gemini.permissions.yoloConfirm')}</button>
        </div>}
        {error && <p className="codex-permission-error" role="alert">{error}</p>}
        <Popover.Arrow className="codex-permission-arrow" />
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}
