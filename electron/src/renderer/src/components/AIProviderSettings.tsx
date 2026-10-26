import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { CheckCircle2, Circle, ChevronRight, LoaderCircle, RefreshCw, KeyRound } from 'lucide-react'
import { t } from '@shared/i18n'
import type { Backend } from '@shared/types'
import type { CLIAccountBackend, CLIAccountMetadata } from '@shared/provider-connections'
import { nativeProviderConnected } from '@shared/runtime-catalog'
import { useLocale } from '../lib/i18n'
import { useAppStore } from '../store/app-store'
import { CodexAuthSettings } from './CodexAuthSettings'
import { useRuntimeRecheck } from './RuntimeHealth'
import { NativeProviderSignIn } from './NativeProviderSignIn'
import { ProviderConnectionSettings } from './ProviderConnectionSettings'

const CURSOR_AUTH_MAX_CHARS = 65536

function cursorImportFailure(reason: unknown): 'invalid' | 'admin' | 'update' | 'connection' | 'failed' {
  const message = reason instanceof Error ? reason.message : String(reason ?? '')
  if (/CURSOR_AUTH_INVALID/.test(message)) return 'invalid'
  if (/CURSOR_AUTH_ADMIN/.test(message)) return 'admin'
  if (/CURSOR_AUTH_UPDATE/.test(message)) return 'update'
  if (/CURSOR_AUTH_CONNECTION/.test(message)) return 'connection'
  return 'failed'
}

function CursorCliEditor() {
  const connected = useAppStore(state => state.connected)
  const profileId = useAppStore(state => state.activeProfileId)
  const profileGeneration = useAppStore(state => state.profileGeneration)
  const fieldId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const pasteRef = useRef<HTMLTextAreaElement>(null)
  const pendingFileRef = useRef('')
  const [open, setOpen] = useState(false)
  const [hasPaste, setHasPaste] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(false)
  const [error, setError] = useState<ReturnType<typeof cursorImportFailure> | null>(null)
  const ready = connected && profileId != null && !saving

  function showFile(text: string) {
    pendingFileRef.current = text
    setError(null)
    setNotice(false)
    setOpen(true)
    setHasPaste(Boolean(text.trim()))
    if (pasteRef.current) {
      pasteRef.current.value = text
      pendingFileRef.current = ''
    }
  }

  useEffect(() => {
    if (!open || !pasteRef.current || !pendingFileRef.current) return
    pasteRef.current.value = pendingFileRef.current
    pendingFileRef.current = ''
  }, [open])

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (file.size > CURSOR_AUTH_MAX_CHARS) {
      showFile('')
      setError('invalid')
      return
    }
    showFile(await file.text())
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!ready || !profileId || !pasteRef.current) return
    const authFile = pasteRef.current.value
    pasteRef.current.value = ''
    setHasPaste(false)
    setSaving(true)
    setError(null)
    setNotice(false)
    try {
      const submit = window.agentsDock.cursor?.importAuth
      if (typeof submit !== 'function') { setError('update'); return }
      await submit({ profileId, profileGeneration }, authFile)
      setNotice(true)
      setOpen(false)
    } catch (reason) {
      setError(cursorImportFailure(reason))
    } finally {
      setSaving(false)
    }
  }

  const message = error === 'invalid' ? 'connections.cliInvalid'
    : error === 'admin' ? 'connections.cliAdmin'
      : error === 'update' ? 'connections.cliUpdate'
        : error === 'connection' ? 'connections.cliConnection'
          : 'connections.cliFailed'
  return <>
    <div className="codex-auth-settings-actions">
      <input ref={fileRef} className="codex-auth-file" type="file" accept=".json,application/json" aria-label={t('connections.cliOpen')}
        disabled={!ready} onChange={event => { void chooseFile(event) }} />
      <button type="button" className="quiet-button" disabled={!ready} onClick={() => fileRef.current?.click()}>{t('connections.cliOpen')}</button>
      <button type="button" className="quiet-button" disabled={!ready} onClick={() => { setError(null); setNotice(false); setOpen(true) }}>{t('connections.cliPaste')}</button>
    </div>
    {open && <form className="codex-auth-settings-form" onSubmit={event => { void save(event) }}>
      <label htmlFor={fieldId}>{t('connections.cliHelp')}</label>
      <textarea ref={pasteRef} id={fieldId} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        maxLength={CURSOR_AUTH_MAX_CHARS} placeholder={t('connections.cliPaste')} disabled={saving}
        onChange={event => setHasPaste(Boolean(event.currentTarget.value.trim()))} />
      <div className="codex-auth-settings-actions">
        <button type="submit" className="primary-button" disabled={!hasPaste || saving}>
          {saving && <LoaderCircle className="spin" size={14} />}{t(saving ? 'connections.cliSaving' : 'connections.cliSubmit')}
        </button>
        <button type="button" className="quiet-button" disabled={saving} onClick={() => { if (pasteRef.current) pasteRef.current.value = ''; setHasPaste(false); setOpen(false); setError(null) }}>{t('codexAuth.cancel')}</button>
      </div>
    </form>}
    {notice && <small role="status">{t('connections.cliSaved')}</small>}
    {error && <small className="codex-auth-settings-error" role="alert">{t(message)}</small>}
  </>
}

function CLIAccountCard({ backend, signedIn, open }: { backend: CLIAccountBackend; signedIn: boolean; open: boolean }) {
  const connected = useAppStore(state => state.connected)
  const profileId = useAppStore(state => state.activeProfileId)
  const profileGeneration = useAppStore(state => state.profileGeneration)
  const [account, setAccount] = useState<CLIAccountMetadata | null>(null)
  useEffect(() => {
    let cancelled = false
    setAccount(null)
    if (!open || !signedIn || !connected || !profileId) return
    const read = window.agentsDock.providerAccounts?.read
    if (read) void read({ profileId, profileGeneration }, backend).then(value => {
      if (!cancelled) setAccount(value)
    }).catch(() => { /* Optional display metadata must not invalidate working credentials. */ })
    return () => { cancelled = true }
  }, [open, signedIn, connected, profileId, profileGeneration, backend])
  return <section className={`codex-auth-settings cli-account-card ${signedIn ? 'connection-connected' : 'connection-unconfirmed'}`} aria-label={t('connections.nativeAccountLabel', { provider: { claude: 'Claude Code', cursor: 'Cursor', opencode: 'OpenCode' }[backend] })}>
    <span className="codex-auth-settings-icon">{signedIn ? <CheckCircle2 size={18} /> : <KeyRound size={17} />}</span>
    <div className="codex-auth-settings-copy">
      <div className="codex-auth-settings-heading"><strong>{t('connections.nativeLogin')}</strong></div>
      <small role="status">{t(signedIn ? 'connections.nativeDetected' : 'connections.notSignedIn')}</small>
      {signedIn && account?.email && <small>{t('connections.email')}: {account.email}</small>}
      {signedIn && account?.plan_type && <small>{t('connections.plan')}: {account.plan_type}</small>}
      {signedIn && account?.source === 'local_profile' && <small>{t('connections.cachedProfile')}</small>}
      {backend === 'cursor' && <CursorCliEditor />}
      {!signedIn && <NativeProviderSignIn backend={backend} disabled={!connected} />}
    </div>
  </section>
}

function ProviderGroup({ backend, requested }: { backend: Backend; requested?: { backend?: Backend } }) {
  const connected = useAppStore(state => state.connected)
  const profileId = useAppStore(state => state.activeProfileId)
  const profileGeneration = useAppStore(state => state.profileGeneration)
  const native = useAppStore(state => state.connected && nativeProviderConnected(state.health, state.runtimeCatalog, backend))
  const [api, setAPI] = useState(false)
  const [codexNative, setCodexNative] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => { if (requested?.backend === backend) setOpen(true) }, [requested, backend])
  const signedIn = backend === 'codex' ? codexNative || native : native
  const ready = connected && (signedIn || api)
  const name = { codex: 'Codex', claude: 'Claude Code', cursor: 'Cursor', opencode: 'OpenCode' }[backend]
  return <details open={open} className={`provider-group ${ready ? 'is-connected' : ''}`} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><ChevronRight size={16} className="provider-group-chevron" /><strong>{name}</strong>
      <span className="provider-group-status">{ready ? <CheckCircle2 size={17} /> : <Circle size={17} />}{t(ready ? 'connections.connected' : 'connections.empty')}</span>
    </summary>
    <div className="provider-group-body">
      {backend === 'codex' ? <CodexAuthSettings expanded={open} connected={connected} profileId={profileId} profileGeneration={profileGeneration} onAPIStatus={setAPI} onNativeStatus={setCodexNative} /> : <>
        <CLIAccountCard backend={backend} signedIn={signedIn} open={open} />
        <ProviderConnectionSettings expanded={open} backend={backend} connected={connected} profileId={profileId} profileGeneration={profileGeneration} onStatus={setAPI} />
      </>}
    </div>
  </details>
}

export function AIProviderSettings({ requested }: { requested?: { backend?: Backend } } = {}) {
  useLocale()
  const profile = useAppStore(state => state.profiles.find(item => item.id === state.activeProfileId))
  const generation = useAppStore(state => state.profileGeneration)
  const connected = useAppStore(state => state.connected)
  const { refreshing, recheck } = useRuntimeRecheck()
  const [revision, setRevision] = useState(0)
  return <div className="app-settings-provider-page">
    <div className="app-settings-provider-context">
      <strong>{profile ? t('settings.providersServer', { server: profile.name }) : t('settings.providersNoServer')}</strong>
      <button type="button" className="quiet-button" disabled={!connected || refreshing} onClick={() => void recheck().then(() => setRevision(value => value + 1))}><RefreshCw size={14} className={refreshing ? 'spin' : ''} />{t('connections.refresh')}</button>
    </div>
    {(['cursor', 'codex', 'claude', 'opencode'] as Backend[]).map(backend => <ProviderGroup key={`${profile?.id}:${generation}:${revision}:${backend}`} backend={backend} requested={requested} />)}
  </div>
}
