import assert from 'node:assert/strict'
import { createServer, type Server, type ServerResponse } from 'node:http'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { normalizeStoredProfileSettings } from '../lib/server-profiles'
import { loadCachedSessions, loadProfileSettings, loadProfileToken, loadWorkspacePreferences, saveCachedSessions } from '../storage/cache'
import type { Session } from '../types'

const settingsKey = 'agentsdock.react.settings.v2'
const servers: Server[] = []
const requests: Array<{ server: number; method: string; path: string }> = []
const routes = [{ online: true, holdSessions: false }, { online: true, holdSessions: false }]
const pendingSessions: ServerResponse[] = []
const originalInterval = globalThis.setInterval
const originalSetItem = AsyncStorage.setItem

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for server removal fixture')
}

try {
  const urls: string[] = []
  for (let index = 0; index < routes.length; index++) {
    const server = createServer((request, response) => {
      assert.equal(request.headers['x-zenithdock-token'], 'removal-fixture-token')
      const path = request.url ?? ''
      requests.push({ server: index, method: request.method ?? '', path })
      if (path.startsWith('/api/sessions') && routes[index].holdSessions) {
        pendingSessions.push(response)
        return
      }
      const status = routes[index].online ? 200 : 503
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(path === '/api/health'
        ? { ok: status === 200, server_identity: `removal-server-${index}`, api_contract_version: 9, active_sessions: index === 0 ? ['running-chat'] : [], capabilities: {} }
        : path.startsWith('/api/sessions') ? { sessions: [] } : path.startsWith('/api/jobs') ? { jobs: [] } : {}))
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    urls.push(`http://127.0.0.1:${address.port}`)
  }
  await AsyncStorage.clear()
  const empty = { schemaVersion: 2 as const, activeProfileId: null, profiles: [], fontScale: 1.1 }
  assert.deepEqual(normalizeStoredProfileSettings(empty), empty)
  await AsyncStorage.setItem(settingsKey, JSON.stringify(empty))
  globalThis.setInterval = (() => 1) as unknown as typeof setInterval
  const { useAppStore } = await import('./useAppStore')
  const get = useAppStore.getState
  await get().initialize()
  assert.equal(get().initialized, true)
  assert.equal(get().activeProfileId, null)
  assert.equal(get().error, null)
  assert.equal(get().fontScale, 1.1)
  assert.equal(requests.length, 0, 'an empty installation must not contact a default server')

  const add = (index: number, setActive = true) => get().createServerProfile({
    name: `Removal fixture ${index}`, serverURL: urls[index], accessToken: 'removal-fixture-token', setActive,
  })
  const first = await add(0)
  await get().reconnect()
  assert.equal(get().connected, true)
  const inactive = await add(1, false)
  const firstGeneration = get().profileGeneration
  await get().removeServerProfile(inactive)
  assert.equal(get().activeProfileId, first)
  assert.equal(get().profileGeneration, firstGeneration, 'removing an inactive profile must not reconnect the current one')
  assert.equal(await loadProfileToken(inactive, 1), '')

  const second = await add(1, false)
  useAppStore.setState({ drafts: { 'running-chat': 'Preserve the unsent draft' }, folderOrder: ['Work'] })
  const cachedSession: Session = { id: 'running-chat', title: 'Running fixture', backend: 'codex' }
  await saveCachedSessions('removal-server-0', [cachedSession])

  // A failed durable write must not detach or discard the saved credential.
  const durableBefore = await AsyncStorage.getItem(settingsKey)
  AsyncStorage.setItem = async (key, value) => {
    if (key === settingsKey) throw new Error('Synthetic profile storage failure')
    return originalSetItem(key, value)
  }
  await assert.rejects(get().removeServerProfile(first), /Synthetic profile storage failure/)
  AsyncStorage.setItem = originalSetItem
  assert.equal(get().activeProfileId, first)
  assert.equal(get().profileGeneration, firstGeneration)
  assert.equal(get().connected, true)
  assert.equal(await AsyncStorage.getItem(settingsKey), durableBefore)
  assert.equal(await loadProfileToken(first, 1), 'removal-fixture-token')
  assert.equal(get().profiles.length, 2)

  routes[0].holdSessions = true
  const staleRead = get().refreshSessions()
  await until(() => pendingSessions.length > 0)
  useAppStore.setState({ activeSessionIds: new Set(['running-chat']), sendingSessionIds: new Set(['running-chat']), turnAdmissionTokens: { 'running-chat': 'pending-admission' } })
  await get().removeServerProfile(first)
  await get().reconnect()
  assert.equal(get().activeProfileId, second)
  assert.equal(get().connected, true)
  assert.equal(get().profiles.length, 1)
  assert.ok(get().profileGeneration > firstGeneration)
  assert.equal(get().sendingSessionIds.size, 0)
  assert.equal(await loadProfileToken(first, 1), '')
  assert.equal(await loadProfileToken(second, 1), 'removal-fixture-token')
  assert.equal((await loadProfileSettings()).activeProfileId, second)
  assert.equal((await loadWorkspacePreferences('removal-server-0')).drafts['running-chat'], 'Preserve the unsent draft')
  assert.equal((await loadCachedSessions('removal-server-0'))[0].id, 'running-chat')
  for (const response of pendingSessions) response.end(JSON.stringify({ sessions: [cachedSession] }))
  await staleRead
  assert.deepEqual(get().sessions, [], 'a late response from the removed server must not repopulate the new workspace')

  routes[1].online = false
  await get().reconnect()
  assert.equal(get().connected, false)
  useAppStore.setState({ drafts: { chat: 'Keep the last workspace' }, searchResults: [
    { session_id: 'chat', event_id: 'old-result', seq: 1, role: 'assistant', snippet: 'Cached search result' },
  ] })
  const beforeLastRemoval = requests.length
  await get().removeServerProfile(second)
  assert.equal(requests.length, beforeLastRemoval, 'last-profile removal is entirely local, even offline')
  assert.equal(get().activeProfileId, null)
  assert.equal(get().switchingProfileId, null)
  assert.equal(get().serverConfigured, false)
  assert.equal(get().token, '')
  assert.equal(get().health, null)
  assert.equal(get().runtime, null)
  assert.equal(get().connected, false)
  assert.equal(get().connecting, false)
  assert.equal(get().syncStatus, 'idle')
  assert.equal(get().error, null)
  assert.deepEqual(get().profiles, [])
  assert.deepEqual(get().sessions, [])
  assert.deepEqual(get().searchResults, [])
  assert.deepEqual(get().drafts, {})
  assert.equal(await loadProfileToken(second, 1), '')
  assert.deepEqual(await loadProfileSettings(), empty)
  await get().reorderServerProfiles([])
  useAppStore.setState({ initialized: false })
  await get().initialize()
  assert.equal(get().error, null)
  assert.equal(get().activeProfileId, null)
  await get().reconnect()
  assert.equal(requests.length, beforeLastRemoval, 'reopening an empty installation must not restore the removed profile')
  get().setFontScale(1.2)
  await until(() => get().fontScale === 1.2)
  // Serialize behind the preference save before checking durable empty settings.
  await get().reorderServerProfiles([])
  assert.equal((await loadProfileSettings()).fontScale, 1.2)

  routes[1].online = true
  const restored = await add(1)
  await get().reconnect()
  assert.equal(get().activeProfileId, restored)
  assert.equal(get().connected, true)
  assert.equal(get().drafts.chat, 'Keep the last workspace')
  assert.equal(get().profiles.length, 1)
  assert.ok(requests.every(request => request.method === 'GET'), 'removing and re-adding connections must not stop tasks or delete server chats')
  await get().removeServerProfile(restored)
  console.log('server removal: active/inactive/last/offline, storage failure, late response, busy state, credentials, cache, empty startup and re-add passed')
} finally {
  AsyncStorage.setItem = originalSetItem
  globalThis.setInterval = originalInterval
  for (const server of servers) {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
