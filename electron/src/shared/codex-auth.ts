import type { CodexAuthStatus } from './types'

export const CODEX_AUTH_IMPORT_MAX_CHARS = 32 * 1024

export interface CodexChatGPTAuthImport {
  auth_mode: 'chatgpt'
  OPENAI_API_KEY: null
  tokens: {
    id_token?: string
    access_token: string
    refresh_token: string
    oauth_provenance?: { issuer: string, client_id: string }
    login_owner_id?: string
    account_id: string
  }
  last_refresh?: string
}

const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const REFRESH_TOKEN = /^[A-Za-z0-9._~-]{20,2048}$/
const LAST_REFRESH = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/
const OAUTH_ISSUER = /^https:\/\/auth\.(?:openai\.com|api\.openai\.org)$/
const OAUTH_CLIENT_ID = /^app_[A-Za-z0-9]{10,64}$/
const LOGIN_OWNER_ID = /^[A-Za-z0-9_-]{16,128}$/

function invalid(): never {
  throw new Error('CODEX_AUTH_INVALID')
}

function jwtPayload(token: unknown): Record<string, unknown> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 8192) invalid()
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some(part => !part || !/^[A-Za-z0-9_-]+$/.test(part))) invalid()
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) invalid()
    return payload as Record<string, unknown>
  } catch (error) {
    if (error instanceof Error && error.message === 'CODEX_AUTH_INVALID') throw error
    invalid()
  }
}

function claimedAccount(payload: Record<string, unknown>): string | null {
  const details = payload['https://api.openai.com/auth']
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const account = (details as Record<string, unknown>).chatgpt_account_id
  if (account == null) return null
  if (typeof account !== 'string' || !ACCOUNT_ID.test(account.toLowerCase())) invalid()
  return account.toLowerCase()
}

function oauthProvenance(tokens: Record<string, unknown>): { issuer: string, client_id: string } | undefined {
  if (!('oauth_provenance' in tokens)) return undefined
  const raw = tokens.oauth_provenance
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid()
  const record = raw as Record<string, unknown>
  if (Object.keys(record).length !== 2 || typeof record.issuer !== 'string' || typeof record.client_id !== 'string') invalid()
  if (!OAUTH_ISSUER.test(record.issuer) || !OAUTH_CLIENT_ID.test(record.client_id)) invalid()
  return { issuer: record.issuer, client_id: record.client_id }
}

function loginOwnerId(tokens: Record<string, unknown>): string | undefined {
  if (!('login_owner_id' in tokens)) return undefined
  const owner = tokens.login_owner_id
  if (typeof owner !== 'string' || !LOGIN_OWNER_ID.test(owner)) invalid()
  return owner
}

export function codexAuthImportDocument(value: unknown): CodexChatGPTAuthImport {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > CODEX_AUTH_IMPORT_MAX_CHARS) invalid()
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { invalid() }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalid()
  const item = parsed as Record<string, unknown>
  if (item.auth_mode != null && item.auth_mode !== 'chatgpt') invalid()
  // cc-switch writes this non-secret marker while keeping the ChatGPT bundle.
  if ('OPENAI_API_KEY' in item && item.OPENAI_API_KEY != null && item.OPENAI_API_KEY !== 'PROXY_MANAGED') invalid()
  const tokens = item.tokens
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) invalid()
  const tokenRecord = tokens as Record<string, unknown>
  if (typeof tokenRecord.account_id !== 'string' || !ACCOUNT_ID.test(tokenRecord.account_id.toLowerCase())) invalid()
  if (typeof tokenRecord.refresh_token !== 'string' || !REFRESH_TOKEN.test(tokenRecord.refresh_token)) invalid()
  const account = tokenRecord.account_id.toLowerCase()
  if (typeof tokenRecord.access_token !== 'string') invalid()
  for (const field of ['id_token', 'access_token'] as const) {
    if (field === 'id_token' && !(field in tokenRecord)) continue
    const claimed = claimedAccount(jwtPayload(tokenRecord[field]))
    if (claimed && claimed !== account) invalid()
  }
  const provenance = oauthProvenance(tokenRecord)
  const owner = loginOwnerId(tokenRecord)
  const lastRefresh = typeof item.last_refresh === 'string' && LAST_REFRESH.test(item.last_refresh)
    ? item.last_refresh.endsWith('+00:00') ? `${item.last_refresh.slice(0, -6)}Z` : item.last_refresh
    : undefined
  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      ...(typeof tokenRecord.id_token === 'string' ? { id_token: tokenRecord.id_token } : {}),
      access_token: tokenRecord.access_token,
      refresh_token: tokenRecord.refresh_token,
      ...(provenance ? { oauth_provenance: provenance } : {}),
      ...(owner ? { login_owner_id: owner } : {}),
      account_id: account
    },
    ...(lastRefresh ? { last_refresh: lastRefresh } : {})
  }
}

export function validateCodexApiKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('CODEX_AUTH_INVALID_KEY')
  const key = value.trim()
  // Validate shape only. Codex owns authentication; do not assume a key prefix
  // or claim that storing a key verifies API billing/model access.
  if (!key || key.length > 4096 || /[^\x21-\x7e]/.test(key)) {
    throw new Error('CODEX_AUTH_INVALID_KEY')
  }
  return key
}

export function parseCodexAuthStatus(value: unknown): CodexAuthStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CODEX_AUTH_RESPONSE')
  const item = value as Record<string, unknown>
  if (typeof item.available !== 'boolean' || typeof item.requires_openai_auth !== 'boolean'
    || typeof item.auth_mode !== 'string' || !['apiKey', 'chatgpt', 'other', 'none'].includes(item.auth_mode)) {
    throw new Error('CODEX_AUTH_RESPONSE')
  }
  const label = (field: string): string | null => {
    const text = item[field]
    if (text == null) return null
    if (typeof text !== 'string' || text.length > 320 || /[\x00-\x1f\x7f]/.test(text)) {
      throw new Error('CODEX_AUTH_RESPONSE')
    }
    return text
  }
  // Pick fields rather than forwarding a provider response, even for errors.
  // In API-key mode there is no email/plan to expose.
  for (const field of ['login_reload_available', 'login_reload_pending']) {
    if (item[field] !== undefined && typeof item[field] !== 'boolean') throw new Error('CODEX_AUTH_RESPONSE')
  }
  return {
    ...(item.login_reload_available !== undefined ? { login_reload_available: item.login_reload_available as boolean } : {}),
    ...(item.login_reload_pending !== undefined ? { login_reload_pending: item.login_reload_pending as boolean } : {}),
    available: item.available,
    auth_mode: item.auth_mode as CodexAuthStatus['auth_mode'],
    email: item.auth_mode === 'chatgpt' ? label('email') : null,
    plan_type: item.auth_mode === 'chatgpt' ? label('plan_type') : null,
    requires_openai_auth: item.requires_openai_auth,
  }
}
