import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AgentServerClient } from './server-client'
import { codexAuthImportDocument, parseCodexAuthStatus, validateCodexApiKey } from '../shared/codex-auth'

const account = { available: true, auth_mode: 'apiKey', email: null, plan_type: null, requires_openai_auth: true }
const fakeKey = 'synthetic-key-not-a-real-credential'

async function withServer(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>, run: (url: string) => Promise<void>) {
  const server = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); void handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`) }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}

describe('native Codex account transport', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('reads the account through the exact native operator route without browser headers or generic fetch', async () => {
    const calls: Array<{ method: string | undefined; url: string | undefined; headers: IncomingMessage['headers']; body: string }> = []
    const fetch = vi.fn(() => { throw Error('generic fetch forbidden') })
    vi.stubGlobal('fetch', fetch)
    await withServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      calls.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() })
      res.end(JSON.stringify({ ...account, api_key: fakeKey, message: fakeKey }))
    }, async url => {
      const client = new AgentServerClient(`${url}/mounted`, 'synthetic-admin-token')
      try {
        expect(await client.codexAuth()).toEqual(account)
      } finally { client.dispose() }
    })
    expect(calls.map(item => [item.method, item.url])).toEqual([
      ['GET', '/mounted/api/admin/codex/auth']
    ])
    expect(calls[0].body).toBe('')
    for (const call of calls) {
      expect(call.headers['x-agentsdock-token']).toBe('synthetic-admin-token')
      for (const header of ['origin', 'cookie', 'sec-fetch-mode', 'authorization']) expect(call.headers[header]).toBeUndefined()
      expect(call.url).not.toContain(fakeKey)
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects the removed credential-mutation route before contacting even a legacy server', async () => {
    const handler = vi.fn((_req: IncomingMessage, res: ServerResponse) => { res.end(JSON.stringify(account)) })
    await withServer(handler, async url => {
      const client = new AgentServerClient(url, 'synthetic-token')
      try {
        expect(client).not.toHaveProperty('codexLoginWithApiKey')
        await expect((client as unknown as {
          privilegedNativeRequest(path: string, init: RequestInit): Promise<unknown>
        }).privilegedNativeRequest('/api/admin/codex/auth/api-key', {
          method: 'POST', body: JSON.stringify({ api_key: fakeKey })
        })).rejects.toThrow('Privileged native control route is invalid')
      } finally { client.dispose() }
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('reloads sign-in only through the separate native POST, never the catalog', async () => {
    const calls: string[] = []
    await withServer(async (req, res) => {
      calls.push(`${req.method} ${req.url}`)
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      expect(Buffer.concat(chunks).toString()).toBe('{}')
      expect(req.headers['x-agentsdock-token']).toBe('synthetic-admin-token')
      for (const header of ['origin', 'cookie', 'sec-fetch-mode', 'authorization']) expect(req.headers[header]).toBeUndefined()
      res.end(JSON.stringify({ ...account, login_reload_available: true, login_reload_pending: true }))
    }, async url => {
      const client = new AgentServerClient(url, 'synthetic-admin-token')
      try {
        expect(await client.codexAuth(true)).toEqual({ ...account, login_reload_available: true, login_reload_pending: true })
      } finally { client.dispose() }
    })
    expect(calls).toEqual(['POST /api/admin/codex/auth/reload'])
  })

  it.each([[400, 'INVALID_KEY'], [401, 'ADMIN'], [403, 'ADMIN'], [404, 'UPDATE'], [405, 'UPDATE'],
    [409, 'BUSY'], [422, 'INVALID_KEY'], [500, 'FAILED'], [501, 'UPDATE'], [502, 'FAILED']])(
    'sanitizes HTTP %s including echoed secrets and does not retry', async (status, code) => {
      let count = 0
      await withServer((_req, res) => { count++; res.statusCode = Number(status); res.end(JSON.stringify({ detail: fakeKey })) }, async url => {
        const client = new AgentServerClient(url, 'synthetic-token')
        try {
          await expect(client.codexAuth()).rejects.toThrow(`CODEX_AUTH_${code}`)
        } finally { client.dispose() }
      })
      expect(count).toBe(1)
    }
  )

  it('never follows a redirect with the secret', async () => {
    let destinationCalls = 0
    await withServer((_req, res) => { destinationCalls++; res.end(JSON.stringify(account)) }, async destination => {
      await withServer((_req, res) => { res.writeHead(307, { Location: destination }); res.end() }, async url => {
        const client = new AgentServerClient(url, 'synthetic-token')
        try { await expect(client.codexAuth()).rejects.toThrow('CODEX_AUTH_FAILED') }
        finally { client.dispose() }
      })
    })
    expect(destinationCalls).toBe(0)
  })

  it('does not forward malformed provider data or account secrets', () => {
    expect(parseCodexAuthStatus({ ...account, email: fakeKey, plan_type: fakeKey, token: fakeKey })).toEqual(account)
    for (const value of [null, [], { ...account, auth_mode: fakeKey }, { ...account, auth_mode: ['apiKey'] }, { ...account, available: 1 },
      { ...account, login_reload_available: 'true' }, { ...account, login_reload_pending: 1 }]) {
      expect(() => parseCodexAuthStatus(value)).toThrow('CODEX_AUTH_RESPONSE')
    }
  })

  it.each([null, undefined, 42, {}, '', ' ', 'one\ntwo', 'one\u0000two', 'x'.repeat(4097)])(
    'rejects malformed input without echoing it', value => {
      expect(() => validateCodexApiKey(value)).toThrow('CODEX_AUTH_INVALID_KEY')
    }
  )

  it('keeps Codex oauth provenance and the cc-switch marker without echoing a bad authority', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({
      sub: 'auth0|synthetic',
      'https://api.openai.com/auth': { chatgpt_account_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }
    })).toString('base64url')
    const jwt = `${header}.${payload}.e30`
    const document = {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: 'PROXY_MANAGED',
      tokens: {
        access_token: jwt,
        refresh_token: 'rt.synthetic-refresh-token-not-a-real-credential',
        oauth_provenance: { issuer: 'https://auth.openai.com', client_id: 'app_EMoamEEZ73f0CkXaXp7hrann' },
        login_owner_id: 'synthetic-login-owner-id-value1',
        account_id: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'
      },
      last_refresh: '2026-10-28T07:26:28.814135100Z'
    }
    expect(codexAuthImportDocument(JSON.stringify(document))).toEqual({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        access_token: jwt,
        refresh_token: document.tokens.refresh_token,
        oauth_provenance: document.tokens.oauth_provenance,
        login_owner_id: document.tokens.login_owner_id,
        account_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
      },
      last_refresh: document.last_refresh
    })
    const hostile = structuredClone(document)
    hostile.tokens.oauth_provenance = { issuer: 'https://evil.example', client_id: 'app_EMoamEEZ73f0CkXaXp7hrann' }
    expect(() => codexAuthImportDocument(JSON.stringify(hostile))).toThrow('CODEX_AUTH_INVALID')
  })
})
