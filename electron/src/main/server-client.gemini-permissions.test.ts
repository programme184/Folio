import { afterEach, expect, it, vi } from 'vitest'
import { AgentServerClient } from './server-client'

afterEach(() => vi.unstubAllGlobals())
it.each(['default', 'custom'] as const)('sends native Gemini permission IDs for the %s connection', async connection => {
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ session: { id: 'g', backend: 'gemini', gemini_permission_mode: 'autoEdit' } }), { status: 200 })
  }))
  const client = new AgentServerClient('http://example.test', 'fixture-token')
  await client.createSession({ title: 'G', folder: 'General', cwd: '/work', backend: 'gemini', provider_connection: connection, gemini_permission_mode: 'autoEdit' })
  await client.updateSession('g', { gemini_permission_mode: 'plan' })
  expect(bodies[0]).toMatchObject({ backend: 'gemini', provider_connection: connection, gemini_permission_mode: 'autoEdit' })
  expect(bodies[1]).toEqual({ gemini_permission_mode: 'plan' })
  client.dispose()
})
