// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'

const scope = '/interactive-chat/interactive_' + 'a'.repeat(32)
const requestId = 'synthetic-request-id'
const request = vi.fn().mockResolvedValue({ ok: true })
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.resetModules(); request.mockClear()
  vi.stubGlobal('fetch', request)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('sends only the fixed envelope and keeps dedupe markers local across reloads', async () => {
  let analytics = await import('./analytics')
  analytics.trackSharedChatEvent('shared_chat_interactive_activated', scope)
  analytics.trackSharedChatEvent('shared_chat_interactive_activated', scope)
  analytics.trackSharedChatEvent('shared_chat_message_sent', scope, requestId)
  vi.resetModules()
  analytics = await import('./analytics')
  analytics.trackSharedChatEvent('shared_chat_interactive_activated', scope)
  analytics.trackSharedChatEvent('shared_chat_message_sent', scope, requestId)
  expect(request).toHaveBeenCalledTimes(2)
  for (const [url, init] of request.mock.calls) {
    expect(url).toBe('https://api.mixpanel.com/track?ip=0')
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' })
    const [{ properties }] = JSON.parse(init.body)
    expect(Object.keys(properties).sort()).toEqual(['distinct_id', 'platform', 'time', 'token'])
    expect(properties).toMatchObject({ distinct_id: '', platform: 'shared_web' })
    expect(init.body).not.toContain(scope)
    expect(init.body).not.toContain(requestId)
  }
  expect(localStorage.length).toBe(0)
  const stored = sessionStorage.getItem('agentsdock:shared-analytics-seen:v1')!
  expect(JSON.parse(stored)).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/), expect.stringMatching(/^[a-f0-9]{64}$/)])
})

it.each(['opt-out', 'dnt', 'gpc', 'storage'] as const)('skips analytics for %s', async mode => {
  if (mode === 'opt-out') localStorage.setItem('agentsdock:analytics-consent:v1', 'denied')
  if (mode === 'dnt') Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' })
  if (mode === 'gpc') Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true })
  if (mode === 'storage') vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked') } })
  const { trackSharedChatEvent } = await import('./analytics')
  trackSharedChatEvent('shared_chat_interactive_activated', scope)
  expect(request).not.toHaveBeenCalled()
  if (mode === 'gpc') Reflect.deleteProperty(navigator, 'globalPrivacyControl')
  if (mode === 'dnt') Reflect.deleteProperty(navigator, 'doNotTrack')
})

it('rejects unknown events/scopes and isolates transport failures', async () => {
  const { trackSharedChatEvent, SHARED_CHAT_EVENTS } = await import('./analytics')
  trackSharedChatEvent('app_launched' as never, scope)
  trackSharedChatEvent('shared_chat_message_sent', scope, 'invalid')
  trackSharedChatEvent('shared_chat_interactive_activated', scope + '?token=secret')
  expect(request).not.toHaveBeenCalled()
  request.mockRejectedValueOnce(new Error('offline'))
  expect(() => trackSharedChatEvent('shared_chat_interactive_activated', scope)).not.toThrow()
  const docs = readFileSync(resolve(process.cwd(), '../docs/ANALYTICS_EVENTS.md'), 'utf8').split('## Shared-browser events')[1]
  expect([...docs.matchAll(/^\| `([a-z][a-z0-9_]+)` \|/gm)].map(match => match[1]).sort()).toEqual([...SHARED_CHAT_EVENTS].sort())
})
