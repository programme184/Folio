import assert from 'node:assert/strict'
import { AppState as NativeAppState } from 'react-native'
import { SNAPSHOT_CACHE_VERSION } from '../lib/history'
import type { Event, Session, Snapshot, TimelinePage } from '../types'
import { client, useAppStore } from './useAppStore'

const appState = NativeAppState as typeof NativeAppState & { __emitAppState(state: string): void }
const session: Session = { id: 'latest-first', title: 'Long chat', backend: 'claude', latest_event_seq: 10_000, last_read_agent_event_seq: 10_000 }
const event = (seq: number): Event => ({ id: `event-${seq}`, session_id: session.id, seq, type: 'assistant_text', text: `Reply ${seq}`, ts: '2026-10-14T00:00:00Z' })
const cached: Snapshot = { cacheVersion: SNAPSHOT_CACHE_VERSION, session, events: [event(10)], queuedTurns: [], files: [], filesTotal: 0, latestSeq: 10, hasMore: true, nextBefore: 10, semanticPaging: true, cachedAt: 1 }
const tail: TimelinePage = { session, events: [event(9_999), event(10_000)], queued_turns: [], has_more: true, before: 9_999, next_before: 9_999, total: 10_000, latest_seq: 10_000, semantic_paging: true }
const original = { page: client.sessionPage, stream: client.stream, files: client.files, read: client.markRead }
const requests: Parameters<typeof client.sessionPage>[1][] = []
const subscriptions: number[] = []
let stops = 0
let fail = false
let semanticHonored = true
let deltaOverflow = false
let reportStreamState: Parameters<typeof client.stream>[3] | null = null
let receiveEvent: Parameters<typeof client.stream>[2] | null = null
let pendingPage: Promise<TimelinePage> | null = null
client.markValidated()
client.sessionPage = async (_id, options) => {
  requests.push(options)
  if (fail) throw new Error('network unavailable')
  if (pendingPage) return pendingPage
  return { ...tail, semantic_paging: options?.pageMode === 'semantic' && semanticHonored, events_omitted_after: !options?.tail && deltaOverflow ? 100 : 0 }
}
client.stream = (_id, after, onEvent, onState) => {
  subscriptions.push(after)
  reportStreamState = onState
  receiveEvent = onEvent
  onState(true)
  return () => { stops += 1 }
}
client.files = async () => ({ files: [], total: 0, offset: 0, limit: 60, has_more: false })
client.markRead = async () => session

try {
  appState.__emitAppState('active')
  useAppStore.setState({ initialized: true, activeProfileId: 'uninitialized', profileGeneration: 0,
    serverConfigured: true, connected: true, connecting: false, workspaceAdopting: false,
    health: { ok: true, server_identity: 'uninitialized', api_contract_version: 9 }, sessions: [session],
    selectedSessionId: session.id, snapshots: { [session.id]: cached }, syncStatus: 'cached', liveConnected: false })

  await useAppStore.getState().selectSession(session.id)
  assert.deepEqual(requests, [{ limit: 48, tail: true, visible: true, pageMode: 'semantic' }], 'a stale cache must not request its old delta before the latest page')
  assert.deepEqual(subscriptions, [10_000], 'subscribe only at the authoritative page boundary')
  assert.deepEqual(useAppStore.getState().snapshots[session.id].events.map(value => value.seq), [9_999, 10_000])
  assert.equal(useAppStore.getState().snapshots[session.id].nextBefore, 9_999, 'older content remains pageable')

  requests.length = 0
  await useAppStore.getState().syncSelectedSession('foreground')
  assert.equal(requests[0]?.tail, true, 'foreground recovery is latest-first even with a cached snapshot')
  assert.equal(stops, 1, 'retire the old stream before replacing its window')
  assert.deepEqual(subscriptions, [10_000, 10_000])

  requests.length = 0
  await useAppStore.getState().syncSelectedSession('server-ahead')
  assert.deepEqual(requests, [{ after: 10_000, limit: 240, tail: false, visible: true }], 'healthy live sessions keep the bounded delta path')

  deltaOverflow = true
  requests.length = 0
  await useAppStore.getState().syncSelectedSession('server-ahead')
  assert.deepEqual(requests.map(value => value?.tail), [false, true], 'an overflowing healthy delta replaces the window with a bounded tail')
  deltaOverflow = false

  reportStreamState!(false)
  requests.length = 0
  await useAppStore.getState().syncSelectedSession('recovery')
  assert.deepEqual(requests, [{ limit: 48, tail: true, visible: true, pageMode: 'semantic' }], 'disconnected recovery must not replay the stale cursor')

  fail = true
  const beforeFailure = useAppStore.getState().snapshots[session.id]
  const beforeSubscriptions = subscriptions.length
  await useAppStore.getState().syncSelectedSession('manual')
  assert.equal(useAppStore.getState().snapshots[session.id], beforeFailure, 'a failed latest-page read must not clear visible content')
  assert.equal(subscriptions.length, beforeSubscriptions, 'do not replay an old cursor after a failed page read')
  fail = false

  semanticHonored = false
  requests.length = 0
  await useAppStore.getState().syncSelectedSession('manual')
  assert.deepEqual(requests.map(value => [value?.tail, value?.pageMode, value?.after]), [[true, 'semantic', undefined], [true, undefined, undefined]], 'partially upgraded servers retain the legacy tail fallback')

  const completeLegacyPage: TimelinePage = {
    ...tail, events: [event(10_000)], total: 1, has_more: false,
    semantic_paging: false, events_omitted_before: 0, events_omitted_after: 0,
  }
  pendingPage = Promise.resolve(completeLegacyPage)
  requests.length = 0
  await useAppStore.getState().syncSelectedSession('manual')
  assert.equal(requests.length, 1, 'a provably complete legacy small chat must not incur a second tail round trip')
  assert.equal(useAppStore.getState().snapshots[session.id].semanticPaging, false)
  assert.equal(subscriptions.at(-1), 10_000)

  for (const incomplete of [
    { total: null },
    { total: 2 },
    { has_more: true },
    { events_omitted_after: 1 },
  ]) {
    pendingPage = Promise.resolve({ ...completeLegacyPage, ...incomplete })
    requests.length = 0
    await useAppStore.getState().syncSelectedSession('manual')
    assert.equal(requests.length, 2, 'unknown totals or omitted events must retain the compatibility fallback')
  }
  pendingPage = null

  semanticHonored = true
  let resolvePage!: (value: TimelinePage) => void
  pendingPage = new Promise(resolve => { resolvePage = resolve })
  const retiredReceiver = receiveEvent!
  const concurrentSync = useAppStore.getState().syncSelectedSession('manual')
  const duringRequest = useAppStore.getState().snapshots[session.id]
  retiredReceiver(event(10_001))
  assert.equal(useAppStore.getState().snapshots[session.id], duringRequest, 'a retired stream must not publish during the replacement read')
  useAppStore.setState({ snapshots: { [session.id]: { ...duringRequest, events: [event(500), ...duringRequest.events, event(10_002)], latestSeq: 10_002 } } })
  resolvePage(tail)
  await concurrentSync
  assert.deepEqual(useAppStore.getState().snapshots[session.id].events.map(value => value.seq), [9_999, 10_000, 10_002], 'retain a concurrent new send but never reintroduce stale replay below the tail')
  assert.equal(subscriptions.at(-1), 10_000, 'subscribe at the page boundary, not beyond a concurrent event that could hide a gap')
  receiveEvent!(event(10_001))
  receiveEvent!(event(10_002))
  assert.deepEqual(useAppStore.getState().snapshots[session.id].events.map(value => value.seq), [9_999, 10_000, 10_001, 10_002], 'stream replay fills the concurrent gap without duplicating the send result')

  pendingPage = new Promise(resolve => { resolvePage = resolve })
  const backgroundSync = useAppStore.getState().syncSelectedSession('manual')
  const beforeBackground = useAppStore.getState().snapshots[session.id]
  const subscriptionsBeforeBackground = subscriptions.length
  appState.__emitAppState('background')
  resolvePage(tail)
  await backgroundSync
  assert.equal(useAppStore.getState().snapshots[session.id], beforeBackground)
  assert.equal(subscriptions.length, subscriptionsBeforeBackground, 'background completion must not restart a stream')
  appState.__emitAppState('active')

  pendingPage = new Promise(resolve => { resolvePage = resolve })
  requests.length = 0
  const syncing = useAppStore.getState().syncSelectedSession('manual')
  const snapshotWhileLoading = useAppStore.getState().snapshots[session.id]
  assert.ok(snapshotWhileLoading.events.length, 'cached content remains painted while the network is pending')
  useAppStore.setState({ selectedSessionId: 'another-chat' })
  resolvePage({ ...tail, semantic_paging: false })
  await syncing
  assert.equal(useAppStore.getState().snapshots[session.id], snapshotWhileLoading, 'a late response must not publish after switching chats')
  assert.equal(requests.length, 1, 'a retired semantic read must not launch a legacy fallback for the old chat')
  console.log('mobile latest-first selection, foreground, fallback and stale-response tests passed')
} finally {
  appState.__emitAppState('background')
  await useAppStore.getState().selectSession(session.id)
  client.sessionPage = original.page
  client.stream = original.stream
  client.files = original.files
  client.markRead = original.read
}
