import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { createStoredServerProfile, applyStoredServerProfileUpdate, normalizeStoredProfileSettings } from '../lib/server-profiles'
import { profileTokenKey, loadProfileToken, saveWorkspacePreferences } from '../storage/cache'

const routes = [{ status: 503, identity: 'server-fixture' }, { status: 200, identity: 'server-fixture' }]
const requests: Array<{ route: number; path: string }> = []
const servers: Server[] = []
const originalInterval = globalThis.setInterval
try {
  const urls: string[] = []
  for (let index = 0; index < routes.length; index++) {
    const server = createServer((request, response) => {
      assert.equal(request.headers['x-zenithdock-token'], 'fixture-token')
      const path = request.url ?? ''
      requests.push({ route: index, path })
      const status = path === '/api/health' ? routes[index].status : 200
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(path === '/api/health'
        ? { ok: status === 200, server_identity: routes[index].identity, api_contract_version: 9, active_sessions: [], capabilities: {} }
        : path.startsWith('/api/sessions') ? { sessions: [] } : path.startsWith('/api/jobs') ? { jobs: [] } : {}))
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    urls.push(`http://127.0.0.1:${address.port}`)
  }
  const profile = createStoredServerProfile({ serverURL: urls[0], serverURLs: urls, serverIdentity: 'server-fixture' }, 'fixture-profile')
  assert.deepEqual(profile.serverURLs, urls)
  assert.equal(applyStoredServerProfileUpdate(profile, { serverURL: 'http://new.example' }).serverURLs, undefined)
  assert.equal(applyStoredServerProfileUpdate(profile, { resetServerIdentity: true }).serverURLs, undefined)
  assert.deepEqual(applyStoredServerProfileUpdate(profile, { name: 'Renamed' }).serverURLs, urls)
  const settings = { schemaVersion: 2, activeProfileId: profile.id, profiles: [profile], fontScale: 1 }
  assert.deepEqual(normalizeStoredProfileSettings(settings).profiles[0].serverURLs, urls)
  await AsyncStorage.clear()
  await AsyncStorage.setItem('agentsdock.react.settings.v2', JSON.stringify(settings))
  await SecureStore.setItemAsync(profileTokenKey(profile.id, 1), 'fixture-token')
  await saveWorkspacePreferences('server-fixture', { selectedSessionId: null, folderOrder: ['Work'], collapsedFolders: [], drafts: { chat: 'Keep my draft' } })
  globalThis.setInterval = (() => 1) as unknown as typeof setInterval
  const { useAppStore } = await import('./useAppStore')
  await useAppStore.getState().initialize()
  assert.equal(useAppStore.getState().connected, true)
  assert.equal(useAppStore.getState().serverURL, urls[1])
  assert.equal(useAppStore.getState().activeProfileId, profile.id)
  assert.equal(useAppStore.getState().profiles.length, 1)
  assert.equal(useAppStore.getState().drafts.chat, 'Keep my draft')
  const saved = JSON.parse((await AsyncStorage.getItem('agentsdock.react.settings.v2'))!)
  assert.equal(saved.profiles[0].serverURL, urls[1])
  assert.deepEqual(saved.profiles[0].serverURLs, urls)
  assert.equal(await loadProfileToken(profile.id, 1), 'fixture-token')

  routes[1].status = 503
  routes[0].status = 200
  await useAppStore.getState().reconnect()
  assert.equal(useAppStore.getState().connected, true)
  assert.equal(useAppStore.getState().serverURL, urls[0])
  assert.equal(useAppStore.getState().drafts.chat, 'Keep my draft')

  routes[0].identity = 'foreign-server'
  routes[1].status = 200
  const requestStart = requests.length
  await useAppStore.getState().reconnect()
  assert.equal(useAppStore.getState().serverURL, urls[1])
  assert.equal(useAppStore.getState().connected, true)
  assert.ok(requests.slice(requestStart).filter(value => value.route === 0).every(value => !value.path.startsWith('/api/sessions')), 'foreign identities must never receive new session requests')

  routes[0].status = 503
  routes[1].status = 503
  await useAppStore.getState().reconnect()
  assert.equal(useAppStore.getState().connected, false)
  assert.match(useAppStore.getState().error!, /any server address/)
  assert.equal(useAppStore.getState().serverURL, urls[1])
  assert.equal(useAppStore.getState().profiles.length, 1)
  assert.equal(useAppStore.getState().drafts.chat, 'Keep my draft')
  routes[0].identity = 'server-fixture'
  routes[0].status = 200
  await useAppStore.getState().reconnect()
  assert.equal(useAppStore.getState().connected, true)
  assert.equal(useAppStore.getState().serverURL, urls[0])
  console.log('saved-address fallback, return roaming, identity isolation, persistence and recovery passed over real HTTP')
} finally {
  globalThis.setInterval = originalInterval
  for (const server of servers) {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
